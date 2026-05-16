/**
 * GET /api/mock-data
 *
 * Returns a hand-crafted DashboardData payload so you can preview the
 * dashboard UI without hitting GHL/Meta. Useful for: design review,
 * iterating on charts/tables/copy, and seeing all the empty-state and
 * warning paths without breaking anything in production.
 *
 * The dashboard page reads ?demo=1 from the URL and points at /api/mock-data
 * instead of /api/data.
 */
import { NextResponse } from "next/server";
import type { DashboardData } from "@/lib/types";

export const runtime = "nodejs";

const fixture: DashboardData = {
  generatedAt: new Date().toISOString(),
  range: { label: "This Month", start: "", end: "" },
  overview: {
    leadsMonth: { current: 412, previous: 358, pctChange: 15.1, direction: "up" },
    leadsWeek: { current: 94, previous: 102, pctChange: -7.8, direction: "down" },
    referralsMonth: { current: 87, previous: 71, pctChange: 22.5, direction: "up" },
    referralsWeek: { current: 19, previous: 24, pctChange: -20.8, direction: "down" },
    signedMonth: { current: 41, previous: 38, pctChange: 7.9, direction: "up" },
    signedWeek: { current: 8, previous: 11, pctChange: -27.3, direction: "down" },
    activeTotal: 1247,
    reviews: {
      week: 6,
      month: 28,
      year: 312,
      lifetime: 2841,
      perProfile: [
        { name: "Pinder Plotkin Baltimore", lifetime: 1402 },
        { name: "Pinder Plotkin Laurel", lifetime: 743 },
        { name: "Pinder Plotkin Bel Air", lifetime: 391 },
        { name: "Abogado Attorney", lifetime: 305 },
      ],
    },
  },
  kpi: {
    months: [
      kpiBlock("May 2026", { leads: 412, ref: 87, sig: 41 }, { leads: 268, ref: 54, sig: 28 }),
      kpiBlock("Apr 2026", { leads: 358, ref: 71, sig: 38 }, { leads: 241, ref: 49, sig: 25 }),
      kpiBlock("Mar 2026", { leads: 401, ref: 82, sig: 44 }, { leads: 289, ref: 61, sig: 31 }),
    ],
    quarters: [
      kpiBlock("Q2 2026", { leads: 770, ref: 158, sig: 79 }, { leads: 509, ref: 103, sig: 53 }),
      kpiBlock("Q1 2026", { leads: 1148, ref: 234, sig: 124 }, { leads: 802, ref: 170, sig: 89 }),
    ],
  },
  email: [
    { bucket: "english", sends: 8742, opens: 3201, clicks: 482, replies: 71, unsubscribes: 18, signedWithin30dOfReply: 9 },
    { bucket: "spanish", sends: 4128, opens: 1503, clicks: 211, replies: 34, unsubscribes: 7, signedWithin30dOfReply: 4 },
  ],
  leadsEnglish: {
    sourceMix: [
      { source: "Facebook Lead Ads", count: 187 },
      { source: "Google Ads", count: 91 },
      { source: "Settlement Calculator", count: 54 },
      { source: "Direct / Unknown", count: 41 },
      { source: "Referral", count: 26 },
      { source: "Organic", count: 13 },
    ],
    byStatus: [
      { status: "Lead", count: 89 },
      { status: "Active", count: 142 },
      { status: "Signed", count: 41 },
      { status: "Referred Out", count: 87 },
      { status: "Closed / Lost", count: 33 },
      { status: "Withdrawn", count: 20 },
    ],
    conversionRatePct: 9.95,
    avgDaysToSigned: 6.2,
  },
  leadsSpanish: {
    sourceMix: [
      { source: "Facebook", count: 134 },
      { source: "Facebook Lead Ads", count: 71 },
      { source: "Direct / Unknown", count: 38 },
      { source: "Consultation Form", count: 19 },
      { source: "Referral", count: 6 },
    ],
    byStatus: [
      { status: "Lead", count: 54 },
      { status: "Active", count: 81 },
      { status: "Signed", count: 28 },
      { status: "Referred Out", count: 54 },
      { status: "Closed / Lost", count: 35 },
      { status: "Withdrawn", count: 16 },
    ],
    conversionRatePct: 10.45,
    avgDaysToSigned: 5.8,
  },
  intakeTeam: [
    intakeRow("Natasha Saunders", "clientcare2@pinderplotkin.com", 22, 11, 142, 89, 67, 32),
    intakeRow("Angelina Cedeno", "clientcare3@pinderplotkin.com", 19, 9, 128, 71, 54, 28),
    intakeRow("Jose Hernandez", "clientcare6@pinderplotkin.com", 17, 8, 119, 64, 48, 26),
    intakeRow("Katherina Abdul Mesih", "Clientcare7@pinderplotkin.com", 15, 7, 102, 58, 41, 22),
    intakeRow("Roger Santana", "clientcare14@pinderplotkin.com", 14, 6, 98, 52, 38, 20),
    intakeRow("Carlos Silva", "clientcare15@pinderplotkin.com", 12, 5, 87, 47, 32, 18),
    intakeRow("Natalia Rojas", "clientcare16@pinderplotkin.com", 11, 4, 81, 43, 28, 16),
    intakeRow("Natasha Zapata", "clientcare17@pinderplotkin.com", 10, 4, 74, 39, 25, 14),
    intakeRow("Dalia Hernandez", "clientcare18@pinderplotkin.com", 8, 3, 65, 34, 21, 12),
  ],
  cases: {
    byPracticeArea: [
      { area: "Auto", count: 542 },
      { area: "Workers' Comp", count: 287 },
      { area: "Personal Injury (general)", count: 184 },
      { area: "Dog Bite", count: 76 },
      { area: "Mass Tort: Ultra Processed Foods", count: 54 },
      { area: "Mass Tort: Hair Relaxer", count: 38 },
      { area: "Disability", count: 31 },
      { area: "Other (in-house)", count: 22 },
      { area: "Other", count: 13 },
    ],
    byStatus: [
      { status: "Active", count: 894 },
      { status: "Lead", count: 187 },
      { status: "Signed", count: 142 },
      { status: "Referred Out", count: 24 },
    ],
    byCoCounsel: [
      { firm: "Pond Lehocky", count: 38 },
      { firm: "Morgan & Morgan", count: 27 },
      { firm: "Whitlock", count: 21 },
      { firm: "Pisano BSG", count: 18 },
      { firm: "Plevin & Gallucci", count: 15 },
      { firm: "Commonwealth", count: 14 },
      { firm: "Sawaya / Wilhite Law", count: 11 },
      { firm: "Robinson Law", count: 9 },
      { firm: "Lexamica", count: 8 },
      { firm: "Lowe Group", count: 7 },
    ],
    byState: [
      { state: "MD", count: 824 },
      { state: "DC", count: 142 },
      { state: "VA", count: 87 },
      { state: "PA", count: 54 },
      { state: "NJ", count: 38 },
      { state: "NY", count: 24 },
      { state: "DE", count: 18 },
      { state: "WV", count: 11 },
      { state: "OH", count: 9 },
      { state: "FL", count: 6 },
    ],
  },
  warnings: [
    "DEMO MODE — these numbers are hand-crafted fixtures so you can preview the UI without waiting for the GHL/Meta cold-cache load. Add ?demo=0 (or just visit /dashboard normally) for real data.",
  ],
};

