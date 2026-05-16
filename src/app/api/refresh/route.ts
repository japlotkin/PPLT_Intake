/**
 * POST /api/refresh — admin-only manual sync trigger.
 *
 * Calls computeDashboardData() inline and writes a fresh snapshot. Returns
 * 200 only after the sync completes, so the dashboard's Refresh button can
 * show "Refreshed in 47s" or similar.
 */
import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { computeDashboardData } from "@/lib/dashboardCompute";
import { writeSnapshot } from "@/lib/snapshotStore";
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
  if (email !== env.adminEmail()) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const t0 = Date.now();
  try {
    const data = await computeDashboardData();
    const durationMs = Date.now() - t0;
    await writeSnapshot({
      data,
      syncedAt: new Date().toISOString(),
      durationMs,
    });
    return NextResponse.json({
      ok: true,
      durationMs,
      syncedAt: new Date().toISOString(),
      warnings: data.warnings,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
