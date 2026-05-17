/**
 * POST /api/refresh — admin-only manual sync trigger.
 *
 * Runs computeDashboardData for every preset and writes per-preset
 * snapshots. Returns 200 after all snapshots are written so the
 * dashboard's Refresh button can show "Refreshed in 47s".
 */
import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { computeDashboardData } from "@/lib/dashboardCompute";
import { writeSnapshot, SYNCED_PRESETS } from "@/lib/snapshotStore";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress?.toLowerCase();
  if (!env.isAdminEmail(email)) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const t0 = Date.now();
  let totalWarnings = 0;
  try {
    for (const preset of SYNCED_PRESETS) {
      const pT0 = Date.now();
      const data = await computeDashboardData({ preset });
      totalWarnings += data.warnings.length;
      await writeSnapshot(preset, {
        data,
        syncedAt: new Date().toISOString(),
        durationMs: Date.now() - pT0,
      });
    }
    return NextResponse.json({
      ok: true,
      durationMs: Date.now() - t0,
      syncedAt: new Date().toISOString(),
      presetsSynced: SYNCED_PRESETS.length,
      totalWarnings,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
