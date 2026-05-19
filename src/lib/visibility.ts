/**
 * Per-user dashboard section visibility.
 *
 * Stored in Vercel KV under `dash:visibility:<email-lowercase>`. The schema
 * is *deny-list* style: absent = visible (so a brand-new user sees the full
 * dashboard until an admin restricts something). Sections and subsections
 * can each be hidden independently.
 *
 * The admin (ADMIN_EMAIL) is force-visible everywhere regardless of config
 * to prevent lockout.
 */
import { kv } from "@vercel/kv";
import { env } from "./env";

export const SECTION_IDS = [
  "overview",
  "kpi",
  "cost",
  "leads",
  "intake",
  "cases",
] as const;
export type SectionId = (typeof SECTION_IDS)[number];

// Subsection ids are namespaced under their parent section so the storage
// schema is flat and easy to display in the admin UI.
export const SUBSECTIONS_BY_SECTION: Record<SectionId, readonly string[]> = {
  overview: [],
  kpi: ["by_month", "by_quarter"],
  cost: ["headline", "by_practice_area", "by_area_state", "per_ad"],
  leads: ["english_sources", "spanish_sources", "english_status", "spanish_status"],
  intake: [],
  cases: ["by_practice_area", "by_state", "active_co_counsel", "signed_co_counsel"],
};

export const SECTION_LABELS: Record<SectionId, string> = {
  overview: "Overview",
  kpi: "KPIs",
  cost: "Ad Cost",
  leads: "Lead Analytics",
  intake: "Intake Team",
  cases: "Case Analytics",
};

export const SUBSECTION_LABELS: Record<string, string> = {
  "kpi.by_month": "By Month",
  "kpi.by_quarter": "By Quarter",
  "cost.headline": "Headline stats (Spend / Leads / CPL / CPSC)",
  "cost.by_practice_area": "By Practice Area",
  "cost.by_area_state": "By Area × State",
  "cost.per_ad": "Per Ad",
  "leads.english_sources": "English Sources pie",
  "leads.spanish_sources": "Spanish Sources pie",
  "leads.english_status": "English Leads by Status",
  "leads.spanish_status": "Spanish Leads by Status",
  "cases.by_practice_area": "By Practice Area",
  "cases.by_state": "By State",
  "cases.active_co_counsel": "Active at Co-Counsel Firm",
  "cases.signed_co_counsel": "Signed by Co-Counsel Firm",
};

/**
 * Permission tier. 'admin' is env-driven (ADMIN_EMAILS) and not stored
 * per-user. 'manager' and 'staff' are presets that set defaults for the
 * checkbox-based section visibility. Once an admin manually toggles a
 * checkbox, the role label becomes 'custom' but the toggle state wins.
 */
export type Role = "manager" | "staff" | "vendor" | "custom";

export const ROLE_LABELS: Record<Role, string> = {
  manager: "Manager — sees everything except Ad Cost",
  staff: "Staff — Overview + KPIs + own Intake row only",
  vendor: "Vendor — Ad Cost + Lead Analytics only (external marketing managers)",
  custom: "Custom — per-section overrides",
};

/**
 * Preset that the Role dropdown applies when picked. Empty arrays = the
 * tier sees that section/subsection. Manual checkbox toggles override.
 */
export const ROLE_PRESETS: Record<
  Exclude<Role, "custom">,
  {
    hiddenSections: SectionId[];
    hiddenSubsections: string[];
    restrictIntakeToOwnRow: boolean;
  }
> = {
  manager: {
    hiddenSections: ["cost"],
    hiddenSubsections: ["leads.english_status", "leads.spanish_status"],
    restrictIntakeToOwnRow: false,
  },
  staff: {
    hiddenSections: ["cost", "leads", "cases"],
    hiddenSubsections: ["kpi.by_quarter"],
    restrictIntakeToOwnRow: true,
  },
  vendor: {
    // External marketing vendors (Meta ad managers, Google Ads
    // consultants, etc.): see Ad Cost + Lead Analytics only. They get
    // the data they need to optimize campaigns without firm-wide KPIs
    // or rolling growth metrics.
    hiddenSections: ["overview", "kpi", "intake", "cases"],
    hiddenSubsections: [],
    restrictIntakeToOwnRow: false,
  },
};

