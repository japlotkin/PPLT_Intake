/**
 * GET /api/data?preset=this_month
 *
 * Reads the snapshot for the requested preset from KV, attaches the
 * current user's visibility config, and returns it.
 */
import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { readSnapshot } from "@/lib/snapshotStore";
import { env } from "@/lib/env";
import { readVisibility, toClientVisibility } from "@/lib/visibility";

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

  // Attach visibility for the current user
  const me = await currentUser();
  const myEmail = me?.primaryEmailAddress?.emailAddress ?? "";
  const cfg = myEmail ? await readVisibility(myEmail) : null;
  const visibility = toClientVisibility(cfg, myEmail, env.adminEmail());

  return NextResponse.json({
    ...envelope.data,
    syncedAt: envelope.syncedAt,
    syncDurationMs: envelope.durationMs,
    visibility,
  });
}
