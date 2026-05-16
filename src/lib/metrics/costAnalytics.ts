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
import { streamContacts } from "../ghl/contacts";
import {
  classifyOpportunities,
  streamOpportunities,
  type ClassifiedOpportunity,
} from "../ghl/opportunities";
import { getLocation, practiceAreaLabel } from "../mapping";
import type {
  AdCostRow,
  AreaStateCostRow,
  LocationKey,
  PracticeAreaCostRow,
} from "../types";

export interface CostAnalytics {
  windowLabel: string;
  windowStart: string;
  windowEnd: string;
  totalSpend: number;
  totalLeadsMeta: number;
  totalSigned: number;
  totalCpl: number | null;
  totalCpsc: number | null;
  byAd: AdCostRow[];                     // sorted by spend desc
  byPracticeArea: PracticeAreaCostRow[]; // sorted by spend desc
  byAreaState: AreaStateCostRow[];       // sorted by spend desc
  warnings: string[];
}

function stateFieldIdsFor(key: LocationKey): string[] {
  const loc = getLocation(key);
  const stateFields = loc.custom_fields.filter((c) => c.kind === "state");
  return stateFields
    .map((f, i) => ({ f, priority: /jurisdiction/i.test(f.name) ? 0 : 1, originalIndex: i }))
    .sort((a, b) => a.priority - b.priority || a.originalIndex - b.originalIndex)
    .map((r) => r.f.id);
}

