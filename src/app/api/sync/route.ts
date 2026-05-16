/**
 * POST /api/sync
 *
 * Runs the full GHL + Meta walk and writes the resulting DashboardData
 * to KV. Triggered by:
 *   - Vercel Cron every 30 minutes (uses Authorization: Bearer $CRON_SECRET)
 *   - Manually by an admin via /api/refresh (forwards the user's cookies)
 *
 * Body is ignored; the snapshot is always range-agnostic so all date-picker
 * presets render from the same payload (current month overview etc.)
 */
import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { computeDashboardData } from "@/lib/dashboardCompute";
import { writeSnapshot } from "@/lib/snapshotStore";
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
  return email === env.adminEmail();
}

export async function POST(req: Request) {
  if (!isCronRequest(req)) {
    const ok = await isAdminRequest();
    if (!ok) {
      return NextResponse.json({ error: "Cron secret or admin auth required" }, { status: 401 });
    }
  }

  const t0 = Date.now();
  console.log(`[/api/sync] starting (${isCronRequest(req) ? "cron" : "admin"})`);

  try {
    const data = await computeDashboardData();
    const durationMs = Date.now() - t0;
    await writeSnapshot({
      data,
      syncedAt: new Date().toISOString(),
      durationMs,
    });
    console.log(`[/api/sync] complete in ${durationMs}ms (${data.warnings.length} warnings)`);
    return NextResponse.json({
      ok: true,
      durationMs,
      syncedAt: new Date().toISOString(),
      warnings: data.warnings,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[/api/sync] failed after ${Date.now() - t0}ms:`, msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// Vercel Cron sends GET requests, not POST. Accept both.
export async function GET(req: Request) {
  return POST(req);
}
