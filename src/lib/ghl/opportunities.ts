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

/** Paginate the opportunities search until done OR until a stop predicate fires. */
export async function streamOpportunities(
  auth: GhlAuth,
  stop?: (opp: RawOpportunity) => boolean,
  filter?: (opp: RawOpportunity) => boolean
): Promise<RawOpportunity[]> {
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
    for (const o of opps) {
      if (!filter || filter(o)) collected.push(o);
      if (stop && stop(o)) {
        return collected;
      }
    }
    const next = data.meta?.nextPageUrl;
    if (!next) break;
    // The API returns a full URL; strip the host so getV2 can prepend it.
    try {
      const u = new URL(next);
      url = u.pathname + u.search;
    } catch {
      url = next;
    }
  }
  return collected;
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
