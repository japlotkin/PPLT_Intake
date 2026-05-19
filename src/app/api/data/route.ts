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
    // Don't fall back silently to this_month -- that hides the fact
    // that the date-picker change wasn't actually applied. Give the
    // admin a clear path.
    return NextResponse.json(
      {
        needsSync: true,
        preset,
        message:
          preset === "this_month"
            ? "No snapshot found yet. Click Refresh to run the first sync (takes ~60–120s)."
            : `Snapshot for "${preset}" hasn't been pre-synced yet. Click Refresh to run a sync (it'll compute all presets) or switch to "This Month" / "Last Month" / one of the other rolling windows.`,
      },
      { status: 503 }
    );
  }

  // Attach visibility for the current user
  const me = await currentUser();
  const myEmail = me?.primaryEmailAddress?.emailAddress ?? "";
  const cfg = myEmail ? await readVisibility(myEmail) : null;
  const visibility = toClientVisibility(cfg, myEmail, env.isAdminEmail(myEmail));

  // If the user is restricted to their own intake row, filter the
  // intakeTeam arrays before returning. Done here on the server so
  // peer numbers never reach the client.
  let payload = envelope.data;
  if (visibility.restrictIntakeToOwnRow) {
    const onlyMine = (rows?: typeof payload.intakeTeam) =>
      (rows ?? []).filter(
        (r) => r.email?.toLowerCase() === myEmail.toLowerCase()
      );
    payload = {
      ...payload,
      intakeTeam: onlyMine(payload.intakeTeam),
      intakeTeamEnglish: payload.intakeTeamEnglish
        ? onlyMine(payload.intakeTeamEnglish)
        : payload.intakeTeamEnglish,
      intakeTeamSpanish: payload.intakeTeamSpanish
        ? onlyMine(payload.intakeTeamSpanish)
        : payload.intakeTeamSpanish,
    };
  }

  return NextResponse.json({
    ...payload,
    syncedAt: envelope.syncedAt,
    syncDurationMs: envelope.durationMs,
    visibility,
  });
}
