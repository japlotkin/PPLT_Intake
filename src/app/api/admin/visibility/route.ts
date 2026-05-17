/**
 * GET  /api/admin/visibility?email=<user>   -> read one user's config
 * PUT  /api/admin/visibility { email, hiddenSections, hiddenSubsections }
 *
 * Admin-only. The admin's own email cannot be restricted (force-allow on read).
 */
import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { env } from "@/lib/env";
import {
  readVisibility,
  writeVisibility,
  SECTION_IDS,
  SUBSECTIONS_BY_SECTION,
  type SectionId,
  type VisibilityConfig,
} from "@/lib/visibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireAdmin(): Promise<string | null> {
  const { userId } = await auth();
  if (!userId) return null;
  const me = await currentUser();
  const myEmail = me?.primaryEmailAddress?.emailAddress?.toLowerCase();
  if (!env.isAdminEmail(myEmail)) return null;
  return myEmail ?? null;
}

export async function GET(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Admin only" }, { status: 403 });

  const url = new URL(req.url);
  const email = url.searchParams.get("email");
  if (!email) return NextResponse.json({ error: "email param required" }, { status: 400 });

  const cfg = await readVisibility(email);
  return NextResponse.json({
    email,
    config: cfg ?? {
      email,
      hiddenSections: [],
      hiddenSubsections: [],
      updatedAt: "",
      updatedBy: "",
    },
  });
}

const VALID_SUBSECTIONS = new Set<string>();
for (const sec of SECTION_IDS) {
  for (const sub of SUBSECTIONS_BY_SECTION[sec]) {
    VALID_SUBSECTIONS.add(`${sec}.${sub}`);
  }
}

export async function PUT(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Admin only" }, { status: 403 });

  let body: { email?: string; hiddenSections?: unknown; hiddenSubsections?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const email = (body.email ?? "").toString().toLowerCase();
  if (!email) return NextResponse.json({ error: "email required" }, { status: 400 });
  if (env.isAdminEmail(email)) {
    return NextResponse.json(
      { error: "Cannot restrict an admin account" },
      { status: 400 }
    );
  }

  const hiddenSections = (Array.isArray(body.hiddenSections) ? body.hiddenSections : [])
    .filter((s): s is SectionId => SECTION_IDS.includes(s as SectionId));
  const hiddenSubsections = (Array.isArray(body.hiddenSubsections)
    ? body.hiddenSubsections
    : []
  ).filter((s): s is string => typeof s === "string" && VALID_SUBSECTIONS.has(s));

  const cfg: VisibilityConfig = {
    email,
    hiddenSections,
    hiddenSubsections,
    updatedAt: new Date().toISOString(),
    updatedBy: admin,
  };
  await writeVisibility(cfg);
  return NextResponse.json({ ok: true, config: cfg });
}
