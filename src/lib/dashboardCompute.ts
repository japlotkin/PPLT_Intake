/**
 * The heavy work: walk GHL + Meta, build a DashboardData payload.
 *
 * This module is the SINGLE place that does live API fetching. It is called
 * by /api/sync (background cron). Synchronous page loads NEVER call this —
 * they read the latest snapshot from KV via snapshotStore.ts.
 *
 * If a section fails or times out, it resolves to an empty fallback and the
 * failure is captured in `warnings`. One slow GHL endpoint can't kill the
 * whole snapshot.
 */
import { authAbogado, authPplt } from "./ghl/client";
import { streamOpportunities } from "./ghl/opportunities";
import { streamContacts } from "./ghl/contacts";
import { rangeFor, customRange, type Preset } from "./dateRanges";
import { overview } from "./metrics/overview";
import { kpiTable } from "./metrics/kpi";
import { leadAnalyticsForBucket } from "./metrics/leadAnalytics";
import { intakeTeamMetrics } from "./metrics/intakeTeam";
import { caseAnalytics } from "./metrics/caseAnalytics";
import { costAnalytics } from "./metrics/costAnalytics";
import type {
  CaseAnalytics,
  CostAnalyticsPayload,
  DashboardData,
  IntakeMemberMetrics,
  KpiBlock,
  LeadAnalytics,
  OverviewData,
} from "./types";

const SECTION_TIMEOUT_MS = 240_000; // 4 minutes per section — sections all share the same memoized walks once pre-warm finishes
const PREWARM_TIMEOUT_MS = 270_000; // 4.5 minutes for the underlying GHL opp + contact walks

function emptyOverview(): OverviewData {
  const z = { current: 0, previous: 0, pctChange: 0, direction: "flat" as const };
  return {
    leads30: z,
    leads7: z,
    referrals30: z,
    referrals7: z,
    signed30: z,
    signed7: z,
    activeTotal: 0,
    reviews: { week: 0, month: 0, year: 0, lifetime: 0, perProfile: [] },
  };
}
function emptyLead(): LeadAnalytics {
  return { sourceMix: [], byStatus: [], conversionRatePct: 0, avgDaysToSigned: null };
}
function emptyCases(): CaseAnalytics {
  return { byPracticeArea: [], byCoCounsel: [], byCoCounselSigned: [], byState: [] };
}

