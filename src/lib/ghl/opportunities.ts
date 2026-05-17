/**
 * Opportunity fetch + classification. Iterates the search endpoint (cheap)
 * for date-bounded queries, joins with mapping.json to label each opp's
 * pipeline purpose, practice area, co-counsel firm, and stage class.
 */
import { activePracticePipelines, buildStageIndex, getLocation } from "../mapping";
import type {
  LocationKey,
  MappingPipeline,
  StageClass,
} from "../types";
import { getV2, GhlAuth } from "./client";

/**
 * Per-process short-lived memo for streamOpportunities.
 *
 * The dashboard calls this many times per request (every KPI block, every
 * lead-analytics bucket, intake team, case analytics). Walking ~50k+ opps
 * once and re-using it is dramatically cheaper than re-fetching 14+ times.
 * 5-minute TTL spans one dashboard render comfortably and survives the
 * Vercel function's invocation lifetime, so the same opps don't get
 * re-fetched on every per-section retry.
 */
// 15 minutes — see contacts.ts for rationale.
const STREAM_TTL_MS = 15 * 60_000;
type StreamCacheEntry = { expires: number; promise: Promise<RawOpportunity[]> };
const streamCache = new Map<string, StreamCacheEntry>();

/**
 * Cutoff: only walk opportunities that have changed in the last 180 days.
 * Old long-dormant opportunities pollute the active-case count and inflate
 * the walk into a 504-causing fetch. If the firm has a 2-year-old open
 * case that hasn't been touched, it won't appear -- which is the right
 * trade-off for a "what's moving" dashboard.
 */
const OPP_WALK_DAYS = 180;

export interface RawOpportunity {
  id: string;
  name?: string;
  contactId?: string;
  pipelineId?: string;
  pipelineStageId?: string;
  status?: string;
  source?: string;
  attributions?: Array<{
    isFirst?: boolean;
    isLast?: boolean;
    medium?: string;
    utmSource?: string;
    utmContent?: string;
    utmCampaign?: string;
    utmAdId?: string;
  }>;
  createdAt?: string;
  lastStageChangeAt?: string;
  contact?: {
    state?: string;
    customFields?: Array<{ id: string; value?: unknown }>;
  };
  customFields?: Array<{ id: string; fieldValue?: unknown }>;
  monetaryValue?: number;
  assignedTo?: string;
  tags?: string[];
}

interface SearchResp {
  opportunities: RawOpportunity[];
  meta?: { nextPageUrl?: string; total?: number };
}

/**
 * Paginate the opportunities search, stopping once we've walked past the
 * OPP_WALK_DAYS cutoff. Results are sorted newest-first by GHL, so once
 * a page's most-recent opp is older than the cutoff, the rest are too.
 *
 * Memoized per location for STREAM_TTL_MS so all sections share one fetch.
 */