function kpiBlock(
  title: string,
  en: { leads: number; ref: number; sig: number },
  es: { leads: number; ref: number; sig: number }
) {
  const tl = en.leads + es.leads;
  const tr = en.ref + es.ref;
  const ts = en.sig + es.sig;
  const f = (n: number) => n.toLocaleString();
  const p = (n: number, d: number) => (d === 0 ? "0.0%" : `${((n / d) * 100).toFixed(1)}%`);
  return {
    title,
    rows: [
      { label: "Leads In (Online)", spanish: f(es.leads), english: f(en.leads), total: f(tl) },
      { label: "Referred Out", spanish: f(es.ref), english: f(en.ref), total: f(tr) },
      { label: "Signed", spanish: f(es.sig), english: f(en.sig), total: f(ts) },
      { label: "% Referred Out vs Leads In", spanish: p(es.ref, es.leads), english: p(en.ref, en.leads), total: p(tr, tl) },
      { label: "% Signed vs Referred Out", spanish: p(es.sig, es.ref), english: p(en.sig, en.ref), total: p(ts, tr) },
      { label: "% Signed vs Leads In", spanish: p(es.sig, es.leads), english: p(en.sig, en.leads), total: p(ts, tl) },
    ],
  };
}

function intakeRow(
  name: string,
  email: string,
  referrals: number,
  signed: number,
  cIn: number,
  cOut: number,
  sms: number,
  active: number
) {
  return {
    userId: email,
    name,
    email,
    referrals,
    signedFromReferrals: signed,
    callsInbound: cIn,
    callsOutbound: cOut,
    sms,
    avgPickupSeconds: 12 + Math.random() * 6,
    referralsMonth: { current: referrals, previous: Math.max(0, referrals - 4), pctChange: 18.2, direction: "up" as const },
    referralsWeek: { current: Math.floor(referrals / 4), previous: Math.max(0, Math.floor(referrals / 4) - 1), pctChange: 9.1, direction: "up" as const },
    signedMonth: { current: signed, previous: Math.max(0, signed - 2), pctChange: 25.0, direction: "up" as const },
    signedWeek: { current: Math.floor(signed / 4), previous: Math.max(0, Math.floor(signed / 4)), pctChange: 0, direction: "flat" as const },
    activeFromReferrals: active,
  };
}

export async function GET() {
  return NextResponse.json({
    ...fixture,
    generatedAt: new Date().toISOString(),
  });
}
