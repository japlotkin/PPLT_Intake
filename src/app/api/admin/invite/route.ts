/**
 * POST /api/admin/invite { email, role?, restrictIntakeToOwnRow? }
 *   Sends a Clerk invitation email. Pre-seeds the user's visibility
 *   config if a role is supplied. Admin-only.
 *
 * GET  /api/admin/invite
 *   Lists pending invitations so the /admin UI can show "Invited but not
 *   yet accepted" rows. Admin-only.
 *
 * DELETE /api/admin/invite?invitationId=...
 *   Revoke a pending invitation. Admin-only.
 */
import { NextResponse } from "next/server";
import { auth, currentUser, clerkClient } from "@clerk/nextjs/server";
import { env } from "@/lib/env";
import {
  ROLE_PRESETS,
  writeVisibility,
  type Role,
  type VisibilityConfig,
} from "@/lib/visibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireAdminEmail(): Promise<string | null> {
  const { userId } = await auth();
  if (!userId) return null;
  const me = await currentUser();
  const email = me?.primaryEmailAddress?.emailAddress?.toLowerCase();
  if (!env.isAdminEmail(email)) return null;
  return email ?? null;
}

function baseUrl(req: Request): string {
  // Prefer the live host header (handles preview deploys correctly).
  const host = req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  return host ? `${proto}://${host}` : "https://pplt-intake.vercel.app";
}

export async function POST(req: Request) {
  const admin = await requireAdminEmail();
  if (!admin) return NextResponse.json({ error: "Admin only" }, { status: 403 });

  let body: {
    email?: unknown;
    role?: unknown;
    restrictIntakeToOwnRow?: unknown;
    notify?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = String(body.email ?? "").trim().toLowerCase();
  if (!email || !/^[^@]+@[^@]+\.[^@]+$/.test(email)) {
    return NextResponse.json({ error: "Valid email required" }, { status: 400 });
  }
  const role: Role | undefined =
    body.role === "manager" ||
    body.role === "staff" ||
    body.role === "vendor" ||
    body.role === "custom"
      ? body.role
      : undefined;
  const restrictIntakeToOwnRow = Boolean(body.restrictIntakeToOwnRow);

  // Pre-seed visibility config so the user's permissions take effect
  // the first time they sign in.
  if (role && role !== "custom") {
    const preset = ROLE_PRESETS[role];
    const cfg: VisibilityConfig = {
      email,
      role,
      hiddenSections: [...preset.hiddenSections],
      hiddenSubsections: [...preset.hiddenSubsections],
      restrictIntakeToOwnRow: preset.restrictIntakeToOwnRow,
      updatedAt: new Date().toISOString(),
      updatedBy: admin,
    };
    await writeVisibility(cfg).catch((e) => {
      console.error("[invite] visibility pre-seed failed:", e);
    });
  } else if (restrictIntakeToOwnRow) {
    const cfg: VisibilityConfig = {
      email,
      role: "custom",
      hiddenSections: [],
      hiddenSubsections: [],
      restrictIntakeToOwnRow: true,
      updatedAt: new Date().toISOString(),
      updatedBy: admin,
    };
    await writeVisibility(cfg).catch(() => {});
  }

  // notify=true (default) -> Clerk sends its own invitation email.
  // notify=false -> Clerk skips the email; we return the accept URL so
  //                  the admin can copy + forward it themselves
  //                  (avoids the spam-flagged @accounts.dev email).
  const notify = body.notify === false ? false : true;

  try {
    const client = await clerkClient();
    const invitation = await client.invitations.createInvitation({
      emailAddress: email,
      redirectUrl: `${baseUrl(req)}/sign-up`,
      notify,
      ignoreExisting: true,
    });
    // Clerk's invitation response includes a `url` field that the user
    // clicks to accept. When notify=false, this is the URL we hand to
    // the admin to forward.
    const inv = invitation as unknown as {
      id: string;
      emailAddress?: string;
      status?: string;
      url?: string;
      createdAt?: number;
    };
    return NextResponse.json({
      ok: true,
      invitation: {
        id: inv.id,
        emailAddress: inv.emailAddress,
        status: inv.status,
        url: inv.url,
        createdAt:
          typeof inv.createdAt === "number"
            ? new Date(inv.createdAt).toISOString()
            : null,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg.slice(0, 300) }, { status: 400 });
  }
}

export async function GET() {
  const admin = await requireAdminEmail();
  if (!admin) return NextResponse.json({ error: "Admin only" }, { status: 403 });

  try {
    const client = await clerkClient();
    const list = await client.invitations.getInvitationList({ limit: 200 });
    const invitations = list.data.map((i) => ({
      id: i.id,
      emailAddress: i.emailAddress,
      status: i.status,
      createdAt:
        typeof i.createdAt === "number"
          ? new Date(i.createdAt).toISOString()
          : null,
    }));
    return NextResponse.json({ invitations });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg.slice(0, 300) }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const admin = await requireAdminEmail();
  if (!admin) return NextResponse.json({ error: "Admin only" }, { status: 403 });

  const url = new URL(req.url);
  const invitationId = url.searchParams.get("invitationId");
  if (!invitationId) {
    return NextResponse.json({ error: "invitationId required" }, { status: 400 });
  }
  try {
    const client = await clerkClient();
    await client.invitations.revokeInvitation(invitationId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg.slice(0, 300) }, { status: 400 });
  }
}
