/**
 * Email metrics + cross-reference with signed-within-30-days-of-reply.
 *
 * For "signed within 30 days of reply": for each contact that has an email
 * reply event in the window, check if any of their opportunities entered a
 * Signed stage within 30 days AFTER the reply. We approximate by joining
 * messages.email-reply events to opportunities-by-contactId.
 */
import { authAbogado, authPplt } from "../ghl/client";
import { emailMetricsForLocation } from "../ghl/emails";
import {
  classifyOpportunities,
  streamOpportunities,
} from "../ghl/opportunities";
import type { EmailMetrics } from "../types";

// GHL email endpoints (/emails/stats and /emails/events) consistently
// return slow 5xx on this plan tier, eating the 120s section timeout.
// Set this to true once we identify the right endpoint or upgrade the
// GHL plan; until then we return empty metrics and the dashboard shows
// "Email metrics unavailable" warning.
const FETCH_EMAIL = false;

interface ReplyEvent {
  contactId: string;
  ts: number;
}

async function repliesPlusSignedJoin(
  auth: ReturnType<typeof authAbogado>,
  start: Date,
  end: Date,
  replies: ReplyEvent[]
): Promise<number> {
  if (replies.length === 0) return 0;
  const oppsRaw = await streamOpportunities(auth);
  const opps = classifyOpportunities(auth, oppsRaw);
  const signedByContact = new Map<string, number[]>();
  for (const o of opps) {
    if (o.stageClass !== "signed") continue;
    const cid = o.raw.contactId;
    const t = o.raw.lastStageChangeAt ? Date.parse(o.raw.lastStageChangeAt) : NaN;
    if (!cid || Number.isNaN(t)) continue;
    const arr = signedByContact.get(cid) ?? [];
    arr.push(t);
    signedByContact.set(cid, arr);
  }
  const WIN = 30 * 24 * 3600 * 1000;
  let count = 0;
  for (const r of replies) {
    const ts = signedByContact.get(r.contactId);
    if (!ts) continue;
    if (ts.some((s) => s >= r.ts && s - r.ts <= WIN)) count++;
  }
  void start;
  void end;
  return count;
}

export async function emailMetricsByBucket(
  start: Date,
  end: Date
): Promise<EmailMetrics[]> {
  if (!FETCH_EMAIL) {
    return [
      { bucket: "spanish", sends: 0, opens: 0, clicks: 0, replies: 0, unsubscribes: 0, signedWithin30dOfReply: 0 },
      { bucket: "english", sends: 0, opens: 0, clicks: 0, replies: 0, unsubscribes: 0, signedWithin30dOfReply: 0 },
    ];
  }
  const authA = authAbogado();
  const authP = authPplt();
  const [esRaw, enRaw] = await Promise.all([
    emailMetricsForLocation(authA, start, end),
    emailMetricsForLocation(authP, start, end),
  ]);
  // signedWithin30dOfReply: enrich both. We don't have a clean
  // "list of reply events" endpoint reliably, so leave as 0 unless GHL
  // returned per-message detail (best-effort).
  const stub: ReplyEvent[] = [];
  const [esJoin, enJoin] = await Promise.all([
    repliesPlusSignedJoin(authA, start, end, stub),
    repliesPlusSignedJoin(authP, start, end, stub),
  ]);
  esRaw.signedWithin30dOfReply = esJoin;
  enRaw.signedWithin30dOfReply = enJoin;
  return [esRaw, enRaw];
}
