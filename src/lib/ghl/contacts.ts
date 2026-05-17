/**
 * Contact / lead pagination.
 *
 * GHL has 21K Abogado + 48K PPLT contacts and the v2 /contacts/search
 * filter syntax we tried did NOT apply -- every call returned the same
 * 100 most-recent contacts regardless of date range, which explains the
 * "100/100 every month" KPI bug.
 *
 * Strategy now: walk contacts sorted desc by dateAdded, stop once we
 * cross a cutoff (default 180 days back so all KPI/Lead/Overview ranges
 * are covered). Memoize the result per location so all callers share one
 * walk. Callers filter the in-memory list by their specific window.
 */
import { postV2, GhlAuth } from "./client";

export interface RawContact {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  source?: string;
  dateAdded?: string;
  state?: string;
  tags?: string[];
  customFields?: Array<{ id: string; value?: unknown }>;
  assignedTo?: string;
  type?: string;
  attributionSource?: string;
}

interface SearchResp {
  contacts: RawContact[];
  total?: number;
  searchAfter?: unknown;
}

const STREAM_TTL_MS = 5 * 60_000;
// KPI table only goes back current quarter + last quarter (max ~6 months).
// Overview only goes back to last month. 100 days is enough for both with
// a small buffer for week-vs-last-week deltas; keeps pagination tractable.
const CONTACT_WALK_DAYS = 100;

type StreamCacheEntry = { expires: number; promise: Promise<RawContact[]> };
const streamCache = new Map<string, StreamCacheEntry>();

/**
 * Walk all contacts created in the last CONTACT_WALK_DAYS, sorted desc.
 * Memoized per location for ~5 minutes so KPI / Lead / Overview share
 * one fetch instead of paginating independently.
 *
 * GHL v2 /contacts/search uses page-based pagination (1-indexed); the
 * `searchAfter` cursor we tried first wasn't returned in the response,
 * so every call after page 1 was a no-op and we always got the same
 * 100 most-recent contacts. With `page`, we walk newest -> oldest and
 * stop once an entire page falls below the cutoff date.
 */
export async function streamContacts(auth: GhlAuth): Promise<RawContact[]> {
  const key = `contacts:${auth.locationId}`;
  const now = Date.now();
  const cached = streamCache.get(key);
  if (cached && cached.expires > now) return cached.promise;

  const cutoffMs = now - CONTACT_WALK_DAYS * 24 * 3600 * 1000;
  const pageLimit = 100;

  const promise = (async () => {
    const out: RawContact[] = [];
    let page = 0;
    let totalReported: number | undefined;
    while (page < 500) {
      page++;
      const body: Record<string, unknown> = {
        locationId: auth.locationId,
        pageLimit,
        page,
        sort: [{ field: "dateAdded", direction: "desc" }],
      };
      const resp: SearchResp = await postV2(auth, "/contacts/search", body);
      const got = resp.contacts ?? [];
      if (totalReported === undefined && typeof resp.total === "number") {
        totalReported = resp.total;
      }
      if (got.length === 0) break;

      let oldestOnPageMs = Infinity;
      for (const c of got) {
        const t = c.dateAdded ? Date.parse(c.dateAdded) : NaN;
        if (Number.isNaN(t)) continue;
        if (t >= cutoffMs) out.push(c);
        if (t < oldestOnPageMs) oldestOnPageMs = t;
      }
      if (oldestOnPageMs < cutoffMs && oldestOnPageMs !== Infinity) break;
      if (got.length < pageLimit) break;
    }
    console.log(
      `[streamContacts] ${auth.key} fetched ${out.length} contacts in last ${CONTACT_WALK_DAYS}d ` +
        `(scanned ${page} page(s), location total=${totalReported ?? "?"})`
    );
    return out;
  })();

  streamCache.set(key, { expires: now + STREAM_TTL_MS, promise });
  promise.catch(() => {
    if (streamCache.get(key)?.promise === promise) streamCache.delete(key);
  });
  return promise;
}

/**
 * Return contacts whose dateAdded falls in [start, end), filtered from
 * the memoized streamContacts result. start/end MUST fall within the
 * CONTACT_WALK_DAYS window (180 days back) -- callers that need older
 * data should call streamContacts directly and expand the window.
 */
export async function contactsInRange(
  auth: GhlAuth,
  start: Date,
  end: Date
): Promise<RawContact[]> {
  const all = await streamContacts(auth);
  const sMs = start.getTime();
  const eMs = end.getTime();
  return all.filter((c) => {
    const t = c.dateAdded ? Date.parse(c.dateAdded) : NaN;
    return Number.isFinite(t) && t >= sMs && t < eMs;
  });
}

