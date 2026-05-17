/**
 * Intake team analytics. The same 10 clientcare\d+@pinderplotkin.com users
 * appear on both GHL locations and handle both books, so we aggregate
 * activity across both locations per user.
 *
 * Metrics per member:
 *   - Referrals made (assignedTo == user, opp entered a co-counsel / broker pipeline in range)
 *   - Signed from those referrals (referred contact later signed)
 *   - Inbound / outbound calls + SMS
 *   - Average answered-call duration (proxy for pickup time)
 *   - WoW + MoM comparisons on referrals + signed
 *   - Total currently active cases from their referrals
 */
import { authAbogado, authPplt } from "../ghl/client";
import {
  classifyOpportunities,
  streamOpportunities,
} from "../ghl/opportunities";
import { intakeUsers, getLocation } from "../mapping";
import { rangeFor, previousPeriod } from "../dateRanges";
import { delta } from "./helpers";
import {
  readIntakeConversations,
  sumActivityForWindow,
} from "../intakeConversationsStore";
import type { IntakeMemberMetrics } from "../types";

interface ReferralSummary {
  referrals: number;
  signedFromReferrals: number;
  activeFromReferrals: number;
}

function referralsForUser(
  opps: ReturnType<typeof classifyOpportunities>,
  userId: string,
  start: Date,
  end: Date
): ReferralSummary {
  const sMs = start.getTime();
  const eMs = end.getTime();
  let referrals = 0;
  let signedFromReferrals = 0;
  let activeFromReferrals = 0;
  for (const o of opps) {
    if (o.raw.assignedTo !== userId) continue;
    if (!o.includeInMetrics) continue;
    const tsRef =
      (o.pipelinePurpose === "co_counsel_tracking" ||
        o.pipelinePurpose === "referral_broker" ||
        o.stageClass === "referred_out") &&
      o.raw.lastStageChangeAt
        ? Date.parse(o.raw.lastStageChangeAt)
        : NaN;
    if (!Number.isNaN(tsRef) && tsRef >= sMs && tsRef < eMs) referrals++;
    // signed from a referred contact: same opp later marked signed
    if (o.stageClass === "signed" && o.raw.lastStageChangeAt) {
      const t = Date.parse(o.raw.lastStageChangeAt);
      if (!Number.isNaN(t) && t >= sMs && t < eMs) signedFromReferrals++;
    }
    if (
      (o.pipelinePurpose === "co_counsel_tracking" ||
        o.pipelinePurpose === "referral_broker") &&
      o.raw.status === "open"
    ) {
      activeFromReferrals++;
    }
  }
  return { referrals, signedFromReferrals, activeFromReferrals };
}

export type IntakeBucket = "combined" | "english" | "spanish";

