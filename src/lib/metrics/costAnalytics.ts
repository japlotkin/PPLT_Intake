/**
 * Cost analytics: join Meta ad spend with GHL signed-case attribution to
 * compute Cost Per Lead and Cost Per Signed Case at two grains:
 *   1. Per-Meta-ad (via opportunity.attributions[].utmAdId)
 *   2. Per-practice-area (via the ad's primary practice area, derived
 *      from ad/campaign/adset names + the Workers Comp ad account)
 *
 * Definitions:
 *   - Spend  = Meta ad spend in the window.
 *   - Leads (Meta)  = Meta "lead" action_type count (matches Ads Manager).
 *   - Signed = GHL opportunities that entered a Signed stage in the window,
 *              joined to the ad via attributions.utmAdId.
 *   - CPL    = spend / leads.
 *   - CPSC   = spend / signed.
 *
 * Window mismatch caveat: an ad spent in May could produce a sign-up in
 * June. For short windows this undercounts CPSC. We document this in the
 * UI subtitle.
 */
import { allAdInsights, type MetaAdRow } from "../meta/ads";
import { authAbogado, authPplt } from "../ghl/client";
import {
  classifyOpportunities,
  streamOpportunities,
  type ClassifiedOpportunity,
} from "../ghl/opportunities";
import { practiceAreaLabel } from "../mapping";

export interface AdCostRow {
  adId: string;
  adName: string;
  adsetName: string;
  campaignName: string;
  account: "pplt" | "workersComp" | "abogado";
  practiceArea: string;
  spend: number;
  leadsMeta: number;
  signed: number;
  cpl: number | null;
  cpsc: number | null;
}

export interface PracticeAreaCostRow {
  area: string;
  spend: number;
  leadsMeta: number;
  signed: number;
  cpl: number | null;
  cpsc: number | null;
  adCount: number;
}

export interface CostAnalytics {
  windowLabel: string;
  windowStart: string;
  windowEnd: string;
  totalSpend: number;
  totalLeadsMeta: number;
  totalSigned: number;
  totalCpl: number | null;
  totalCpsc: number | null;
  byAd: AdCostRow[];      // sorted by spend desc
  byPracticeArea: PracticeAreaCostRow[]; // sorted by spend desc
  warnings: string[];
}

/**
 * Classify an ad into a practice area by parsing its name fields and the
 * account it lives in. Workers' Comp ad account is unambiguous; other
 * accounts get matched by keyword.
 */
