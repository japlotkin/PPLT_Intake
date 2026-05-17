/**
 * GET /api/admin/users
 *
 * Admin-only. Lists Clerk users with their visibility config (if any).
 * Used by /admin to populate the user picker.
 */
import { NextResponse } from "next/server";
import { auth, currentUser, clerkClient } from "@clerk/nextjs/server";
import { listAllVisibility } from "@/lib/visibility";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const me = await currentUser();
  const myEmail = me?.primaryEmailAddress?.emailAddress?.toLowerCase();
  if (!env.isAdminEmail(myEmail)) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const client = await clerkClient();
  const list = await client.users.getUserList({ limit: 100 });
  const visibilities = await listAllVisibility();
  const byEmail = new Map(visibilities.map((v) => [v.email.toLowerCase(), v]));

  const users = list.data.map((u) => {
    const email = u.primaryEmailAddress?.emailAddress ?? "";
    const cfg = email ? byEmail.get(email.toLowerCase()) : undefined;
    return {
      id: u.id,
      email,
      firstName: u.firstName ?? "",
      lastName: u.lastName ?? "",
      isAdmin: env.isAdminEmail(email),
      hasConfig: Boolean(cfg),
      hiddenSectionCount: cfg ? cfg.hiddenSections.length : 0,
      hiddenSubsectionCount: cfg ? cfg.hiddenSubsections.length : 0,
    };
  });

  return NextResponse.json({ users });
}
