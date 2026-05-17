/**
 * POST /api/sync
 *
 * For each pre-defined date-picker preset, run computeDashboardData and
 * write a per-preset snapshot to KV. Range-independent sections (Overview,
 * KPI, Cases) compute once per preset but reuse the per-process memo for
 * the underlying opportunity + contact walks, so total GHL traffic is
 * one walk per location, not eight.
 *
 * Triggered by:
 *   - Vercel Cron every 30 minutes (uses Authorization: Bearer $CRON_SECRET)
 *   - Manually by an admin via /api/refresh (Clerk session check inside)
 */
import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { computeDashboardData } from "@/lib/dashboardCompute";
import { writeSnapshot, SYNCED_PRESETS } from "@/lib/snapshotStore";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function isCronRequest(req: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  const got = req.headers.get("authorization");
  return got === `Bearer ${cronSecret}`;
}

async function isAdminRequest(): Promise<boolean> {
  const { userId } = await auth();
  if (!userId) return false;
  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress?.toLowerCase();
  return env.isAdminEmail(email);
}

export async function POST(req: Request) {
  if (!isCronRequest(req)) {
    const ok = await isAdminRequest();
    if (!ok) {
      return NextResponse.json({ error: "Cron secret or admin auth required" }, { status: 401 });
    }
  }

  const t0 = Date.now();
  console.log(`[/api/sync] starting (${isCronRequest(req) ? "cron" : "admin"}) for ${SYNCED_PRESETS.length} presets`);
  const perPresetMs: Record<string, number> = {};
  let totalWarnings = 0;

  try {
    for (const preset of SYNCED_PRESETS) {
      const pT0 = Date.now();
      const data = await computeDashboardData({ preset });
      const pMs = Date.now() - pT0;
      perPresetMs[preset] = pMs;
      totalWarnings += data.warnings.length;
      await writeSnapshot(preset, {
        data,
        syncedAt: new Date().toISOString(),
        durationMs: pMs,
      });
      console.log(`[/api/sync] preset=${preset} done in ${pMs}ms (${data.warnings.length} warnings)`);
    }
    const totalMs = Date.now() - t0;
    console.log(`[/api/sync] complete in ${totalMs}ms, ${SYNCED_PRESETS.length} presets`);
    return NextResponse.json({
      ok: true,
      durationMs: totalMs,
      perPresetMs,
      syncedAt: new Date().toISOString(),
      totalWarnings,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[/api/sync] failed after ${Date.now() - t0}ms:`, msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// Vercel Cron sends GET requests, not POST.
export async function GET(req: Request) {
  return POST(req);
}