async function settled<T>(
  label: string,
  fn: () => Promise<T>,
  fallback: T,
  warnings: string[],
  timeoutMs = SECTION_TIMEOUT_MS,
  log: (msg: string) => void = console.log
): Promise<T> {
  const t0 = Date.now();
  try {
    const r = await Promise.race<T>([
      fn(),
      new Promise<T>((_, rej) =>
        setTimeout(() => rej(new Error(`section timed out after ${timeoutMs / 1000}s`)), timeoutMs)
      ),
    ]);
    log(`[compute] ${label} ok in ${Date.now() - t0}ms`);
    return r;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[compute] ${label} failed after ${Date.now() - t0}ms:`, msg.slice(0, 300));
    warnings.push(`${label}: ${msg.slice(0, 200)}`);
    return fallback;
  }
}

export interface ComputeOptions {
  preset?: Preset;
  startISO?: string;
  endISO?: string;
  log?: (msg: string) => void;
}

export async function computeDashboardData(opts: ComputeOptions = {}): Promise<DashboardData> {
  const preset: Preset = opts.preset ?? "this_month";
  const log = opts.log ?? console.log;
  const range =
    preset === "custom" && opts.startISO && opts.endISO
      ? customRange(opts.startISO, opts.endISO)
      : rangeFor(preset);

  const warnings: string[] = [];

  // Pre-warm the heavy GHL walks (opportunities + contacts, both
  // locations) BEFORE any section runs. Every section reads the
  // memoized results, so doing it once here turns 14+ duplicate walks
  // into 4 fetches total. Without pre-warming streamContacts, sections
  // that join contact data (Cases, Cost, leads) would race for it and
  // some would lose to the 120s timeout.
  const prewarmT0 = Date.now();
  try {
    await Promise.race([
      Promise.all([
        streamOpportunities(authAbogado()),
        streamOpportunities(authPplt()),
        streamContacts(authAbogado()),
        streamContacts(authPplt()),
      ]),
      new Promise((_, rej) =>
        setTimeout(
          () => rej(new Error(`pre-warm timed out after ${PREWARM_TIMEOUT_MS / 1000}s`)),
          PREWARM_TIMEOUT_MS
        )
      ),
    ]);
    log(`[compute] pre-warm done in ${Date.now() - prewarmT0}ms`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[compute] pre-warm failed after ${Date.now() - prewarmT0}ms:`, msg);
    warnings.push(`GHL pre-warm issue: ${msg.slice(0, 200)} (some sections may be empty)`);
  }

  const [
    overviewData,
    overviewEnglishData,
    overviewSpanishData,
    kpi,
    leadsSpanish,
    leadsEnglish,
    intakeTeam,
    intakeTeamEnglish,
    intakeTeamSpanish,
    cases,
    casesEnglish,
    casesSpanish,
    cost,
  ] = await Promise.all([
    settled<OverviewData>("Overview (combined)", () => overview("combined"), emptyOverview(), warnings, SECTION_TIMEOUT_MS, log),
    settled<OverviewData>("Overview (English)", () => overview("english"), emptyOverview(), warnings, SECTION_TIMEOUT_MS, log),
    settled<OverviewData>("Overview (Spanish)", () => overview("spanish"), emptyOverview(), warnings, SECTION_TIMEOUT_MS, log),
    settled<{ months: KpiBlock[]; quarters: KpiBlock[] }>(
      "KPI table",
      () => kpiTable(),
      { months: [], quarters: [] },
      warnings,
      SECTION_TIMEOUT_MS,
      log
    ),
    settled<LeadAnalytics>(
      "Spanish lead analytics",
      () => leadAnalyticsForBucket("spanish", range.start, range.end),
      emptyLead(),
      warnings,
      SECTION_TIMEOUT_MS,
      log
    ),
    settled<LeadAnalytics>(
      "English lead analytics",
      () => leadAnalyticsForBucket("english", range.start, range.end),
      emptyLead(),
      warnings,
      SECTION_TIMEOUT_MS,
      log
    ),
    settled<IntakeMemberMetrics[]>(
      "Intake team (combined)",
      () => intakeTeamMetrics(range.start, range.end, new Date(), "combined"),
      [],
      warnings,
      SECTION_TIMEOUT_MS,
      log
    ),
    settled<IntakeMemberMetrics[]>(
      "Intake team (English)",
      () => intakeTeamMetrics(range.start, range.end, new Date(), "english"),
      [],
      warnings,
      SECTION_TIMEOUT_MS,
      log
    ),
    settled<IntakeMemberMetrics[]>(
      "Intake team (Spanish)",
      () => intakeTeamMetrics(range.start, range.end, new Date(), "spanish"),
      [],
      warnings,
      SECTION_TIMEOUT_MS,
      log
    ),
    settled<CaseAnalytics>("Case analytics (combined)", () => caseAnalytics("combined", { start: range.start, end: range.end }), emptyCases(), warnings, SECTION_TIMEOUT_MS, log),
    settled<CaseAnalytics>("Case analytics (English)", () => caseAnalytics("english", { start: range.start, end: range.end }), emptyCases(), warnings, SECTION_TIMEOUT_MS, log),
    settled<CaseAnalytics>("Case analytics (Spanish)", () => caseAnalytics("spanish", { start: range.start, end: range.end }), emptyCases(), warnings, SECTION_TIMEOUT_MS, log),
    settled<CostAnalyticsPayload>(
      "Cost analytics",
      () => costAnalytics(range.start, range.end, range.label),
      {
        windowLabel: range.label,
        totalSpend: 0,
        totalLeadsMeta: 0,
        totalSigned: 0,
        totalCpl: null,
        totalCpsc: null,
        byAd: [],
        byPracticeArea: [],
        byAreaState: [],
      },
      warnings,
      SECTION_TIMEOUT_MS,
      log
    ),
  ]);

  // costAnalytics() has its own internal `warnings` array (e.g. "Meta ad
  // insights fetch failed: ..."). Bubble those up so the inline section
  // warning banner in the UI can surface them.
  if (cost && "warnings" in cost && Array.isArray((cost as { warnings?: string[] }).warnings)) {
    for (const w of (cost as { warnings: string[] }).warnings) {
      warnings.push(`Cost analytics: ${w}`);
    }
  }

  // Surface the intake-cron sync timestamps so the UI can show
  // "last synced X ago" or "cron hasn't run yet" inside the Intake
  // Team section banner.
  const { readIntakeConversations: readIntake } = await import(
    "./intakeConversationsStore"
  );
  const [intakeAbg, intakePplt] = await Promise.all([
    readIntake("abogado").then((s) => s?.syncedAt ?? null).catch(() => null),
    readIntake("pplt_leads").then((s) => s?.syncedAt ?? null).catch(() => null),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    range: { label: range.label, start: range.start.toISOString(), end: range.end.toISOString() },
    overview: overviewData,
    overviewEnglish: overviewEnglishData,
    overviewSpanish: overviewSpanishData,
    intakeSyncedAt: { abogado: intakeAbg, pplt_leads: intakePplt },
    kpi,
    email: [], // deprecated; UI no longer renders this section
    leadsEnglish,
    leadsSpanish,
    intakeTeam,
    intakeTeamEnglish,
    intakeTeamSpanish,
    cases,
    casesEnglish,
    casesSpanish,
    cost,
    warnings,
  };
}
