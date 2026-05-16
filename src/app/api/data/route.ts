/**
 * GET /api/data?preset=this_month
 *
 * Reads the snapshot for the requested preset from KV. The sync route
 * pre-computes snapshots for every preset in SYNCED_PRESETS.
 *
 * If the requested preset isn't pre-computed (or no snapshots exist),
 * readSnapshot falls back to "this_month".
 */
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { readSnapshot } from "@/lib/snapshotStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const url = new URL(req.url);
  const preset = url.searchParams.get("preset") || "this_month";

  const envelope = await readSnapshot(preset);
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