export async function intakeTeamMetrics(
  start: Date,
  end: Date,
  now: Date = new Date(),
  bucket: IntakeBucket = "combined"
): Promise<IntakeMemberMetrics[]> {
  const authA = authAbogado();
  const authP = authPplt();
  const [oppsA, oppsP, convA, convP] = await Promise.all([
    streamOpportunities(authA).then((r) => classifyOpportunities(authA, r)),
    streamOpportunities(authP).then((r) => classifyOpportunities(authP, r)),
    readIntakeConversations("abogado"),
    readIntakeConversations("pplt_leads"),
  ]);

  const intakeA = intakeUsers(getLocation("abogado"));
  const intakeP = intakeUsers(getLocation("pplt_leads"));
  const seen = new Map<string, { email: string; name: string; idsByLoc: Record<string, string> }>();
  // The same human may have different GHL user IDs per location -- key by lowercased email.
  for (const u of intakeA) {
    const k = u.email.toLowerCase();
    const slot = seen.get(k) ?? { email: u.email, name: u.name, idsByLoc: {} };
    slot.idsByLoc.abogado = u.id;
    seen.set(k, slot);
  }
  for (const u of intakeP) {
    const k = u.email.toLowerCase();
    const slot = seen.get(k) ?? { email: u.email, name: u.name, idsByLoc: {} };
    slot.idsByLoc.pplt_leads = u.id;
    seen.set(k, slot);
  }

  // Rolling windows: last 30 days vs prior 30, last 7 vs prior 7.
  const last30 = rangeFor("last_30_days", now);
  const prev30 = previousPeriod(last30);
  const last7 = rangeFor("last_7_days", now);
  const prev7 = previousPeriod(last7);

  const out: IntakeMemberMetrics[] = [];

  // Bucket filter: pass undefined location ID so its branch in
  // sumRangeStats / call/SMS lookups returns zeros.
  const useAbogado = bucket !== "english";
  const usePplt = bucket !== "spanish";

  for (const [, slot] of seen) {
    const aId = useAbogado ? slot.idsByLoc.abogado : undefined;
    const pId = usePplt ? slot.idsByLoc.pplt_leads : undefined;

    const rangeStats = sumRangeStats(oppsA, oppsP, aId, pId, start, end);
    const cur30 = sumRangeStats(oppsA, oppsP, aId, pId, last30.start, last30.end);
    const prev30Stats = sumRangeStats(oppsA, oppsP, aId, pId, prev30.start, prev30.end);
    const cur7 = sumRangeStats(oppsA, oppsP, aId, pId, last7.start, last7.end);
    const prev7Stats = sumRangeStats(oppsA, oppsP, aId, pId, prev7.start, prev7.end);

    // Calls / SMS come from the KV snapshot written by /api/sync/intake.
    // Sum the daily buckets falling inside [start, end). NULL snapshot
    // means the intake cron hasn't run yet — the section will show
    // zeros and the data-verification banner above the table flags it.
    const aActivity = aId ? convA?.byUser[aId] : undefined;
    const pActivity = pId ? convP?.byUser[pId] : undefined;
    const aSum = sumActivityForWindow(aActivity, start.getTime(), end.getTime());
    const pSum = sumActivityForWindow(pActivity, start.getTime(), end.getTime());
    const inbound = aSum.callsInbound + pSum.callsInbound;
    const outbound = aSum.callsOutbound + pSum.callsOutbound;
    const answered = aSum.callsAnswered + pSum.callsAnswered;
    const durSec = aSum.durationSeconds + pSum.durationSeconds;
    const sms = aSum.sms + pSum.sms;
    const avgPickupSeconds = answered === 0 ? null : durSec / answered;

    out.push({
      userId: slot.email,
      name: slot.name,
      email: slot.email,
      referrals: rangeStats.referrals,
      signedFromReferrals: rangeStats.signedFromReferrals,
      callsInbound: inbound,
      callsOutbound: outbound,
      sms,
      avgPickupSeconds,
      referrals30: delta(cur30.referrals, prev30Stats.referrals),
      referrals7: delta(cur7.referrals, prev7Stats.referrals),
      signed30: delta(cur30.signedFromReferrals, prev30Stats.signedFromReferrals),
      signed7: delta(cur7.signedFromReferrals, prev7Stats.signedFromReferrals),
      activeFromReferrals: rangeStats.activeFromReferrals,
    });
  }

  out.sort((a, b) => b.referrals - a.referrals);
  return out;
}

function sumRangeStats(
  oppsA: ReturnType<typeof classifyOpportunities>,
  oppsP: ReturnType<typeof classifyOpportunities>,
  aId: string | undefined,
  pId: string | undefined,
  start: Date,
  end: Date
): ReferralSummary {
  const a = aId
    ? referralsForUser(oppsA, aId, start, end)
    : { referrals: 0, signedFromReferrals: 0, activeFromReferrals: 0 };
  const p = pId
    ? referralsForUser(oppsP, pId, start, end)
    : { referrals: 0, signedFromReferrals: 0, activeFromReferrals: 0 };
  return {
    referrals: a.referrals + p.referrals,
    signedFromReferrals: a.signedFromReferrals + p.signedFromReferrals,
    activeFromReferrals: a.activeFromReferrals + p.activeFromReferrals,
  };
}
