/**
 * Shared types for dashboard data. Kept narrow on purpose -- this is the
 * contract between the data layer and the UI; adding fields means thinking
 * about which sections need them.
 */

export type Bucket = "spanish" | "english";
export type LocationKey = "abogado" | "pplt_leads";

export type StageClass =
  | "lead"
  | "active"
  | "signed"
  | "referred_out"
  | "withdrawn"
  | "closed_lost";

export type PipelinePurpose =
  | "active_practice"
  | "co_counsel_tracking"
  | "referral_broker"
  | "channel"
  | "archived"
  | "unknown";

export type PracticeArea =
  | "auto"
  | "dog_bite"
  | "workers_comp"
  | "mass_tort_hair_relaxer"
  | "mass_tort_upf"
  | "disability"
  | "slip_and_fall"
  | "medical_malpractice"
  | "wrongful_death"
  | "nursing_home"
  | "general_pi"
  | "other_in_house"
  | "other";

export interface MappingStage {
  id: string;
  name: string;
  class: StageClass | "active";
  position?: number;
}

export interface MappingPipeline {
  id: string;
  name: string;
  purpose: PipelinePurpose;
  practice_area: PracticeArea | null;
  co_counsel_firm: string | null;
  include_in_metrics: boolean;
  stages: MappingStage[];
}

export interface MappingTag {
  id: string;
  name: string;
  class: "referred_out" | "signed" | "do_not_contact" | "spanish" | null;
}

export interface MappingCustomField {
  id: string;
  name: string;
  fieldKey?: string;
  dataType?: string;
  kind: "co_counsel" | "state" | "practice_area" | null;
}

export interface MappingUser {
  id: string;
  name: string;
  email: string;
}

export interface MappingLocation {
  location_id: string;
  pipelines: MappingPipeline[];
  tags: MappingTag[];
  custom_fields: MappingCustomField[];
  users_all: MappingUser[];
  intake_users: MappingUser[];
  source_sample: Record<string, number>;
}

export interface Mapping {
  generated_at: string;
  bucket_map: Record<Bucket, LocationKey[]>;
  stage_classes: StageClass[];
  practice_areas: string[];
  intake_email_regex: string;
  locations: Record<LocationKey, MappingLocation>;
}

// ----- range -----
export interface DateRange {
  start: Date; // inclusive
  end: Date; // exclusive (next-day midnight in TZ)
  label: string;
}

// ----- overview -----
export interface DeltaStat {
  current: number;
  previous: number;
  pctChange: number | null; // null when previous is 0
  direction: "up" | "down" | "flat";
}

export interface OverviewData {
  // Rolling windows: last 30 days vs prior 30 days, last 7 days vs prior 7 days.
  // Easier to compare than partial-calendar-month/week which look wrong mid-period.
  leads30: DeltaStat;
  leads7: DeltaStat;
  referrals30: DeltaStat;
  referrals7: DeltaStat;
  signed30: DeltaStat;
  signed7: DeltaStat;
  activeTotal: number;
  reviews: {
    week: number;
    month: number;
    year: number;
    lifetime: number;
    perProfile: Array<{ name: string; lifetime: number }>;
  };
}

// ----- KPI table -----
export interface KpiRow {
  label: string;
  spanish: number | string;
  english: number | string;
  total: number | string;
}

export interface KpiBlock {
  title: string; // e.g. "May 2026" or "Q2 2026"
  rows: KpiRow[];
}

// ----- email -----
export interface EmailMetrics {
  bucket: Bucket;
  sends: number;
  opens: number;
  clicks: number;
  replies: number;
  unsubscribes: number;
  signedWithin30dOfReply: number;
}

// ----- lead analytics -----
export interface LeadAnalytics {
  sourceMix: Array<{ source: string; count: number }>;
  byStatus: Array<{ status: string; count: number }>;
  conversionRatePct: number; // signed / leads
  avgDaysToSigned: number | null;
}