export async function streamOpportunities(
  auth: GhlAuth
): Promise<RawOpportunity[]> {
  const key = `opps:${auth.locationId}`;
  const now = Date.now();
  const cached = streamCache.get(key);
  if (cached && cached.expires > now) return cached.promise;

  const cutoffMs = now - OPP_WALK_DAYS * 24 * 3600 * 1000;

  const promise = (async () => {
    const collected: RawOpportunity[] = [];
    let url:
      | string
      | undefined = `/opportunities/search?location_id=${auth.locationId}&limit=100`;
    let page = 0;
    while (url) {
      page++;
      if (page > 500) break; // safety
      const data: SearchResp = await getV2(auth, url.replace(/^.*?\//, "/"));
      const opps = data.opportunities ?? [];
      if (!opps.length) break;
      let oldestOnPageMs = Infinity;
      for (const o of opps) {
        const ts =
          (o.lastStageChangeAt && Date.parse(o.lastStageChangeAt)) ||
          (o.createdAt && Date.parse(o.createdAt)) ||
          0;
        if (ts >= cutoffMs) collected.push(o);
        if (ts < oldestOnPageMs) oldestOnPageMs = ts;
      }
      // If every opp on this page is older than the cutoff, GHL is sorted
      // desc so the remaining pages are also too old -- stop walking.
      if (oldestOnPageMs < cutoffMs && oldestOnPageMs !== Infinity) break;
      const next = data.meta?.nextPageUrl;
      if (!next) break;
      try {
        const u = new URL(next);
        url = u.pathname + u.search;
      } catch {
        url = next;
      }
    }
    return collected;
  })();

  // Cache the promise immediately so concurrent callers share the fetch.
  streamCache.set(key, { expires: now + STREAM_TTL_MS, promise });
  promise.catch(() => {
    if (streamCache.get(key)?.promise === promise) streamCache.delete(key);
  });
  return promise;
}

export interface ClassifiedOpportunity {
  raw: RawOpportunity;
  locationKey: LocationKey;
  pipelineName: string;
  pipelinePurpose: MappingPipeline["purpose"];
  practiceArea: MappingPipeline["practice_area"];
  coCounselFirm: MappingPipeline["co_counsel_firm"];
  stageName: string;
  stageClass: StageClass | "active";
  includeInMetrics: boolean;
}

export function classifyOpportunities(
  auth: GhlAuth,
  raw: RawOpportunity[]
): ClassifiedOpportunity[] {
  const loc = getLocation(auth.key);
  const idx = buildStageIndex(loc);
  const out: ClassifiedOpportunity[] = [];
  for (const o of raw) {
    const sId = o.pipelineStageId;
    const info = sId ? idx.get(sId) : undefined;
    if (!info) continue;
    out.push({
      raw: o,
      locationKey: auth.key,
      pipelineName: info.pipelineName,
      pipelinePurpose: info.pipelinePurpose,
      practiceArea: info.practiceArea,
      coCounselFirm: info.coCounselFirm,
      stageName: info.stageName,
      stageClass: info.stageClass,
      includeInMetrics: info.includeInMetrics,
    });
  }
  return out;
}

/**
 * Count opportunities whose stage entry-time (lastStageChangeAt) falls in
 * [start, end), grouped by a key function. The signed/referred-out KPIs use
 * this -- those filter by *when the opportunity entered the relevant stage*,
 * not by createdAt.
 */
export function countByStageEntry<K extends string | number>(
  opps: ClassifiedOpportunity[],
  start: Date,
  end: Date,
  predicate: (o: ClassifiedOpportunity) => boolean,
  keyFn: (o: ClassifiedOpportunity) => K | null
): Map<K, number> {
  const m = new Map<K, number>();
  const sMs = start.getTime();
  const eMs = end.getTime();
  for (const o of opps) {
    if (!o.includeInMetrics) continue;
    if (!predicate(o)) continue;
    const ts = o.raw.lastStageChangeAt;
    if (!ts) continue;
    const t = new Date(ts).getTime();
    if (t < sMs || t >= eMs) continue;
    const k = keyFn(o);
    if (k === null) continue;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

/** Snapshot of all opportunities currently active (no time filter). */
export function activeNow(opps: ClassifiedOpportunity[]): ClassifiedOpportunity[] {
  return opps.filter(
    (o) =>
      o.includeInMetrics &&
      (o.raw.status === "open" || o.raw.status === undefined) &&
      o.stageClass !== "signed" &&
      o.stageClass !== "withdrawn" &&
      o.stageClass !== "closed_lost" &&
      o.stageClass !== "referred_out"
  );
}

/** Just the in-house active practice opportunities (excludes co-counsel + broker pipelines). */
export function activeInHouse(opps: ClassifiedOpportunity[]): ClassifiedOpportunity[] {
  const inHousePipelineIds = new Set(
    activePracticePipelines(getLocation(opps[0]?.locationKey ?? "pplt_leads")).map(
      (p) => p.id
    )
  );
  return activeNow(opps).filter((o) => inHousePipelineIds.has(o.raw.pipelineId ?? ""));
}