/**
 * Is this contact source one we count as a "Meta lead form that landed in
 * GHL"? The dashboard's lead count is defined as: GHL contact whose source
 * indicates it came from a Meta (Facebook / Instagram) lead-ad form. Meta
 * leads that never reached GHL aren't counted -- by definition we only
 * see contacts that GHL has.
 *
 * Matches: any Facebook variant (FB Lead Ads, fb_form, etc.), any
 *          Instagram variant (IG ads, instagram_lead_ads), and the
 *          generic 'LeadConnector' / 'lead form' labels that Meta-
 *          integration webhooks sometimes set.
 * Excludes: Google, YouTube, organic, walk-in, phone, referral,
 *           prior client, direct, unknown, etc.
 */
export function isMetaLeadFormSource(raw: string | undefined | null): boolean {
  if (!raw) return false;
  const r = raw.trim().toLowerCase();
  if (!r) return false;
  if (/facebook|\bfb\b|fb[\s_-]?lead|fb[\s_-]?form/.test(r)) return true;
  if (/instagram|\big\b|ig[\s_-]?ads?|ig[\s_-]?lead/.test(r)) return true;
  if (r === "meta" || r.includes("meta ads")) return true;
  // Generic Meta-form webhook labels we've seen in GHL:
  if (r === "lead form" || r === "lead-form" || r === "leadconnector form") return true;
  return false;
}

/**
 * Normalize a phone string to its last 10 digits (US convention).
 * Returns empty string if there's nothing usable.
 */
function normPhone(raw: string | undefined | null): string {
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

/** Dedupe key for a contact: normalized phone, or lowercased email. */
function dedupeKey(c: RawContact): string {
  const p = normPhone(c.phone);
  if (p) return `p:${p}`;
  const e = (c.email ?? "").trim().toLowerCase();
  if (e) return `e:${e}`;
  return ""; // no key -> can't dedupe, always count
}

const DEDUPE_WINDOW_DAYS = 3;
const DEDUPE_WINDOW_MS = DEDUPE_WINDOW_DAYS * 24 * 3600 * 1000;

/**
 * "Lead Forms (Meta/GHL)" definition: GHL contacts in [start, end) WHERE
 *   - source matches a Meta lead-ad form (isMetaLeadFormSource), AND
 *   - the contact is NOT a duplicate of a prior same-contact submission
 *     within the previous 3 days.
 *
 * Meta-side lead forms that never landed in GHL are by definition not
 * counted -- we only see what GHL has.
 *
 * Dedupe walks the entire 100-day contact window (not just the
 * requested range) so a lead on March 31 and a follow-up on April 1
 * properly mark April 1 as a dupe. One person submitting on May 1, then
 * May 6 -> two leads (different cases). May 1 then May 2 -> one lead.
 */
export async function metaLeadFormsInRange(
  auth: GhlAuth,
  start: Date,
  end: Date
): Promise<RawContact[]> {
  const all = await streamContacts(auth);
  const sMs = start.getTime();
  const eMs = end.getTime();

  const meta = all
    .filter((c) => isMetaLeadFormSource(c.source))
    .map((c) => ({ c, t: c.dateAdded ? Date.parse(c.dateAdded) : NaN }))
    .filter((x) => Number.isFinite(x.t))
    .sort((a, b) => a.t - b.t);

  const lastSeen = new Map<string, number>();
  const out: RawContact[] = [];
  for (const { c, t } of meta) {
    const key = dedupeKey(c);
    if (!key) {
      if (t >= sMs && t < eMs) out.push(c);
      continue;
    }
    const prev = lastSeen.get(key);
    const isDupe = prev !== undefined && t - prev < DEDUPE_WINDOW_MS;
    lastSeen.set(key, t); // always update — rolling window
    if (isDupe) continue;
    if (t >= sMs && t < eMs) out.push(c);
  }
  return out;
}

/**
 * Normalize a raw `source` string into a friendly source bucket. We don't
 * want 30 variants of "Facebook" in the pie chart.
 */
export function normalizeSource(raw: string | undefined | null): string {
  if (!raw || raw.trim() === "") return "Direct / Unknown";
  const r = raw.toLowerCase();
  if (r.includes("fb") && r.includes("lead")) return "Facebook Lead Ads";
  if (r.includes("facebook")) return "Facebook";
  if (r.includes("instagram")) return "Instagram";
  if (r.includes("google") && r.includes("ad")) return "Google Ads";
  if (r.includes("google")) return "Google (organic)";
  if (r.includes("youtube")) return "YouTube";
  if (r.includes("calculator")) return "Settlement Calculator";
  if (r.includes("organic")) return "Organic";
  if (r.includes("referral") || r.includes("referred")) return "Referral";
  if (r.includes("prior client")) return "Prior Client";
  if (r.includes("consultation")) return "Consultation Form";
  if (r.includes("chat")) return "Website Chat";
  return raw;
}
