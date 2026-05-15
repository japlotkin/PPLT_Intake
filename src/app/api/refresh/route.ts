/**
 * POST /api/refresh — admin-only cache bust.
 * Clears all dash:* keys. The next /api/data call repopulates fresh.
 */
import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { cacheClearAll } from "@/lib/cache";
import { env } from "@/lib/env";

export const runtime = "nodejs";

export async function POST() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const user = await currentUser();
  const userEmail = user?.primaryEmailAddress?.emailAddress?.toLowerCase();
  if (userEmail !== env.adminEmail()) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }
  const cleared = await cacheClearAll();
  return NextResponse.json({ cleared });
}
