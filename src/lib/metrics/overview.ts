/**
 * Top-of-page Overview metrics: leads / referrals / signed (this period vs
 * prior period) plus active-cases total and Google Review counts.
 */
import { metaLeadFormsInRange } from "../ghl/contacts";
import { reviewCounts } from "../ghl/reviews";
import { authAbogado, authPplt, bothAuths } from "../ghl/client";
import {
  classifyOpportunities,
  countByStageEntry,
  streamOpportunities,
} from "../ghl/opportunities";
import { activePracticePipelines, getLocation } from "../mapping";
import {
  rangeFor,
  previousPeriod,
  type Range,
} from "../dateRanges";
import { delta } from "./helpers";
import type { OverviewData } from "../types";

export type OverviewBucket = "combined" | "english" | "spanish";

/** Whether each location contributes to the bucket. */
function bucketIncludes(bucket: OverviewBucket): { abogado: boolean; pplt: boolean } {
  return {
    abogado: bucket !== "english",
    pplt: bucket !== "spanish",
  };
}

/**
 * Count leads (contacts created) within a range, scoped to a bucket.
 * "Lead" definition matches the firm's spreadsheet: source must pass
 * isOnlineSource(), and we dedupe same-contact submissions within 3
 * days (one person, multiple form-fills for the same case = one lead;
 * the same person calling back >3 days later = a new lead).
 */
export async function leadsInRange(
  start: Date,
  end: Date,
  bucket: OverviewBucket = "combined"
): Promise<number> {
  const inc = bucketIncludes(bucket);
  const [a, p] = await Promise.all([
    inc.abogado ? metaLeadFormsInRange(authAbogado(), start, end) : Promise.resolve([]),
    inc.pplt ? metaLeadFormsInRange(authPplt(), start, end) : Promise.resolve([]),
  ]);
  return a.length + p.length;
}

/** Count signed opportunities (stage entered in window), scoped to a bucket. */
export async function signedInRange(
  oppsAbogado: ReturnType<typeof classifyOpportunities>,
  oppsPplt: ReturnType<typeof classifyOpportunities>,
  start: Date,
  end: Date,
  bucket: OverviewBucket = "combined"
): Promise<number> {
  const inc = bucketIncludes(bucket);
  const m1 = inc.abogado
    ? countByStageEntry(oppsAbogado, start, end, (o) => o.stageClass === "signed", () => 1)
    : new Map<number, number>();
  const m2 = inc.pplt
    ? countByStageEntry(oppsPplt, start, end, (o) => o.stageClass === "signed", () => 1)
    : new Map<number, number>();
  return (m1.get(1) ?? 0) + (m2.get(1) ?? 0);
}

/** Count referred-out opportunities (stage entered in window), scoped to a bucket. */
export async function referredOutInRange(
  oppsAbogado: ReturnType<typeof classifyOpportunities>,
  oppsPplt: ReturnType<typeof classifyOpportunities>,
  start: Date,
  end: Date,
  bucket: OverviewBucket = "combined"
): Promise<number> {
  const inc = bucketIncludes(bucket);
  const pred = (o: { stageClass: string; pipelinePurpose: string }) =>
    o.stageClass === "referred_out" ||
    o.pipelinePurpose === "co_counsel_tracking" ||
    o.pipelinePurpose === "referral_broker";
  const m1 = inc.abogado
    ? countByStageEntry(oppsAbogado, start, end, pred, () => 1)
    : new Map<number, number>();
  const m2 = inc.pplt
    ? countByStageEntry(oppsPplt, start, end, pred, () => 1)
    : new Map<number, number>();
  return (m1.get(1) ?? 0) + (m2.get(1) ?? 0);
}

export interface PrefetchedOpps {
  abogado: ReturnType<typeof classifyOpportunities>;
  pplt: ReturnType<typeof classifyOpportunities>;
}

export async function prefetchAllOpps(): Promise<PrefetchedOpps> {
  const a = authAbogado();
  const p = authPplt();
  const [rawA, rawP] = await Promise.all([
    streamOpportunities(a),
    streamOpportunities(p),
  ]);
  return {
    abogado: classifyOpportunities(a, rawA),
    pplt: classifyOpportunities(p, rawP),
  };
}