// ----- intake team -----
export interface IntakeMemberMetrics {
  userId: string;
  name: string;
  email: string;
  referrals: number;
  signedFromReferrals: number;
  callsInbound: number;
  callsOutbound: number;
  /** Subset of inbound+outbound where the call actually connected
   *  (meta.call.status === "completed" or callDuration > 0). Shown as
   *  "Calls Connected" in the UI. */
  callsAnswered: number;
  sms: number;
  avgPickupSeconds: number | null;
  // Rolling windows (matches Overview): last 30 days vs prior 30, last 7 vs prior 7.
  referrals30: DeltaStat;
  referrals7: DeltaStat;
  signed30: DeltaStat;
  signed7: DeltaStat;
  activeFromReferrals: number;
}

// ----- case analytics -----
export interface CaseAnalytics {
  byPracticeArea: Array<{ area: string; count: number }>;
  byCoCounsel: Array<{ firm: string; count: number }>;
  // Same shape as byCoCounsel but filtered to opps that reached a Signed
  // stage inside the co-counsel pipeline (the firm actually signed the
  // case after we referred it).
  byCoCounselSigned: Array<{ firm: string; count: number }>;
  byState: Array<{ state: string; count: number }>;
  // Lexamica + Litify are referral brokers, not law firms. They get
  // pulled out of the co-counsel chart and shown as a footnote.
  referralBrokers?: { lexamica: number; litify: number };
  // Same for signed-at-broker (rarely useful but exposed for transparency).
  referralBrokersSigned?: { lexamica: number; litify: number };
}

// ----- cost analytics -----
// Two attribution lenses on the same data:
//   Same-window  : counts the SIGN/REFERRAL EVENT happening in the window
//                  (regardless of when the lead originally came in).
//                  Matches how Ads Manager reports it.
//   Cohort        : counts the LEAD coming in during the window; only credits
//                  signs/refs if they happen AFTER createdAt (look-ahead is
//                  bounded by the 180-day opp walk).
//                  cohortMaturing=true means the window ends <60d ago and
//                  more sign-ups may still arrive.
export interface AdCostRow {
  adId: string;
  adName: string;
  adsetName: string;
  campaignName: string;
  account: "pplt" | "workersComp" | "abogado";
  practiceArea: string;
  spend: number;
  leadsMeta: number;
  /** Same-window: opp's stage flipped to signed inside the window. */
  signed: number;
  /** Same-window: opp's stage flipped to referred / co-counsel inside the window. */
  referred: number;
  /** Cohort: opp's lead came in window AND eventually reached signed. */
  signedCohort: number;
  /** Cohort: opp's lead came in window AND eventually reached referred. */
  referredCohort: number;
  cpl: number | null;
  cpsc: number | null;
  /** Cohort CPSC: spend / signedCohort. */
  cpscCohort: number | null;
  /** Avg (lastChangeAt - createdAt) for the same-window signed set. */
  avgDaysToSigned: number | null;
  /** Avg (lastChangeAt - createdAt) for the same-window referred set. */
  avgDaysToReferred: number | null;
  /** True when window ends < 60 days ago and the cohort numbers are still maturing. */
  cohortMaturing: boolean;
}

export interface PracticeAreaCostRow {
  area: string;
  spend: number;
  leadsMeta: number;
  signed: number;
  referred: number;
  signedCohort: number;
  referredCohort: number;
  /** TOTAL signs in window for this practice area, regardless of whether
   *  the opp had a utmAdId. Includes referrals, walk-ins, organic, plus
   *  Meta-attributed signs. Use this to spot attribution gaps.
   *  Optional for backward compat with older snapshots/mock fixtures. */
  signedAll?: number;
  /** Signs that had NO utmAdId but whose contact.source matches a Meta /
   *  Facebook / Instagram lead-ad pattern. Recovers signs lost during the
   *  contact -> opportunity transfer in GHL. Disjoint from `signed`
   *  (which requires utmAdId). */
  signedMetaSource?: number;
  cpl: number | null;
  cpsc: number | null;
  cpscCohort: number | null;
  avgDaysToSigned: number | null;
  avgDaysToReferred: number | null;
  adCount: number;
  cohortMaturing: boolean;
}

