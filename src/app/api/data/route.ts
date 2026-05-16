/**
 * GET /api/data?preset=this_month&start=YYYY-MM-DD&end=YYYY-MM-DD
 *
 * Returns the full DashboardData payload, cached for one hour per range
 * via Vercel KV (or in-process Map locally).
 *
 * Per-section settled fetching: if one section fails (rate limit, plan
 * limit on emails/reviews, transient API error) the rest of the dashboard
 * still renders and the failure shows up as a warning at the top.
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
import type {
  CaseAnalytics,
  DashboardData,
  EmailMetrics,
  IntakeMemberMetrics,
  KpiBlock,
  LeadAnalytics,
  OverviewData,
} from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

function emptyOverview(): OverviewData {
  const z = { current: 0, previous: 0, pctChange: 0, direction: "flat" as const };
  return {
    leadsMonth: z,
    leadsWeek: z,
    referralsMonth: z,
    referralsWeek: z,
    signedMonth: z,
    signedWeek: z,
    activeTotal: 0,
    reviews: { week: 0, month: 0, year: 0, lifetime: 0, perProfile: [] },
  };
}

function emptyLead(): LeadAnalytics {
  return { sourceMix: [], byStatus: [], conversionRatePct: 0, avgDaysToSigned: null };
}

function emptyCases(): CaseAnalytics {
  return { byPracticeArea: [], byStatus: [], byCoCounsel: [], byState: [] };
}

async function settled<T>(label: string, fn: () => Promise<T>, fallback: T, warnings: string[]): Promise<T> {
  const t0 = Date.now();
  try {
    const r = await fn();
    console.log(`[/api/data] ${label} ok in ${Date.now() - t0}ms`);
    return r;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[/api/data] ${label} failed after ${Date.now() - t0}ms:`, msg.slice(0, 300));
    warnings.push(`${label} failed: ${msg.slice(0, 200)}`);
    return fallback;
  }
}

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

  const cacheKey = `dash:v2:${preset}:${range.start.toISOString()}:${range.end.toISOString()}`;

  try {
    const data = await withCache<DashboardData>(cacheKey, ONE_HOUR_SECONDS, async () => {
      const warnings: string[] = [];

      const [overviewData, kpi, leadsSpanish, leadsEnglish, intakeTeam, cases, email] =
        await Promise.all([
          settled<OverviewData>("Overview", () => overview(), emptyOverview(), warnings),
          settled<{ months: KpiBlock[]; quarters: KpiBlock[] }>(
            "KPI table",
            () => kpiTable(),
            { months: [], quarters: [] },
            warnings
          ),
          settled<LeadAnalytics>(
            "Spanish lead analytics",
            () => leadAnalyticsForBucket("spanish", range.start, range.end),
            emptyLead(),
            warnings
          ),
          settled<LeadAnalytics>(
            "English lead analytics",
            () => leadAnalyticsForBucket("english", range.start, range.end),
            emptyLead(),
            warnings
          ),
          settled<IntakeMemberMetrics[]>(
            "Intake team",
            () => intakeTeamMetrics(range.start, range.end),
            [],
            warnings
          ),
          settled<CaseAnalytics>("Case analytics", () => caseAnalytics(), emptyCases(), warnings),
          settled<EmailMetrics[]>(
            "Email metrics",
            () => emailMetricsByBucket(range.start, range.end),
            [],
            warnings
          ),
        ]);

      if (overviewData.reviews.lifetime === 0 && overviewData.reviews.perProfile.length === 0) {
        warnings.push(
          "Google review counts unavailable — GHL reputation endpoint did not return data."
        );
      }
      if (email.length === 0 || email.every((b) => b.sends === 0 && b.opens === 0)) {
        warnings.push(
          "Email metrics unavailable or zero — GHL email events endpoint did not return data on this plan."
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
