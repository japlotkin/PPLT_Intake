/**
 * GET /api/admin/kpi-history?months=12
 *
 * Admin-only. Walks contacts + opps the requested number of months back
 * and returns a CSV of monthly KPI rollups (Spanish/English/Total leads,
 * referred, signed + the three ratios).
 *
 * Slow on first call (60-120s on cold cache) — admin-only so that's OK.
 * Reads from the in-process streamContacts / streamOpportunities memos
 * are bypassed here because we walk further back than they go.
 */
import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { kpiHistory } from "@/lib/metrics/kpiHistory";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const me = await currentUser();
  const myEmail = me?.primaryEmailAddress?.emailAddress?.toLowerCase();
  if (!env.isAdminEmail(myEmail)) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const url = new URL(req.url);
  const months = Math.max(1, Math.min(36, Number(url.searchParams.get("months") || 12)));
  const rows = await kpiHistory(months);

  const headers = [
    "Month",
    "Spanish Leads",
    "English Leads",
    "Total Leads",
    "Spanish Referred Out",
    "English Referred Out",
    "Total Referred Out",
    "Spanish Signed",
    "English Signed",
    "Total Signed",
    "% Referred Out vs Leads In",
    "% Signed vs Referred Out",
    "% Signed vs Leads In",
  ];
  const escape = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines: string[] = [headers.map(escape).join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.monthLabel,
        r.spanishLeads,
        r.englishLeads,
        r.totalLeads,
        r.spanishReferred,
        r.englishReferred,
        r.totalReferred,
        r.spanishSigned,
        r.englishSigned,
        r.totalSigned,
        r.pctReferredVsLeads.toFixed(2) + "%",
        r.pctSignedVsReferred.toFixed(2) + "%",
        r.pctSignedVsLeads.toFixed(2) + "%",
      ]
        .map(escape)
        .join(",")
    );
  }
  const csv = "﻿" + lines.join("\n");

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="kpi-history-${months}mo-${new Date()
        .toISOString()
        .slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
