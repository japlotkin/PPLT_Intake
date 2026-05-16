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
  leadsMonth: DeltaStat;
  leadsWeek: DeltaStat;
  referralsMonth: DeltaStat;
  referralsWeek: DeltaStat;
  signedMonth: DeltaStat;
  signedWeek: DeltaStat;
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
  sms: number;
  avgPickupSeconds: number | null;
  referralsMonth: DeltaStat;
  referralsWeek: DeltaStat;
  signedMonth: DeltaStat;
  signedWeek: DeltaStat;
  activeFromReferrals: number;
}

// ----- case analytics -----
export interface CaseAnalytics {
  byPracticeArea: Array<{ area: string; count: number }>;
  byStatus: Array<{ status: string; count: number }>;
  byCoCounsel: Array<{ firm: string; count: number }>;
  byState: Array<{ state: string; count: number }>;
}

// ----- top-level payload -----
export interface DashboardData {
  generatedAt: string; // ISO
  range: { label: string; start: string; end: string };
  overview: OverviewData;
  kpi: { months: KpiBlock[]; quarters: KpiBlock[] };
  email: EmailMetrics[];
  leadsEnglish: LeadAnalytics;
  leadsSpanish: LeadAnalytics;
  intakeTeam: IntakeMemberMetrics[];
  cases: CaseAnalytics;
  warnings: string[]; // non-fatal data issues we want to surface
  // Snapshot metadata (added when read from KV). Optional because the
  // mock-data endpoint doesn't set these.
  syncedAt?: string;
  syncDurationMs?: number;
}
