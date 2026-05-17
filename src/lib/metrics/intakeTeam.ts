/**
 * Intake team analytics. The same 10 clientcare\d+@pinderplotkin.com users
 * appear on both GHL locations and handle both books, so we aggregate
 * activity across both locations per user.
 *
 * Attribution (the action that triggers the referral credits the
 * intake person):
 *   - For each opp whose stageClass became "referred_out" / co-counsel /
 *     broker in the window, look up the contact's recent message
 *     timeline (from /api/sync/intake) and credit the intake rep who
 *     sent the most recent OUTBOUND call/SMS in the 14 days before the
 *     stage flipped. opp.assignedTo is NOT used -- in this firm's GHL
 *     setup that field is sparse-to-empty.
 *   - Same rule for "signed": rep who last touched the contact before
 *     the sign-up gets credit.
 *
 * Calls / SMS / Avg call come from the same /api/sync/intake KV
 * snapshot (per-user daily buckets).
 */
import { authAbogado, authPplt } from "../ghl/client";
import {
  classifyOpportunities,
  streamOpportunities,
  type ClassifiedOpportunity,
} from "../ghl/opportunities";
import { intakeUsers, getLocation } from "../mapping";
import { rangeFor, previousPeriod } from "../dateRanges";
import { delta } from "./helpers";
import {
  readIntakeConversations,
  sumActivityForWindow,
  attributeStageChange,
  type IntakeConversationsSnapshot,
} from "../intakeConversationsStore";
import type { IntakeMemberMetrics } from "../types";

interface PerUserCounts {
  referrals: number;
  signedFromReferrals: number;
  activeFromReferrals: number;
}

function emptyCounts(): PerUserCounts {
  return { referrals: 0, signedFromReferrals: 0, activeFromReferrals: 0 };
}

/**
 * Walk opps once and emit per-user counts within [startMs, endMs), using
 * the conversation timeline to attribute the stage change.
 *
 * intakeUserIds = the set of GHL user IDs we consider "intake" for THIS
 * location (so attribution doesn't bleed to non-intake users).
 */
function countAttributedForLocation(
  opps: ClassifiedOpportunity[],
  snapshot: IntakeConversationsSnapshot | null,
  intakeUserIds: Set<string>,
  start: Date,
  end: Date
): Map<string, PerUserCounts> {
  const out = new Map<string, PerUserCounts>();
  const sMs = start.getTime();
  const eMs = end.getTime();
  const byContact = snapshot?.byContact ?? {};
  const credit = (
    userId: string,
    bump: (c: PerUserCounts) => void
  ) => {
    let c = out.get(userId);
    if (!c) {
      c = emptyCounts();
      out.set(userId, c);
    }
    bump(c);
  };

  for (const o of opps) {
    if (!o.includeInMetrics) continue;
    const contactId = o.raw.contactId ?? "";
    const lastChange = o.raw.lastStageChangeAt ? Date.parse(o.raw.lastStageChangeAt) : NaN;
    if (!Number.isFinite(lastChange)) continue;

    const isReferred =
      o.pipelinePurpose === "co_counsel_tracking" ||
      o.pipelinePurpose === "referral_broker" ||
      o.stageClass === "referred_out";
    const isSigned = o.stageClass === "signed";
    if (!isReferred && !isSigned) continue;

    const inWindow = lastChange >= sMs && lastChange < eMs;
    const isActiveReferral = isReferred && o.raw.status === "open";
    if (!inWindow && !isActiveReferral) continue;

    const timeline = byContact[contactId];
    const attributedUserId = attributeStageChange(
      timeline,
      lastChange,
      intakeUserIds
    );
    if (!attributedUserId) continue;

    if (isReferred && inWindow) {
      credit(attributedUserId, (c) => {
        c.referrals += 1;
      });
    }
    if (isSigned && inWindow) {
      credit(attributedUserId, (c) => {
        c.signedFromReferrals += 1;
      });
    }
    if (isActiveReferral) {
      credit(attributedUserId, (c) => {
        c.activeFromReferrals += 1;
      });
    }
  }
  return out;
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
  const intakeIdsA = new Set(intakeA.map((u) => u.id));
  const intakeIdsP = new Set(intakeP.map((u) => u.id));

  // Same human may have different GHL user IDs per location -- key by lowercased email.
  const seen = new Map<
    string,
    { email: string; name: string; idsByLoc: Record<string, string> }
  >();
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

  // Resolve attribution PER LOCATION for each window we need.
  // Bucket filter: skip the location that's out of scope.
  const useAbogado = bucket !== "english";
  const usePplt = bucket !== "spanish";
  const aOpts = (s: Date, e: Date) =>
    useAbogado
      ? countAttributedForLocation(oppsA, convA, intakeIdsA, s, e)
      : new Map<string, PerUserCounts>();
  const pOpts = (s: Date, e: Date) =>
    usePplt
      ? countAttributedForLocation(oppsP, convP, intakeIdsP, s, e)
      : new Map<string, PerUserCounts>();

  const aRange = aOpts(start, end);
  const pRange = pOpts(start, end);
  const a30 = aOpts(last30.start, last30.end);
  const p30 = pOpts(last30.start, last30.end);
  const aPrev30 = aOpts(prev30.start, prev30.end);
  const pPrev30 = pOpts(prev30.start, prev30.end);
  const a7 = aOpts(last7.start, last7.end);
  const p7 = pOpts(last7.start, last7.end);
  const aPrev7 = aOpts(prev7.start, prev7.end);
  const pPrev7 = pOpts(prev7.start, prev7.end);

  const pick = (
    aMap: Map<string, PerUserCounts>,
    pMap: Map<string, PerUserCounts>,
    aId: string | undefined,
    pId: string | undefined
  ): PerUserCounts => {
    const a = aId ? aMap.get(aId) : undefined;
    const p = pId ? pMap.get(pId) : undefined;
    return {
      referrals: (a?.referrals ?? 0) + (p?.referrals ?? 0),
      signedFromReferrals:
        (a?.signedFromReferrals ?? 0) + (p?.signedFromReferrals ?? 0),
      activeFromReferrals:
        (a?.activeFromReferrals ?? 0) + (p?.activeFromReferrals ?? 0),
    };
  };

  const out: IntakeMemberMetrics[] = [];

  for (const [, slot] of seen) {
    const aId = useAbogado ? slot.idsByLoc.abogado : undefined;
    const pId = usePplt ? slot.idsByLoc.pplt_leads : undefined;

    const rangeStats = pick(aRange, pRange, aId, pId);
    const cur30 = pick(a30, p30, aId, pId);
    const prev30Stats = pick(aPrev30, pPrev30, aId, pId);
    const cur7 = pick(a7, p7, aId, pId);
    const prev7Stats = pick(aPrev7, pPrev7, aId, pId);

    // Calls / SMS come from the per-user daily buckets in the same KV
    // snapshot. NULL snapshot means the intake cron hasn't run yet --
    // the section's info banner flags it.
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