function buildContactStateIndex(
  contacts: Array<{
    id: string;
    state?: string;
    customFields?: Array<{ id: string; value?: unknown }>;
  }>,
  stateFieldIds: string[]
): Map<string, string> {
  const idx = new Map<string, string>();
  for (const c of contacts) {
    let chosen: string | null = null;
    const cfList = c.customFields ?? [];
    if (cfList.length > 0) {
      const cfMap = new Map(cfList.map((cf) => [cf.id, cf.value]));
      for (const id of stateFieldIds) {
        const v = cfMap.get(id);
        if (typeof v === "string" && v.trim()) {
          chosen = v.trim().toUpperCase();
          break;
        }
      }
    }
    if (!chosen && typeof c.state === "string" && c.state.trim()) {
      chosen = c.state.trim().toUpperCase();
    }
    if (chosen) idx.set(c.id, chosen);
  }
  return idx;
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
  //    Plus contact-state index for the (area, state) rollup.
  const authA = authAbogado();
  const authP = authPplt();
  const [oppsA, oppsP, contactsA, contactsP] = await Promise.all([
    streamOpportunities(authA).then((r) => classifyOpportunities(authA, r)),
    streamOpportunities(authP).then((r) => classifyOpportunities(authP, r)),
    streamContacts(authA),
    streamContacts(authP),
  ]);
  const all = [...oppsA, ...oppsP];
  const sMs = start.getTime();
  const eMs = end.getTime();

  const contactStateA = buildContactStateIndex(contactsA, stateFieldIdsFor("abogado"));
  const contactStateP = buildContactStateIndex(contactsP, stateFieldIdsFor("pplt_leads"));

  // 3. COHORT ATTRIBUTION: bucket each opp by its createdAt (the day the
  //    lead came in), not by the day it later signed. A May sign-up from
  //    an April lead is credited to April spend. Caveats:
  //    - "Signed" = opp.stageClass is signed AT ANY POINT after createdAt.
  //      Look-ahead is unlimited inside the 180-day opp walk.
  //    - "Referred" = opp ended up in a co-counsel-tracking OR
  //      referral-broker pipeline OR a stage classified as referred_out,
  //      at any point after createdAt.
  //    - "cohortMaturing" flags windows that end < 60 days ago, where new
  //      sign-ups may still arrive.
  const DAY_MS = 24 * 3600 * 1000;
  const cohortMaturing = eMs > Date.now() - 60 * DAY_MS;

  interface CohortAgg {
    signed: number;
    referred: number;
    daysToSignedSum: number;
    daysToSignedCount: number;
    daysToReferredSum: number;
    daysToReferredCount: number;
  }
  const emptyCohort = (): CohortAgg => ({
    signed: 0,
    referred: 0,
    daysToSignedSum: 0,
    daysToSignedCount: 0,
    daysToReferredSum: 0,
    daysToReferredCount: 0,
  });
  const cohortByAdId = new Map<string, CohortAgg>();

  for (const o of all) {
    if (!o.includeInMetrics) continue;
    const created = o.raw.createdAt ? Date.parse(o.raw.createdAt) : NaN;
    if (!Number.isFinite(created) || created < sMs || created >= eMs) continue;
    const adIds = adIdsForOpp(o);
    if (adIds.length === 0) continue;
    // Last-touch attribution to avoid double-counting an opp across ads.
    const adId = adIds[adIds.length - 1];
    const slot = cohortByAdId.get(adId) ?? emptyCohort();

    const lastChange = o.raw.lastStageChangeAt ? Date.parse(o.raw.lastStageChangeAt) : NaN;
    if (Number.isFinite(lastChange) && lastChange >= created) {
      if (o.stageClass === "signed") {
        slot.signed += 1;
        slot.daysToSignedSum += (lastChange - created) / DAY_MS;
        slot.daysToSignedCount += 1;
      }
      if (
        o.stageClass === "referred_out" ||
        o.pipelinePurpose === "co_counsel_tracking" ||
        o.pipelinePurpose === "referral_broker"
      ) {
        slot.referred += 1;
        slot.daysToReferredSum += (lastChange - created) / DAY_MS;
        slot.daysToReferredCount += 1;
      }
    }
    cohortByAdId.set(adId, slot);
  }

  // 4. Build per-ad rows with cohort numbers
  const byAd: AdCostRow[] = adsRaw.map((ad) => {
    const practiceArea = classifyAdPracticeArea(ad);
    const cohort = cohortByAdId.get(ad.adId) ?? emptyCohort();
    return {
      adId: ad.adId,
      adName: ad.adName,
      adsetName: ad.adsetName,
      campaignName: ad.campaignName,
      account: ad.account,
      practiceArea,
      spend: ad.spend,
      leadsMeta: ad.leads,
      signed: cohort.signed,
      referred: cohort.referred,
      cpl: ad.leads > 0 ? ad.spend / ad.leads : null,
      cpsc: cohort.signed > 0 ? ad.spend / cohort.signed : null,
      avgDaysToSigned:
        cohort.daysToSignedCount > 0
          ? cohort.daysToSignedSum / cohort.daysToSignedCount
          : null,
      avgDaysToReferred:
        cohort.daysToReferredCount > 0
          ? cohort.daysToReferredSum / cohort.daysToReferredCount
          : null,
      cohortMaturing,
    };
  });
  byAd.sort((a, b) => b.spend - a.spend);

  // 5. Roll up per practice area
  interface PaAgg {
    spend: number;
    leads: number;
    signed: number;
    referred: number;
    adCount: number;
    dts: number;
    dtsCount: number;
    dtr: number;
    dtrCount: number;
  }
  const paAgg = new Map<string, PaAgg>();
  for (const row of byAd) {
    const slot = paAgg.get(row.practiceArea) ?? {
      spend: 0, leads: 0, signed: 0, referred: 0, adCount: 0,
      dts: 0, dtsCount: 0, dtr: 0, dtrCount: 0,
    };
    slot.spend += row.spend;
    slot.leads += row.leadsMeta;
    slot.signed += row.signed;
    slot.referred += row.referred;
    slot.adCount += 1;
    if (row.avgDaysToSigned !== null && row.signed > 0) {
      slot.dts += row.avgDaysToSigned * row.signed;
      slot.dtsCount += row.signed;
    }
    if (row.avgDaysToReferred !== null && row.referred > 0) {
      slot.dtr += row.avgDaysToReferred * row.referred;
      slot.dtrCount += row.referred;
    }
    paAgg.set(row.practiceArea, slot);
  }
  const byPracticeArea: PracticeAreaCostRow[] = Array.from(paAgg.entries())
    .map(([area, v]) => ({
      area: area === "unknown" ? "Unclassified" : practiceAreaLabel(area),
      spend: v.spend,
      leadsMeta: v.leads,
      signed: v.signed,
      referred: v.referred,
      cpl: v.leads > 0 ? v.spend / v.leads : null,
      cpsc: v.signed > 0 ? v.spend / v.signed : null,
      avgDaysToSigned: v.dtsCount > 0 ? v.dts / v.dtsCount : null,
      avgDaysToReferred: v.dtrCount > 0 ? v.dtr / v.dtrCount : null,
      adCount: v.adCount,
      cohortMaturing,
    }))
    .sort((a, b) => b.spend - a.spend);

  // 5. By (Area, State) — attribute each opp's share of its source ad's
  //    spend (spend / Meta-leads). Walks opps in window with a utmAdId,
  //    joins to the ad to derive area + cost-per-lead, joins to contact
  //    for state.
  const adById = new Map<string, AdCostRow>();
  for (const r of byAd) adById.set(r.adId, r);

  interface AreaStateAgg {
    area: string;
    state: string;
    spend: number;
    leads: number;
    signed: number;
    referred: number;
    dts: number;
    dtsCount: number;
    dtr: number;
    dtrCount: number;
  }
  const byAreaStateMap = new Map<string, AreaStateAgg>();
  for (const o of all) {
    if (!o.includeInMetrics) continue;
    // Cohort: lead must have come in during the window.
    const created = o.raw.createdAt ? Date.parse(o.raw.createdAt) : NaN;
    if (!Number.isFinite(created) || created < sMs || created >= eMs) continue;
    const adIds = adIdsForOpp(o);
    if (adIds.length === 0) continue;
    const adId = adIds[adIds.length - 1];
    const ad = adById.get(adId);
    if (!ad || ad.leadsMeta === 0) continue;
    const costPerLead = ad.spend / ad.leadsMeta;
    const stateIdx = o.locationKey === "abogado" ? contactStateA : contactStateP;
    const state =
      (o.raw.contactId && stateIdx.get(o.raw.contactId)) ||
      (typeof o.raw.contact?.state === "string" ? o.raw.contact.state.trim().toUpperCase() : null) ||
      "Unknown";
    const areaKey = ad.practiceArea === "unknown" ? "Unclassified" : practiceAreaLabel(ad.practiceArea);
    const key = `${areaKey}|||${state}`;
    let slot = byAreaStateMap.get(key);
    if (!slot) {
      slot = {
        area: areaKey, state, spend: 0, leads: 0, signed: 0, referred: 0,
        dts: 0, dtsCount: 0, dtr: 0, dtrCount: 0,
      };
      byAreaStateMap.set(key, slot);
    }
    slot.leads += 1;
    slot.spend += costPerLead;

    const lastChange = o.raw.lastStageChangeAt ? Date.parse(o.raw.lastStageChangeAt) : NaN;
    if (Number.isFinite(lastChange) && lastChange >= created) {
      if (o.stageClass === "signed") {
        slot.signed += 1;
        slot.dts += (lastChange - created) / DAY_MS;
        slot.dtsCount += 1;
      }
      if (
        o.stageClass === "referred_out" ||
        o.pipelinePurpose === "co_counsel_tracking" ||
        o.pipelinePurpose === "referral_broker"
      ) {
        slot.referred += 1;
        slot.dtr += (lastChange - created) / DAY_MS;
        slot.dtrCount += 1;
      }
    }
  }

  const byAreaState: AreaStateCostRow[] = Array.from(byAreaStateMap.values())
    .map((r) => ({
      area: r.area,
      state: r.state,
      spend: r.spend,
      leads: r.leads,
      signed: r.signed,
      referred: r.referred,
      cpl: r.leads > 0 ? r.spend / r.leads : null,
      cpsc: r.signed > 0 ? r.spend / r.signed : null,
      avgDaysToSigned: r.dtsCount > 0 ? r.dts / r.dtsCount : null,
      avgDaysToReferred: r.dtrCount > 0 ? r.dtr / r.dtrCount : null,
      cohortMaturing,
    }))
    .sort((a, b) => b.spend - a.spend);

  // 6. Totals
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
    byAreaState,
    warnings,
  };
}
