/**
 * Middleware:
 *   1. /gate is open (the password entry page itself).
 *   2. /api/gate accepts password POSTs.
 *   3. /sign-in is open (Clerk's sign-in page).
 *   4. Every other route requires the gate cookie AND a Clerk session.
 *
 * Static assets are excluded at the config.matcher level (anything with a
 * file extension or under /_next is skipped before we run).
 */
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { GATE_COOKIE, verifyCookieValue } from "@/lib/gate";

const isGateRoute = createRouteMatcher(["/gate", "/api/gate"]);
const isSignInRoute = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)"]);
const isApiRoute = createRouteMatcher(["/api/(.*)"]);
// Demo route + its data endpoint render a hand-crafted fixture so the UI can
// be previewed without GHL/Meta data, gate password, or a Clerk session.
const isDemoRoute = createRouteMatcher(["/demo", "/api/mock-data"]);

export default clerkMiddleware(async (auth, req) => {
  if (isGateRoute(req) || isDemoRoute(req)) return NextResponse.next();

  // 1. Gate check applies to everything else, including API routes.
  // (Without a valid firm password cookie, we won't expose any data.)
  const cookie = req.cookies.get(GATE_COOKIE)?.value;
  const gatePassed = await verifyCookieValue(cookie);
  if (!gatePassed) {
    if (isApiRoute(req)) {
      return NextResponse.json(
        { error: "Gate cookie missing" },
        { status: 401 }
      );
    }
    const url = new URL("/gate", req.url);
    url.searchParams.set("next", req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(url);
  }

  // 2. /sign-in renders without a Clerk session. API routes do their own
  // Clerk auth check so they return JSON 401 (not an HTML redirect).
  if (isSignInRoute(req) || isApiRoute(req)) return NextResponse.next();

  // 3. Pages require a Clerk session; redirect to /sign-in if missing.
  const { userId } = await auth();
  if (!userId) {
    const url = new URL("/sign-in", req.url);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
});

export const config = {
  // Run on every route except Next internals and anything with a file
  // extension (svg, png, css, js, etc -- served straight from /public).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
