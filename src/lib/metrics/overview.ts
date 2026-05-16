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
  const thisMonth: Range = rangeFor("this_month", now);
  const lastMonth: Range = rangeFor("last_month", now);
  const thisWeek: Range = rangeFor("this_week", now);
  const lastWeek: Range = rangeFor("last_week", now);

  const opps = await prefetchAllOpps();

  const [
    leadsM,
    leadsMPrev,
    leadsW,
    leadsWPrev,
    refM,
    refMPrev,
    refW,
    refWPrev,
    sigM,
    sigMPrev,
    sigW,
    sigWPrev,
  ] = await Promise.all([
    leadsInRange(thisMonth.start, thisMonth.end),
    leadsInRange(lastMonth.start, lastMonth.end),
    leadsInRange(thisWeek.start, thisWeek.end),
    leadsInRange(lastWeek.start, lastWeek.end),
    referredOutInRange(opps.abogado, opps.pplt, thisMonth.start, thisMonth.end),
    referredOutInRange(opps.abogado, opps.pplt, lastMonth.start, lastMonth.end),
    referredOutInRange(opps.abogado, opps.pplt, thisWeek.start, thisWeek.end),
    referredOutInRange(opps.abogado, opps.pplt, lastWeek.start, lastWeek.end),
    signedInRange(opps.abogado, opps.pplt, thisMonth.start, thisMonth.end),
    signedInRange(opps.abogado, opps.pplt, lastMonth.start, lastMonth.end),
    signedInRange(opps.abogado, opps.pplt, thisWeek.start, thisWeek.end),
    signedInRange(opps.abogado, opps.pplt, lastWeek.start, lastWeek.end),
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
    leadsMonth: delta(leadsM, leadsMPrev),
    leadsWeek: delta(leadsW, leadsWPrev),
    referralsMonth: delta(refM, refMPrev),
    referralsWeek: delta(refW, refWPrev),
    signedMonth: delta(sigM, sigMPrev),
    signedWeek: delta(sigW, sigWPrev),
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