export interface AreaStateCostRow {
  area: string;
  state: string;
  spend: number;       // attributed via spend / Meta-leads per ad
  leads: number;       // GHL opps with utmAdId AND createdAt in window
  signed: number;
  referred: number;
  signedCohort: number;
  referredCohort: number;
  /** TOTAL signs in window for this (area, state), regardless of utmAdId.
   *  Lets the dashboard show all signs in a row, not just the Meta-attributed ones.
   *  Optional for backward compat with older snapshots/mock fixtures. */
  signedAll?: number;
  /** Signs that had NO utmAdId but whose contact.source matches a Meta
   *  pattern. Disjoint from `signed`. */
  signedMetaSource?: number;
  cpl: number | null;
  cpsc: number | null;
  cpscCohort: number | null;
  avgDaysToSigned: number | null;
  avgDaysToReferred: number | null;
  cohortMaturing: boolean;
}

export interface CostAnalyticsPayload {
  windowLabel: string;
  totalSpend: number;
  totalLeadsMeta: number;
  totalSigned: number;
  /** TOTAL signs in window across both locations regardless of utmAdId.
   *  Used to show the attribution gap on the dashboard. Optional for
   *  backward compat with older snapshots/mock fixtures. */
  totalSignedAll?: number;
  /** Signs where utmAdId was missing but contact.source indicates Meta
   *  (Facebook / Instagram / Meta lead form). Combined with totalSigned,
   *  this is the firm's true "Meta-influenced" count. */
  totalSignedMetaSource?: number;
  /** Signs whose Practice Area (Opportunity) custom field was populated.
   *  Data-quality signal — high % means PA bucketing is trustworthy;
   *  low % means most signs fell back to pipeline.practice_area. */
  oppPracticeAreaHits?: number;
  /** Signs whose Practice Area (Opportunity) custom field was blank. */
  oppPracticeAreaMisses?: number;
  totalCpl: number | null;
  totalCpsc: number | null;
  byAd: AdCostRow[];
  byPracticeArea: PracticeAreaCostRow[];
  byAreaState: AreaStateCostRow[];
  /** ISO timestamp of the cached Meta pull we fell back to, if the live
   *  fetch failed. Undefined when fresh. */
  metaStaleAsOf?: string;
}

// ----- top-level payload -----
export interface DashboardData {
  generatedAt: string; // ISO
  range: { label: string; start: string; end: string };
  overview: OverviewData; // combined
  overviewEnglish?: OverviewData; // PPLT only
  overviewSpanish?: OverviewData; // Abogado only
  kpi: { months: KpiBlock[]; quarters: KpiBlock[] };
  email: EmailMetrics[];
  leadsEnglish: LeadAnalytics;
  leadsSpanish: LeadAnalytics;
  intakeTeam: IntakeMemberMetrics[]; // combined view
  intakeTeamEnglish?: IntakeMemberMetrics[]; // PPLT-only activity per member
  intakeTeamSpanish?: IntakeMemberMetrics[]; // Abogado-only activity per member
  cases: CaseAnalytics; // combined view (English + Spanish)
  casesEnglish?: CaseAnalytics; // PPLT-only
  casesSpanish?: CaseAnalytics; // Abogado-only
  cost?: CostAnalyticsPayload; // Meta CPL/CPSC per ad + per practice area
  warnings: string[]; // non-fatal data issues we want to surface
  // Snapshot metadata (added when read from KV). Optional because the
  // mock-data endpoint doesn't set these.
  syncedAt?: string;
  syncDurationMs?: number;
  /** When /api/sync/intake last wrote its KV snapshot (per-bucket).
   *  Helps surface "intake cron hasn't run yet" vs "cron ran, found 0". */
  intakeSyncedAt?: { abogado: string | null; pplt_leads: string | null };
  // Per-user visibility (resolved at request time from current Clerk user)
  visibility?: {
    sections: Record<string, boolean>;
    subsections: Record<string, boolean>;
    isAdmin: boolean;
  };
}
