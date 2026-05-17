/**
 * Middleware:
 *   1. Always-open routes (gate, sign-in/up, demo, crons, onboarding).
 *   2. Anyone with a valid Clerk session SKIPS the gate -- a real
 *      authenticated user is by definition trusted, the firm-wide gate
 *      password is a fallback for unauthenticated access only.
 *   3. Invitation links (__clerk_ticket query param) bypass the gate so
 *      invited users don't need the firm password to complete sign-up.
 *   4. Everything else requires gate + Clerk session.
 *
 * Static assets are excluded at the config.matcher level.
 */
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { GATE_COOKIE, verifyCookieValue } from "@/lib/gate";

const isGateRoute = createRouteMatcher(["/gate", "/api/gate"]);
const isSignInRoute = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)"]);
const isApiRoute = createRouteMatcher(["/api/(.*)"]);
const isDemoRoute = createRouteMatcher(["/demo", "/api/mock-data", "/onboarding"]);
const isCronRoute = createRouteMatcher(["/api/sync", "/api/sync/intake"]);

export default clerkMiddleware(async (auth, req) => {
  // Pure open routes that NEVER need gate or Clerk.
  if (isGateRoute(req) || isDemoRoute(req) || isCronRoute(req)) {
    return NextResponse.next();
  }

  // Invitation flow: clerk attaches __clerk_ticket=... to the sign-up
  // URL it emails. When present we skip the gate so invited users don't
  // need the firm password.
  const hasInvitationTicket = Boolean(req.nextUrl.searchParams.get("__clerk_ticket"));

  // A signed-in user is trusted -- skip the gate.
  const { userId } = await auth();
  if (userId) {
    // Sign-in pages with an existing session: just route through.
    if (isSignInRoute(req)) return NextResponse.next();
    return NextResponse.next();
  }

  // Sign-in / sign-up pages must be accessible to invited users without
  // the gate cookie (they come in via Clerk's emailed ticket).
  if (isSignInRoute(req) && hasInvitationTicket) {
    return NextResponse.next();
  }

  // From here: unauthenticated, not on an open route, no invitation
  // ticket -> the firm gate applies.
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

  // Gate passed, no Clerk session, on a non-sign-in page -> send to sign-in.
  if (isSignInRoute(req) || isApiRoute(req)) return NextResponse.next();
  const url = new URL("/sign-in", req.url);
  return NextResponse.redirect(url);
});

export const config = {
  // Run on every route except Next internals and anything with a file
  // extension (svg, png, css, js, etc -- served straight from /public).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
