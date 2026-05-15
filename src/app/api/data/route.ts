/**
 * GET /api/data?preset=this_month&start=YYYY-MM-DD&end=YYYY-MM-DD
 *
 * Returns the full DashboardData payload, cached for one hour per range
 * via Vercel KV (or in-process Map locally).
 */
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { withCache, ONE_HOUR_SECONDS } from "@/lib/cache";
import { rangeFor, customRange, type Preset } from "@/lib/dateRanges";
import { overview } from "@/lib/metrics/overview";
import { kpiTable } from "@/lib/metrics/kpi";
import { leadAnalyticsForBucket } from "@/lib/metrics/leadAnalytics";
import { intakeTeamMetrics } from "@/lib/metrics/intakeTeam";
import { caseAnalytics } from "@/lib/metrics/caseAnalytics";
import { emailMetricsByBucket } from "@/lib/metrics/email";
import type { DashboardData } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const url = new URL(req.url);
  const preset = (url.searchParams.get("preset") || "this_month") as Preset;
  const startISO = url.searchParams.get("start") ?? undefined;
  const endISO = url.searchParams.get("end") ?? undefined;

  const range =
    preset === "custom" && startISO && endISO
      ? customRange(startISO, endISO)
      : rangeFor(preset);

  const cacheKey = `dash:v1:${preset}:${range.start.toISOString()}:${range.end.toISOString()}`;

  try {
    const data = await withCache<DashboardData>(cacheKey, ONE_HOUR_SECONDS, async () => {
      const warnings: string[] = [];
      const [
        overviewData,
        kpi,
        leadsSpanish,
        leadsEnglish,
        intakeTeam,
        cases,
        email,
      ] = await Promise.all([
        overview(),
        kpiTable(),
        leadAnalyticsForBucket("spanish", range.start, range.end),
        leadAnalyticsForBucket("english", range.start, range.end),
        intakeTeamMetrics(range.start, range.end),
        caseAnalytics(),
        emailMetricsByBucket(range.start, range.end),
      ]);
      if (overviewData.reviews.lifetime === 0) {
        warnings.push(
          "Google review counts unavailable — GHL reputation endpoint did not return data."
        );
      }
      if (email.every((b) => b.sends === 0 && b.opens === 0)) {
        warnings.push(
          "Email metrics unavailable — GHL email events endpoint did not return data on this plan."
        );
      }
      return {
        generatedAt: new Date().toISOString(),
        range: {
          label: range.label,
          start: range.start.toISOString(),
          end: range.end.toISOString(),
        },
        overview: overviewData,
        kpi,
        email,
        leadsEnglish,
        leadsSpanish,
        intakeTeam,
        cases,
        warnings,
      };
    });
    return NextResponse.json(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
