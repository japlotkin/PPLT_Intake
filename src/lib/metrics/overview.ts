/**
 * Top-of-page Overview metrics: leads / referrals / signed (this period vs
 * prior period) plus active-cases total and Google Review counts.
 */
import { contactsInRange } from "../ghl/contacts";
import { reviewCounts } from "../ghl/reviews";
import { authAbogado, authPplt, bothAuths } from "../ghl/client";
import {
  activeNow,
  classifyOpportunities,
  countByStageEntry,
  streamOpportunities,
} from "../ghl/opportunities";
import {
  rangeFor,
  previousPeriod,
  type Range,
} from "../dateRanges";
import { delta } from "./helpers";
import type { OverviewData } from "../types";

/** Count leads (contacts created) across both buckets within a range. */
export async function leadsInRange(start: Date, end: Date): Promise<number> {
  const [a, p] = await Promise.all([
    contactsInRange(authAbogado(), start, end),
    contactsInRange(authPplt(), start, end),
  ]);
  return a.length + p.length;
}

/** Count signed opportunities (stage entered in window). */
export async function signedInRange(
  oppsAbogado: ReturnType<typeof classifyOpportunities>,
  oppsPplt: ReturnType<typeof classifyOpportunities>,
  start: Date,
  end: Date
): Promise<number> {
  const m1 = countByStageEntry(
    oppsAbogado,
    start,
    end,
    (o) => o.stageClass === "signed",
    () => 1
  );
  const m2 = countByStageEntry(
    oppsPplt,
    start,
    end,
    (o) => o.stageClass === "signed",
    () => 1
  );
  return (m1.get(1) ?? 0) + (m2.get(1) ?? 0);
}

/** Count referred-out opportunities (stage entered in window) across both books. */
export async function referredOutInRange(
  oppsAbogado: ReturnType<typeof classifyOpportunities>,
  oppsPplt: ReturnType<typeof classifyOpportunities>,
  start: Date,
  end: Date
): Promise<number> {
  const m1 = countByStageEntry(
    oppsAbogado,
    start,
    end,
    (o) =>
      o.stageClass === "referred_out" ||
      o.pipelinePurpose === "co_counsel_tracking" ||
      o.pipelinePurpose === "referral_broker",
    () => 1
  );
  const m2 = countByStageEntry(
    oppsPplt,
    start,
    end,
    (o) =>
      o.stageClass === "referred_out" ||
      o.pipelinePurpose === "co_counsel_tracking" ||
      o.pipelinePurpose === "referral_broker",
    () => 1
  );
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

export async function overview(now = new Date()): Promise<OverviewData> {
  const last30: Range = rangeFor("last_30_days", now);
  const prev30: Range = previousPeriod(last30);
  const last7: Range = rangeFor("last_7_days", now);
  const prev7: Range = previousPeriod(last7);

  const opps = await prefetchAllOpps();

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
    leadsInRange(last30.start, last30.end),
    leadsInRange(prev30.start, prev30.end),
    leadsInRange(last7.start, last7.end),
    leadsInRange(prev7.start, prev7.end),
    referredOutInRange(opps.abogado, opps.pplt, last30.start, last30.end),
    referredOutInRange(opps.abogado, opps.pplt, prev30.start, prev30.end),
    referredOutInRange(opps.abogado, opps.pplt, last7.start, last7.end),
    referredOutInRange(opps.abogado, opps.pplt, prev7.start, prev7.end),
    signedInRange(opps.abogado, opps.pplt, last30.start, last30.end),
    signedInRange(opps.abogado, opps.pplt, prev30.start, prev30.end),
    signedInRange(opps.abogado, opps.pplt, last7.start, last7.end),
    signedInRange(opps.abogado, opps.pplt, prev7.start, prev7.end),
  ]);

  // Reviews fetched separately with a hard 15s budget so a slow GHL
  // reputation endpoint can't block the rest of Overview. Returns null
  // on timeout; the dashboard surfaces "reviews unavailable".
  const reviewBlock = await Promise.race([
    reviewCounts(bothAuths()),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 15_000)),
  ]);

  const activeTotal =
    activeNow(opps.abogado).length + activeNow(opps.pplt).length;

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