export interface VisibilityConfig {
  email: string;
  /** Optional tier label. Informational — actual access is driven by
   *  hiddenSections + hiddenSubsections + restrictIntakeToOwnRow. */
  role?: Role;
  /** Section IDs the user should NOT see. */
  hiddenSections: SectionId[];
  /** Subsection IDs (namespaced "<section>.<sub>") the user should NOT see. */
  hiddenSubsections: string[];
  /** If true, the Intake Team table is filtered to the user's own row only.
   *  Useful for the Staff tier so reps see their own activity but not peer
   *  comparisons. Admin/Manager never have this set. */
  restrictIntakeToOwnRow?: boolean;
  updatedAt: string;
  updatedBy: string;
}

const KV_PREFIX = "visibility:";
function kvKey(email: string): string {
  return KV_PREFIX + email.toLowerCase();
}

export async function readVisibility(email: string): Promise<VisibilityConfig | null> {
  if (!env.kv.enabled()) return null;
  return ((await kv.get<VisibilityConfig>(kvKey(email))) ?? null);
}

export async function writeVisibility(cfg: VisibilityConfig): Promise<void> {
  if (!env.kv.enabled()) {
    throw new Error("KV not configured");
  }
  await kv.set(kvKey(cfg.email), cfg);
}

export async function listAllVisibility(): Promise<VisibilityConfig[]> {
  if (!env.kv.enabled()) return [];
  const keys = await kv.keys(KV_PREFIX + "*");
  if (keys.length === 0) return [];
  const results = await Promise.all(keys.map((k) => kv.get<VisibilityConfig>(k)));
  return results.filter((x): x is VisibilityConfig => x !== null);
}

/** Returns true if the section is visible to the email. Admins always see all. */
export function isSectionVisible(
  cfg: VisibilityConfig | null,
  email: string,
  isAdmin: boolean,
  section: SectionId
): boolean {
  if (isAdmin) return true;
  if (!cfg) return true;
  return !cfg.hiddenSections.includes(section);
}

export function isSubsectionVisible(
  cfg: VisibilityConfig | null,
  email: string,
  isAdmin: boolean,
  section: SectionId,
  subsection: string
): boolean {
  if (isAdmin) return true;
  if (!cfg) return true;
  if (cfg.hiddenSections.includes(section)) return false;
  const key = `${section}.${subsection}`;
  return !cfg.hiddenSubsections.includes(key);
}

/** Build a shape the client UI can consume (booleans only, no admin email leak). */
export interface ClientVisibility {
  sections: Record<SectionId, boolean>;
  subsections: Record<string, boolean>;
  isAdmin: boolean;
  /** When true, the dashboard already filtered intakeTeam[] server-side
   *  to the current user's row. The client just renders what it got. */
  restrictIntakeToOwnRow: boolean;
}

export function toClientVisibility(
  cfg: VisibilityConfig | null,
  email: string,
  isAdmin: boolean
): ClientVisibility {
  const sections: Record<SectionId, boolean> = {
    overview: true,
    kpi: true,
    cost: true,
    leads: true,
    intake: true,
    cases: true,
  };
  const subsections: Record<string, boolean> = {};
  for (const sec of SECTION_IDS) {
    for (const sub of SUBSECTIONS_BY_SECTION[sec]) {
      subsections[`${sec}.${sub}`] = true;
    }
  }
  let restrictIntakeToOwnRow = false;
  if (!isAdmin && cfg) {
    for (const s of cfg.hiddenSections) sections[s] = false;
    for (const ss of cfg.hiddenSubsections) subsections[ss] = false;
    restrictIntakeToOwnRow = Boolean(cfg.restrictIntakeToOwnRow);
  }
  return { sections, subsections, isAdmin, restrictIntakeToOwnRow };
}
