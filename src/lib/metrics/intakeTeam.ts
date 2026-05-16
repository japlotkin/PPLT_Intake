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
import { conversationsActivity, type ConversationActivity } from "../ghl/conversations";
import {
  classifyOpportunities,
  streamOpportunities,
} from "../ghl/opportunities";
import { intakeUsers, getLocation } from "../mapping";
import { rangeFor } from "../dateRanges";
import { delta } from "./helpers";
import type { IntakeMemberMetrics } from "../types";

// Conversation walk is hundreds of GHL requests per location (every
// conversation with recent activity, then every message in each). It
// blows past the section timeout on busy weeks. For v1 we skip it and
// show 0 for calls/SMS; referral and signed counts (from memoized opps)
// still populate. Re-enable once we have a dedicated longer-running
// cron for /api/sync/intake-conversations.
const FETCH_CONVERSATIONS = false;

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

export async function intakeTeamMetrics(
  start: Date,
  end: Date,
  now = new Date()
): Promise<IntakeMemberMetrics[]> {
  const authA = authAbogado();
  const authP = authPplt();
  const empty: ConversationActivity = {
    callsByUser: new Map(),
    smsByUser: new Map(),
    callsUnassigned: 0,
  };
  const [oppsA, oppsP, convA, convP] = await Promise.all([
    streamOpportunities(authA).then((r) => classifyOpportunities(authA, r)),
    streamOpportunities(authP).then((r) => classifyOpportunities(authP, r)),
    FETCH_CONVERSATIONS ? conversationsActivity(authA, start, end) : Promise.resolve(empty),
    FETCH_CONVERSATIONS ? conversationsActivity(authP, start, end) : Promise.resolve(empty),
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

  const monthRange = rangeFor("this_month", now);
  const lastMonthRange = rangeFor("last_month", now);
  const weekRange = rangeFor("this_week", now);
  const lastWeekRange = rangeFor("last_week", now);

  const out: IntakeMemberMetrics[] = [];

  for (const [, slot] of seen) {
    const aId = slot.idsByLoc.abogado;
    const pId = slot.idsByLoc.pplt_leads;

    const rangeStats = sumRangeStats(oppsA, oppsP, aId, pId, start, end);
    const monthCur = sumRangeStats(oppsA, oppsP, aId, pId, monthRange.start, monthRange.end);
    const monthPrev = sumRangeStats(oppsA, oppsP, aId, pId, lastMonthRange.start, lastMonthRange.end);
    const weekCur = sumRangeStats(oppsA, oppsP, aId, pId, weekRange.start, weekRange.end);
    const weekPrev = sumRangeStats(oppsA, oppsP, aId, pId, lastWeekRange.start, lastWeekRange.end);

    const cA = aId ? convA.callsByUser.get(aId) : undefined;
    const cP = pId ? convP.callsByUser.get(pId) : undefined;
    const sA = aId ? convA.smsByUser.get(aId) : undefined;
    const sP = pId ? convP.smsByUser.get(pId) : undefined;
    const inbound = (cA?.inbound ?? 0) + (cP?.inbound ?? 0);
    const outbound = (cA?.outbound ?? 0) + (cP?.outbound ?? 0);
    const answered = (cA?.answered ?? 0) + (cP?.answered ?? 0);
    const durSec = (cA?.durationSeconds ?? 0) + (cP?.durationSeconds ?? 0);
    const sms = (sA?.inbound ?? 0) + (sA?.outbound ?? 0) + (sP?.inbound ?? 0) + (sP?.outbound ?? 0);
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
      referralsMonth: delta(monthCur.referrals, monthPrev.referrals),
      referralsWeek: delta(weekCur.referrals, weekPrev.referrals),
      signedMonth: delta(monthCur.signedFromReferrals, monthPrev.signedFromReferrals),
      signedWeek: delta(weekCur.signedFromReferrals, weekPrev.signedFromReferrals),
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