function classifyAdPracticeArea(ad: MetaAdRow): string {
  if (ad.account === "workersComp") return "workers_comp";
  const haystack = `${ad.campaignName} ${ad.adsetName} ${ad.adName}`.toLowerCase();
  if (/hair[\s-]?relaxer|hrmt/.test(haystack)) return "mass_tort_hair_relaxer";
  if (/ultra[\s-]?processed|upf/.test(haystack)) return "mass_tort_upf";
  if (/dog[\s-]?bite/.test(haystack)) return "dog_bite";
  if (/workers?[\s'’-]?comp|\bwc\b|\bwcc\b/.test(haystack)) return "workers_comp";
  if (/disability|ssdi|\bssi\b|social[\s-]?security/.test(haystack)) return "disability";
  if (/auto|motor[\s-]?vehicle|\bmva\b|\bcar\b|\btruck\b|\bmotorcycle\b|rideshare|uber|lyft/.test(haystack))
    return "auto";
  if (/slip[\s-]?and[\s-]?fall|premises|trip[\s-]?and[\s-]?fall/.test(haystack))
    return "slip_and_fall";
  if (/personal[\s-]?injury|\bpi\b/.test(haystack)) return "general_pi";
  return "unknown";
}

/** Walk attributions[] on an opp and return its earliest+latest utmAdId values. */
function adIdsForOpp(o: ClassifiedOpportunity): string[] {
  const attrs = o.raw.attributions ?? [];
  const ids = new Set<string>();
  for (const a of attrs) {
    if (a.utmAdId) ids.add(a.utmAdId);
  }
  return Array.from(ids);
}

export async function costAnalytics(
  start: Date,
  end: Date,
  windowLabel: string
): Promise<CostAnalytics> {
  const warnings: string[] = [];

  // 1. Meta spend at ad level + per-account leads
  let adsRaw: MetaAdRow[] = [];
  try {
    adsRaw = await allAdInsights(start, end);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    warnings.push(`Meta ad insights fetch failed: ${msg.slice(0, 200)}`);
  }

  // 2. GHL signed-in-window, indexed by utmAdId
  const authA = authAbogado();
  const authP = authPplt();
  const [oppsA, oppsP] = await Promise.all([
    streamOpportunities(authA).then((r) => classifyOpportunities(authA, r)),
    streamOpportunities(authP).then((r) => classifyOpportunities(authP, r)),
  ]);
  const all = [...oppsA, ...oppsP];
  const sMs = start.getTime();
  const eMs = end.getTime();

  const signedByAdId = new Map<string, number>();
  for (const o of all) {
    if (!o.includeInMetrics) continue;
    if (o.stageClass !== "signed") continue;
    const ts = o.raw.lastStageChangeAt ? Date.parse(o.raw.lastStageChangeAt) : NaN;
    if (!Number.isFinite(ts) || ts < sMs || ts >= eMs) continue;
    for (const adId of adIdsForOpp(o)) {
      signedByAdId.set(adId, (signedByAdId.get(adId) ?? 0) + 1);
    }
  }

  // 3. Build per-ad rows
  const byAd: AdCostRow[] = adsRaw.map((ad) => {
    const practiceArea = classifyAdPracticeArea(ad);
    const signed = signedByAdId.get(ad.adId) ?? 0;
    return {
      adId: ad.adId,
      adName: ad.adName,
      adsetName: ad.adsetName,
      campaignName: ad.campaignName,
      account: ad.account,
      practiceArea,
      spend: ad.spend,
      leadsMeta: ad.leads,
      signed,
      cpl: ad.leads > 0 ? ad.spend / ad.leads : null,
      cpsc: signed > 0 ? ad.spend / signed : null,
    };
  });
  byAd.sort((a, b) => b.spend - a.spend);

  // 4. Roll up per practice area
  const paAgg = new Map<string, { spend: number; leads: number; signed: number; adCount: number }>();
  for (const row of byAd) {
    const slot = paAgg.get(row.practiceArea) ?? { spend: 0, leads: 0, signed: 0, adCount: 0 };
    slot.spend += row.spend;
    slot.leads += row.leadsMeta;
    slot.signed += row.signed;
    slot.adCount += 1;
    paAgg.set(row.practiceArea, slot);
  }
  const byPracticeArea: PracticeAreaCostRow[] = Array.from(paAgg.entries())
    .map(([area, v]) => ({
      area: area === "unknown" ? "Unclassified" : practiceAreaLabel(area),
      spend: v.spend,
      leadsMeta: v.leads,
      signed: v.signed,
      cpl: v.leads > 0 ? v.spend / v.leads : null,
      cpsc: v.signed > 0 ? v.spend / v.signed : null,
      adCount: v.adCount,
    }))
    .sort((a, b) => b.spend - a.spend);

  // 5. Totals
  const totalSpend = byAd.reduce((s, r) => s + r.spend, 0);
  const totalLeadsMeta = byAd.reduce((s, r) => s + r.leadsMeta, 0);
  const totalSigned = byAd.reduce((s, r) => s + r.signed, 0);

  return {
    windowLabel,
    windowStart: start.toISOString(),
    windowEnd: end.toISOString(),
    totalSpend,
    totalLeadsMeta,
    totalSigned,
    totalCpl: totalLeadsMeta > 0 ? totalSpend / totalLeadsMeta : null,
    totalCpsc: totalSigned > 0 ? totalSpend / totalSigned : null,
    byAd,
    byPracticeArea,
    warnings,
  };
}