export async function overview(
  bucket: OverviewBucket = "combined",
  now = new Date()
): Promise<OverviewData> {
  const last30: Range = rangeFor("last_30_days", now);
  const prev30: Range = previousPeriod(last30);
  const last7: Range = rangeFor("last_7_days", now);
  const prev7: Range = previousPeriod(last7);

  const opps = await prefetchAllOpps();
  const inc = { abogado: bucket !== "english", pplt: bucket !== "spanish" };

  const [
    leads30Cur,
    leads30Prev,
    leads7Cur,
    leads7Prev,
    ref30Cur,
    ref30Prev,
    ref7Cur,
    ref7Prev,
    sig30Cur,
    sig30Prev,
    sig7Cur,
    sig7Prev,
  ] = await Promise.all([
    leadsInRange(last30.start, last30.end, bucket),
    leadsInRange(prev30.start, prev30.end, bucket),
    leadsInRange(last7.start, last7.end, bucket),
    leadsInRange(prev7.start, prev7.end, bucket),
    referredOutInRange(opps.abogado, opps.pplt, last30.start, last30.end, bucket),
    referredOutInRange(opps.abogado, opps.pplt, prev30.start, prev30.end, bucket),
    referredOutInRange(opps.abogado, opps.pplt, last7.start, last7.end, bucket),
    referredOutInRange(opps.abogado, opps.pplt, prev7.start, prev7.end, bucket),
    signedInRange(opps.abogado, opps.pplt, last30.start, last30.end, bucket),
    signedInRange(opps.abogado, opps.pplt, prev30.start, prev30.end, bucket),
    signedInRange(opps.abogado, opps.pplt, last7.start, last7.end, bucket),
    signedInRange(opps.abogado, opps.pplt, prev7.start, prev7.end, bucket),
  ]);

  // Reviews fetched separately with a hard 15s budget so a slow GHL
  // reputation endpoint can't block the rest of Overview. Returns null
  // on timeout; the dashboard surfaces "reviews unavailable".
  const reviewBlock = await Promise.race([
    reviewCounts(bothAuths()),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 15_000)),
  ]);

  // Active Signed Cases = cases still on our books right now.
  //   = signed up (in an in-house active_practice pipeline)
  //     MINUS later turned down (client withdrew or referred to co-counsel)
  //     MINUS settled (case completed / closed)
  //
  // Implementation: status === "open" AND pipeline is an in-house
  // active_practice pipeline. Withdrawn / referred-out / settled cases
  // all have status !== "open" (or live in a different pipelinePurpose),
  // so this single predicate captures the net.
  const inHouseAbogadoPipelineIds = new Set(
    activePracticePipelines(getLocation("abogado")).map((p) => p.id)
  );
  const inHousePpltPipelineIds = new Set(
    activePracticePipelines(getLocation("pplt_leads")).map((p) => p.id)
  );
  const isActiveSigned = (o: { raw: { status?: string; pipelineId?: string | null } }, ids: Set<string>) =>
    o.raw.status === "open" && ids.has(o.raw.pipelineId ?? "");
  const activeAbogado = inc.abogado
    ? opps.abogado.filter((o) => isActiveSigned(o, inHouseAbogadoPipelineIds)).length
    : 0;
  const activePplt = inc.pplt
    ? opps.pplt.filter((o) => isActiveSigned(o, inHousePpltPipelineIds)).length
    : 0;
  const activeTotal = activeAbogado + activePplt;

  return {
    leads30: delta(leads30Cur, leads30Prev),
    leads7: delta(leads7Cur, leads7Prev),
    referrals30: delta(ref30Cur, ref30Prev),
    referrals7: delta(ref7Cur, ref7Prev),
    signed30: delta(sig30Cur, sig30Prev),
    signed7: delta(sig7Cur, sig7Prev),
    activeTotal,
    reviews: reviewBlock ?? {
      week: 0,
      month: 0,
      year: 0,
      lifetime: 0,
      perProfile: [],
    },
  };
}

// re-export so the data route can pre-warm prevPeriod ranges
export { previousPeriod };
