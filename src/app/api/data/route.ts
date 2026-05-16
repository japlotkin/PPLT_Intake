/**
 * GET /api/data
 *
 * Read-only endpoint. Returns the latest snapshot from KV. The actual
 * GHL/Meta walking happens in /api/sync (cron-scheduled).
 *
 * If no snapshot exists yet (just provisioned KV, never synced), returns
 * 503 with a `needsSync: true` payload so the dashboard UI can show a
 * "Run sync" call to action.
 */
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { readSnapshot } from "@/lib/snapshotStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const envelope = await readSnapshot();
  if (!envelope) {
    return NextResponse.json(
      {
        needsSync: true,
        message:
          "No snapshot found yet. Click Refresh to run the first sync (takes ~60-120s).",
      },
      { status: 503 }
    );
  }

  return NextResponse.json({
    ...envelope.data,
    syncedAt: envelope.syncedAt,
    syncDurationMs: envelope.durationMs,
  });
}
