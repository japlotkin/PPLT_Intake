/**
 * Historical KPI rollup — computes Spanish/English/Total for Leads In,
 * Referred Out, Signed, and the three percentages for every month in a
 * configurable look-back window. Used by /api/admin/kpi-history to
 * generate a CSV export.
 *
 * Trade-offs vs the in-snapshot KPI table:
 * - Walks contacts further back (default 365 days) than streamContacts'
 *   100-day default, so the lookups for older months don't return zero.
 * - Walks opps further back too. Slower than the regular sync; this
 *   endpoint is admin-only and tolerated to take 60-120s.
 */
import { addMonths, startOfMonth, subMonths } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { postV2, GhlAuth } from "../ghl/client";
import { authAbogado, authPplt } from "../ghl/client";
import {
  classifyOpportunities,
  type RawOpportunity,
  type ClassifiedOpportunity,
} from "../ghl/opportunities";
import { getV2 } from "../ghl/client";
import { pct } from "./helpers";

const TZ = "America/New_York";

export interface KpiHistoryRow {
  monthLabel: string;       // "Apr 2026"
  monthStart: string;       // ISO
  spanishLeads: number;
  englishLeads: number;
  totalLeads: number;
  spanishReferred: number;
  englishReferred: number;
  totalReferred: number;
  spanishSigned: number;
  englishSigned: number;
  totalSigned: number;
  pctReferredVsLeads: number;     // total
  pctSignedVsReferred: number;
  pctSignedVsLeads: number;
}

// Walk all contacts for the location going back at least the given days.
// Different from streamContacts in that it forces a deeper walk for the export.
async function deepStreamContacts(auth: GhlAuth, days: number) {
  const cutoffMs = Date.now() - days * 24 * 3600 * 1000;
  const out: Array<{ id: string; dateAdded?: string }> = [];
  let page = 0;
  while (page < 1000) {
    page++;
    const body: Record<string, unknown> = {
      locationId: auth.locationId,
      pageLimit: 100,
      page,
      sort: [{ field: "dateAdded", direction: "desc" }],
    };
    const resp: { contacts?: Array<{ id: string; dateAdded?: string }> } = await postV2(
      auth,
      "/contacts/search",
      body
    );
    const got = resp.contacts ?? [];
    if (got.length === 0) break;
    let oldest = Infinity;
    for (const c of got) {
      const t = c.dateAdded ? Date.parse(c.dateAdded) : NaN;
      if (Number.isNaN(t)) continue;
      out.push(c);
      if (t < oldest) oldest = t;
    }
    if (oldest < cutoffMs) break;
    if (got.length < 100) break;
  }
  return out;
}

// Same idea for opps — extend the walk past streamOpportunities' default.
async function deepStreamOpportunities(auth: GhlAuth, days: number) {
  const cutoffMs = Date.now() - days * 24 * 3600 * 1000;
  const out: RawOpportunity[] = [];
  let url:
    | string
    | undefined = `/opportunities/search?location_id=${auth.locationId}&limit=100`;
  let page = 0;
  while (url && page < 1000) {
    page++;
    const data: {
      opportunities?: RawOpportunity[];
      meta?: { nextPageUrl?: string };
    } = await getV2(auth, url.replace(/^.*?\//, "/"));
    const opps = data.opportunities ?? [];
    if (opps.length === 0) break;
    let oldest = Infinity;
    for (const o of opps) {
      const ts =
        (o.lastStageChangeAt && Date.parse(o.lastStageChangeAt)) ||
        (o.createdAt && Date.parse(o.createdAt)) ||
        0;
      if (ts >= cutoffMs) out.push(o);
      if (ts < oldest) oldest = ts;
    }
    if (oldest < cutoffMs) break;
    const next = data.meta?.nextPageUrl;
    if (!next) break;
    try {
      const u = new URL(next);
      url = u.pathname + u.search;
    } catch {
      url = next;
    }
  }
  return out;
}

function monthBucket(date: Date, now: Date, n: number): Date[] {
  const local = toZonedTime(now, TZ);
  const out: Date[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const m = startOfMonth(subMonths(local, i));
    out.push(fromZonedTime(m, TZ));
  }
  void date;
  return out;
}

export async function kpiHistory(months: number, now = new Date()): Promise<KpiHistoryRow[]> {
  const daysNeeded = months * 31 + 14; // small safety buffer
  const authA = authAbogado();
  const authP = authPplt();

  const [
    contactsA,
    contactsP,
    rawOppsA,
    rawOppsP,
  ] = await Promise.all([
    deepStreamContacts(authA, daysNeeded),
    deepStreamContacts(authP, daysNeeded),
    deepStreamOpportunities(authA, daysNeeded),
    deepStreamOpportunities(authP, daysNeeded),
  ]);

  const oppsA: ClassifiedOpportunity[] = classifyOpportunities(authA, rawOppsA);
  const oppsP: ClassifiedOpportunity[] = classifyOpportunities(authP, rawOppsP);

  const localNow = toZonedTime(now, TZ);
  const starts = monthBucket(now, now, months);

  const rows: KpiHistoryRow[] = [];
  for (let i = 0; i < starts.length; i++) {
    const monthStart = starts[i];
    const localStart = toZonedTime(monthStart, TZ);
    const monthEndLocal = startOfMonth(addMonths(localStart, 1));
    const monthEnd = fromZonedTime(monthEndLocal, TZ);
    const sMs = monthStart.getTime();
    const eMs = monthEnd.getTime();

    const countContactsIn = (cs: Array<{ dateAdded?: string }>) =>
      cs.filter((c) => {
        const t = c.dateAdded ? Date.parse(c.dateAdded) : NaN;
        return Number.isFinite(t) && t >= sMs && t < eMs;
      }).length;

    const countOppsIn = (
      opps: ClassifiedOpportunity[],
      predicate: (o: ClassifiedOpportunity) => boolean
    ) =>
      opps.filter((o) => {
        if (!o.includeInMetrics) return false;
        if (!predicate(o)) return false;
        const t = o.raw.lastStageChangeAt
          ? Date.parse(o.raw.lastStageChangeAt)
          : NaN;
        return Number.isFinite(t) && t >= sMs && t < eMs;
      }).length;

    const spanishLeads = countContactsIn(contactsA);
    const englishLeads = countContactsIn(contactsP);
    const spanishSigned = countOppsIn(oppsA, (o) => o.stageClass === "signed");
    const englishSigned = countOppsIn(oppsP, (o) => o.stageClass === "signed");
    const isReferred = (o: ClassifiedOpportunity) =>
      o.stageClass === "referred_out" ||
      o.pipelinePurpose === "co_counsel_tracking" ||
      o.pipelinePurpose === "referral_broker";
    const spanishReferred = countOppsIn(oppsA, isReferred);
    const englishReferred = countOppsIn(oppsP, isReferred);

    const totalLeads = spanishLeads + englishLeads;
    const totalReferred = spanishReferred + englishReferred;
    const totalSigned = spanishSigned + englishSigned;

    rows.push({
      monthLabel: localStart.toLocaleString("en-US", { month: "short", year: "numeric" }),
      monthStart: monthStart.toISOString(),
      spanishLeads,
      englishLeads,
      totalLeads,
      spanishReferred,
      englishReferred,
      totalReferred,
      spanishSigned,
      englishSigned,
      totalSigned,
      pctReferredVsLeads: pct(totalReferred, totalLeads),
      pctSignedVsReferred: pct(totalSigned, totalReferred),
      pctSignedVsLeads: pct(totalSigned, totalLeads),
    });
  }
  void localNow;
  return rows;
}
