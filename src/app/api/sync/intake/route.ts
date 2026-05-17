/**
 * POST /api/sync/intake
 *
 * Heavy conversation walk for the Intake Team section. Walks the last 60
 * days of conversations + messages for both GHL locations, aggregates
 * per-user calls + SMS by day, and persists to KV via
 * intakeConversationsStore.
 *
 * Runs on its own 4-hourly Vercel cron (vercel.json). Independent from
 * /api/sync because the conversation walk is hundreds of GHL requests per
 * location -- too heavy for the every-30-min main sync.
 *
 * Auth identical to /api/sync: Bearer CRON_SECRET, or admin Clerk session.
 */
import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { authAbogado, authPplt, type GhlAuth } from "@/lib/ghl/client";
import { conversationsActivity } from "@/lib/ghl/conversations";
import { intakeUsers, getLocation } from "@/lib/mapping";
import {
  writeIntakeConversations,
  WINDOW_DAYS,
  utcDateKey,
  type IntakeConversationsSnapshot,
  type UserDailyActivity,
} from "@/lib/intakeConversationsStore";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function isCronRequest(req: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  return req.headers.get("authorization") === `Bearer ${cronSecret}`;
}

async function isAdminRequest(): Promise<boolean> {
  const { userId } = await auth();
  if (!userId) return false;
  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress?.toLowerCase();
  return email === env.adminEmail();
}

interface RunResult {
  location: "abogado" | "pplt_leads";
  userCount: number;
  totalCalls: number;
  totalSms: number;
  unassignedCalls: number;
  durationMs: number;
  error?: string;
}

async function runOneLocation(
  locationKey: "abogado" | "pplt_leads",
  ghlAuth: GhlAuth,
  start: Date,
  end: Date
): Promise<RunResult> {
  const t0 = Date.now();
  // Restrict aggregation to actual intake-team users only (other users won't
  // get rolled into per-user rows but their activity stays in raw conv data).
  const intake = intakeUsers(getLocation(locationKey));
  const intakeIds = new Set(intake.map((u) => u.id));

  let totalCalls = 0;
  let totalSms = 0;
  let unassignedCalls = 0;

  try {
    const activity = await conversationsActivity(ghlAuth, start, end);

    // conversationsActivity returns AGGREGATE-OVER-WINDOW totals per user,
    // not per-day. We want per-day so the dashboard can slice arbitrary
    // sub-windows (rolling 7d/30d, this_week, last_month, etc.) without
    // re-walking conversations. So we re-walk message-level here at a
    // finer granularity.
    //
    // For v1, store the aggregate-over-the-full-60d-window as a single
    // synthetic "bucket" keyed to today. This means the dashboard can
    // ONLY show calls/SMS over the full window. Per-day breakdown comes
    // later. (TODO: lift conversations.ts to expose per-day too.)
    const todayKey = utcDateKey(Date.now());
    const byUser: Record<string, UserDailyActivity> = {};

    for (const [userId, summary] of activity.callsByUser) {
      if (!intakeIds.has(userId)) continue;
      const slot: UserDailyActivity = byUser[userId] ?? { calls: {}, sms: {} };
      slot.calls[todayKey] = {
        inbound: summary.inbound,
        outbound: summary.outbound,
        answered: summary.answered,
        durationSeconds: summary.durationSeconds,
      };
      byUser[userId] = slot;
      totalCalls += summary.inbound + summary.outbound;
    }
    for (const [userId, sms] of activity.smsByUser) {
      if (userId === "(system)" || !intakeIds.has(userId)) continue;
      const slot: UserDailyActivity = byUser[userId] ?? { calls: {}, sms: {} };
      slot.sms[todayKey] = { inbound: sms.inbound, outbound: sms.outbound };
      byUser[userId] = slot;
      totalSms += sms.inbound + sms.outbound;
    }
    unassignedCalls = activity.callsUnassigned;

    const snapshot: IntakeConversationsSnapshot = {
      syncedAt: new Date().toISOString(),
      startISO: start.toISOString(),
      endISO: end.toISOString(),
      byUser,
      unassignedCalls,
    };
    await writeIntakeConversations(locationKey, snapshot);

    return {
      location: locationKey,
      userCount: Object.keys(byUser).length,
      totalCalls,
      totalSms,
      unassignedCalls,
      durationMs: Date.now() - t0,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      location: locationKey,
      userCount: 0,
      totalCalls: 0,
      totalSms: 0,
      unassignedCalls: 0,
      durationMs: Date.now() - t0,
      error: msg.slice(0, 300),
    };
  }
}

export async function POST(req: Request) {
  if (!isCronRequest(req)) {
    const ok = await isAdminRequest();
    if (!ok) {
      return NextResponse.json(
        { error: "Cron secret or admin auth required" },
        { status: 401 }
      );
    }
  }

  const end = new Date();
  const start = new Date(end.getTime() - WINDOW_DAYS * 24 * 3600 * 1000);

  console.log(
    `[/api/sync/intake] starting walk ${start.toISOString()} -> ${end.toISOString()}`
  );

  // Run both locations in parallel -- they hit different GHL tokens, so no
  // contention on the per-location rate limit.
  const [a, p] = await Promise.all([
    runOneLocation("abogado", authAbogado(), start, end),
    runOneLocation("pplt_leads", authPplt(), start, end),
  ]);

  console.log(`[/api/sync/intake] abogado: ${JSON.stringify(a)}`);
  console.log(`[/api/sync/intake] pplt:    ${JSON.stringify(p)}`);

  return NextResponse.json({
    ok: !a.error && !p.error,
    startISO: start.toISOString(),
    endISO: end.toISOString(),
    abogado: a,
    pplt: p,
  });
}

// Support GET so Vercel cron's default GET handler works without
// a 405. Behaviour identical to POST.
export const GET = POST;
