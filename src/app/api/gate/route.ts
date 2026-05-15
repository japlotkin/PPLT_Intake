/**
 * POST /api/gate
 * Body: { password: string }
 * Returns 200 with Set-Cookie on success, 401 otherwise.
 */
import { NextResponse } from "next/server";
import { GATE_COOKIE, makeCookieValue, passwordMatches } from "@/lib/gate";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { password?: string };
    const password = (body.password ?? "").toString();
    if (!password) {
      return NextResponse.json({ error: "Password required" }, { status: 400 });
    }
    const ok = await passwordMatches(password);
    if (!ok) {
      return NextResponse.json(
        { error: "Incorrect password" },
        { status: 401 }
      );
    }
    const { value, maxAgeSeconds } = await makeCookieValue();
    const res = NextResponse.json({ ok: true });
    res.cookies.set(GATE_COOKIE, value, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: maxAgeSeconds,
    });
    return res;
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
}
