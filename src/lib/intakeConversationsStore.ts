/**
 * Persisted per-user daily aggregates of conversation activity (calls + SMS).
 *
 * The conversation walk is hundreds of GHL requests per location and blows
 * past the main /api/sync section timeout. So we split it into its own
 * /api/sync/intake cron (4-hourly) that walks the last 60 days, aggregates
 * per (userId, date), and writes to KV. The main dashboard read path then
 * pulls these daily buckets from KV and sums whatever window the date
 * picker is on.
 *
 * One KV entry per location. ~10 users × 60 days × ~50 bytes = ~30KB.
 */
import { kv } from "@vercel/kv";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { env } from "./env";

const STORE_PREFIX = "intake:conversations:v1:";
const STORE_TTL_SECONDS = 30 * 60 * 60; // 30 hours -- generous so a missed cron doesn't blank the UI
export const WINDOW_DAYS = 60;

const IS_VERCEL = Boolean(process.env.VERCEL);

export interface DailyCallBucket {
  /** Calls coming TO an intake user (their phone rang). */
  inbound: number;
  /** Calls placed BY an intake user. */
  outbound: number;
  /** Subset of inbound+outbound that were actually picked up (duration > 0 or status="answered"). */
  answered: number;
  /** Sum of answered-call durations in seconds (for avg pickup proxy). */
  durationSeconds: number;
}

export interface DailySmsBucket {
  inbound: number;
  outbound: number;
}

/**
 * Map of { dateKey -> bucket } for one user. dateKey is "YYYY-MM-DD" in UTC.
 * UTC chosen to avoid timezone drift across server restarts; the dashboard's
 * America/New_York windows still slice this correctly because intake-team
 * windows are >=24h.
 */
export interface UserDailyActivity {
  calls: Record<string, DailyCallBucket>;
  sms: Record<string, DailySmsBucket>;
}

export interface IntakeConversationsSnapshot {
  syncedAt: string;
  startISO: string;
  endISO: string;
  /** userId -> per-day buckets. userId is the GHL user id within this location. */
  byUser: Record<string, UserDailyActivity>;
  /** Calls/SMS we couldn't attribute to a user (caller wasn't an intake user, etc.). */
  unassignedCalls: number;
}

function kvKey(locationKey: "abogado" | "pplt_leads"): string {
  return `${STORE_PREFIX}${locationKey}`;
}

function devPath(locationKey: "abogado" | "pplt_leads"): string {
  return path.join(os.tmpdir(), `pplt-intake-conversations-${locationKey}.json`);
}

export async function readIntakeConversations(
  locationKey: "abogado" | "pplt_leads"
): Promise<IntakeConversationsSnapshot | null> {
  if (env.kv.enabled()) {
    const v = await kv.get<IntakeConversationsSnapshot>(kvKey(locationKey));
    return v ?? null;
  }
  if (IS_VERCEL) return null;
  try {
    const raw = await fs.readFile(devPath(locationKey), "utf-8");
    return JSON.parse(raw) as IntakeConversationsSnapshot;
  } catch {
    return null;
  }
}

export async function writeIntakeConversations(
  locationKey: "abogado" | "pplt_leads",
  snapshot: IntakeConversationsSnapshot
): Promise<void> {
  if (env.kv.enabled()) {
    await kv.set(kvKey(locationKey), snapshot, { ex: STORE_TTL_SECONDS });
    return;
  }
  if (IS_VERCEL) {
    // Mirror snapshotStore behaviour: surface a clear error to the cron logs.
    throw new Error(
      "KV is not configured; cannot persist intake conversations. Connect Upstash for Redis via Vercel Marketplace."
    );
  }
  await fs.writeFile(devPath(locationKey), JSON.stringify(snapshot, null, 2), "utf-8");
}

/** YYYY-MM-DD in UTC. */
export function utcDateKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Aggregate per-user activity within [startMs, endMs) by summing daily buckets. */
export interface SummedActivity {
  callsInbound: number;
  callsOutbound: number;
  callsAnswered: number;
  durationSeconds: number;
  sms: number;
}

export function sumActivityForWindow(
  activity: UserDailyActivity | undefined,
  startMs: number,
  endMs: number
): SummedActivity {
  const out: SummedActivity = {
    callsInbound: 0,
    callsOutbound: 0,
    callsAnswered: 0,
    durationSeconds: 0,
    sms: 0,
  };
  if (!activity) return out;
  // Iterate from startMs to endMs by day (UTC). Cheap because at most 60 days.
  const DAY = 24 * 3600 * 1000;
  for (let t = startMs; t < endMs; t += DAY) {
    const key = utcDateKey(t);
    const c = activity.calls[key];
    if (c) {
      out.callsInbound += c.inbound;
      out.callsOutbound += c.outbound;
      out.callsAnswered += c.answered;
      out.durationSeconds += c.durationSeconds;
    }
    const s = activity.sms[key];
    if (s) out.sms += s.inbound + s.outbound;
  }
  return out;
}
