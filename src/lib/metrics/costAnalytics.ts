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
import {
  readMetaAdsCache,
  writeMetaAdsCache,
  windowKeyFor,
} from "../metaAdsCache";
import { authAbogado, authPplt } from "../ghl/client";
import { streamContacts, isMetaLeadFormSource } from "../ghl/contacts";
import {
  classifyOpportunities,
  streamOpportunities,
  type ClassifiedOpportunity,
} from "../ghl/opportunities";
import {
  getOppCustomFieldIds,
  normalizePracticeAreaValue,
  readOppCustomField,
  type OppFieldIds,
} from "../ghl/customFields";
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
  /** TOTAL signs in window regardless of utmAdId. Sums signedAll across
   *  both GHL locations. Used by the UI to surface the attribution gap. */
  totalSignedAll: number;
  /** Signs without utmAdId but with a Meta-pattern contact source. */
  totalSignedMetaSource: number;
  /** Signs whose Practice Area (Opportunity) custom field was populated. */
  oppPracticeAreaHits: number;
  /** Signs whose field was blank — bucketing fell back to pipeline.practice_area. */
  oppPracticeAreaMisses: number;
  totalCpl: number | null;
  totalCpsc: number | null;
  byAd: AdCostRow[];                     // sorted by spend desc
  byPracticeArea: PracticeAreaCostRow[]; // sorted by spend desc
  byAreaState: AreaStateCostRow[];       // sorted by spend desc
  warnings: string[];
  /** ISO timestamp of the cached Meta pull we fell back to, if any. */
  metaStaleAsOf?: string;
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

  // 1. Meta spend at ad level + per-account leads.
  //    On success: refresh the KV cache for this window.
  //    On failure: fall back to the last-successful pull so the section
  //    doesn't go blank when Meta blocks the token.
  let adsRaw: MetaAdRow[] = [];
  let metaStaleAsOf: string | undefined;
  const cacheKey = windowKeyFor(start, end);
  try {
    adsRaw = await allAdInsights(start, end);
    if (adsRaw.length > 0) {
      await writeMetaAdsCache(cacheKey, {
        syncedAt: new Date().toISOString(),
        startISO: start.toISOString(),
        endISO: end.toISOString(),
        ads: adsRaw,
      }).catch(() => {
        /* cache write failure is non-fatal */
      });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    warnings.push(`Meta ad insights fetch failed: ${msg.slice(0, 200)}`);
    const cached = await readMetaAdsCache(cacheKey).catch(() => null);
    if (cached && cached.ads.length > 0) {
      adsRaw = cached.ads;
      metaStaleAsOf = cached.syncedAt;
      warnings.push(
        `Using cached Meta data from ${new Date(cached.syncedAt).toLocaleString()} (live fetch blocked).`
      );
    }
  }

  // 2. GHL signed-in-window, indexed by utmAdId
  //    Plus contact-state index for the (area, state) rollup.
  //    Plus the opp-level "Practice Area (Opportunity)" custom-field IDs
  //    (discovered at runtime; mapping.json doesn't catalog opp-level fields).
  const authA = authAbogado();
  const authP = authPplt();
  const [oppsA, oppsP, contactsA, contactsP, oppFieldsA, oppFieldsP] =
    await Promise.all([
      streamOpportunities(authA).then((r) => classifyOpportunities(authA, r)),
      streamOpportunities(authP).then((r) => classifyOpportunities(authP, r)),
      streamContacts(authA),
      streamContacts(authP),
      getOppCustomFieldIds(authA),
      getOppCustomFieldIds(authP),
    ]);
  const all = [...oppsA, ...oppsP];
  const oppFieldsByKey: Record<"abogado" | "pplt_leads", OppFieldIds> = {
    abogado: oppFieldsA,
    pplt_leads: oppFieldsP,
  };
  // Surface discovery failures as warnings — PIT tokens are supposed to
  // have read access to /customFields, so silent fallback would hide a
  // real config problem.
  if (oppFieldsA.discoveryError) {
    warnings.push(
      `Abogado opp custom-field discovery failed: ${oppFieldsA.discoveryError}. Practice Area bucketing will fall back to pipeline.practice_area for Abogado signs.`
    );
  }
  if (oppFieldsP.discoveryError) {
    warnings.push(
      `PPLT Leads opp custom-field discovery failed: ${oppFieldsP.discoveryError}. Practice Area bucketing will fall back to pipeline.practice_area for PPLT signs.`
    );
  }
  // Also warn if discovery worked but the Practice Area field is not
  // configured in a location (e.g. the user added it in PPLT but not
  // Abogado yet).
  if (!oppFieldsA.discoveryError && oppFieldsA.practiceArea === null && (oppFieldsA.fieldCount ?? 0) > 0) {
    warnings.push(
      "Abogado is missing the 'Practice Area (Opportunity)' custom field. Add it in GHL → Custom Fields → Opportunity tab so signs bucket correctly."
    );
  }
  if (!oppFieldsP.discoveryError && oppFieldsP.practiceArea === null && (oppFieldsP.fieldCount ?? 0) > 0) {
    warnings.push(
      "PPLT Leads is missing the 'Practice Area (Opportunity)' custom field. Add it in GHL → Custom Fields → Opportunity tab so signs bucket correctly."
    );
  }

  /**
   * Resolve an opp's practice area. Source of truth (in order):
   *   1. opportunity.practice_area_opportunity custom field — what the
   *      Meta lead form / intake rep selected for THIS case
   *   2. pipeline.practice_area from mapping.json — pipeline assignment,
   *      which buckets everything into "general_pi" for the Maryland
   *      in-house catch-all pipeline
   * Returns the canonical key (e.g. "auto", "dog_bite") or "unknown".
   */
  function oppPracticeArea(o: ClassifiedOpportunity): string {
    const fieldId = oppFieldsByKey[o.locationKey].practiceArea;
    const raw = readOppCustomField(o.raw.customFields, fieldId);
    const normalized = normalizePracticeAreaValue(raw);
    if (normalized) return normalized;
    return o.practiceArea ?? "unknown";
  }
  // Track how often the custom field is populated so the UI can show
  // "X% of signs are tagged at the opp level" — a data-quality signal.
  let oppPaFieldHits = 0;
  let oppPaFieldMisses = 0;
  const sMs = start.getTime();
  const eMs = end.getTime();

  const contactStateA = buildContactStateIndex(contactsA, stateFieldIdsFor("abogado"));
  const contactStateP = buildContactStateIndex(contactsP, stateFieldIdsFor("pplt_leads"));

  // Contact -> source. Used to recover signs whose opp lost its utmAdId
  // during the contact -> opportunity transfer in GHL. If the contact's
  // source string still references Facebook / Instagram / Meta, we credit
  // the sign as "Meta-source" even without a specific ad ID.
  const contactSourceA = new Map<string, string>();
  for (const c of contactsA) {
    if (typeof c.source === "string" && c.source.trim()) {
      contactSourceA.set(c.id, c.source);
    }
  }
  const contactSourceP = new Map<string, string>();
  for (const c of contactsP) {
    if (typeof c.source === "string" && c.source.trim()) {
      contactSourceP.set(c.id, c.source);
    }
  }

  // 3. DUAL ATTRIBUTION: compute BOTH lenses on the same pass.
  //    Same-window: stage flipped to signed/referred IN [start, end).
  //                 Matches Ads Manager. Reconciles to a monthly report.
  //    Cohort:      lead came in [start, end), eventually reached
  //                 signed/referred AT ANY POINT. True CAC view.
  //    LEADS column always uses lead-date (cohort-style) so it ties
  //    to Meta's lead-form count.
  const DAY_MS = 24 * 3600 * 1000;
  const cohortMaturing = eMs > Date.now() - 60 * DAY_MS;

  interface AdAgg {
    leads: number;
    // Same-window
    signed: number;
    referred: number;
    daysToSignedSum: number;
    daysToSignedCount: number;
    daysToReferredSum: number;
    daysToReferredCount: number;
    // Cohort
    signedCohort: number;
    referredCohort: number;
  }
  const emptyAgg = (): AdAgg => ({
    leads: 0,
    signed: 0,
    referred: 0,
    daysToSignedSum: 0,
    daysToSignedCount: 0,
    daysToReferredSum: 0,
    daysToReferredCount: 0,
    signedCohort: 0,
    referredCohort: 0,
  });
  const aggByAdId = new Map<string, AdAgg>();

  for (const o of all) {
    if (!o.includeInMetrics) continue;
    const adIds = adIdsForOpp(o);
    if (adIds.length === 0) continue;
    // Last-touch attribution to avoid double-counting an opp across ads.
    const adId = adIds[adIds.length - 1];
    const slot = aggByAdId.get(adId) ?? emptyAgg();

    const created = o.raw.createdAt ? Date.parse(o.raw.createdAt) : NaN;
    const lastChange = o.raw.lastStageChangeAt ? Date.parse(o.raw.lastStageChangeAt) : NaN;
    const leadInWindow =
      Number.isFinite(created) && created >= sMs && created < eMs;
    const signedNow = o.stageClass === "signed";
    const referredNow =
      o.stageClass === "referred_out" ||
      o.pipelinePurpose === "co_counsel_tracking" ||
      o.pipelinePurpose === "referral_broker";
    const stageFlippedInWindow =
      Number.isFinite(lastChange) && lastChange >= sMs && lastChange < eMs;

    if (leadInWindow) slot.leads += 1;

    // Same-window: stage flipped in the window.
    if (signedNow && stageFlippedInWindow) {
      slot.signed += 1;
      if (Number.isFinite(created) && lastChange >= created) {
        slot.daysToSignedSum += (lastChange - created) / DAY_MS;
        slot.daysToSignedCount += 1;
      }
    }
    if (referredNow && stageFlippedInWindow) {
      slot.referred += 1;
      if (Number.isFinite(created) && lastChange >= created) {
        slot.daysToReferredSum += (lastChange - created) / DAY_MS;
        slot.daysToReferredCount += 1;
      }
    }
    // Cohort: lead in window, current state is signed/referred.
    if (leadInWindow && signedNow) slot.signedCohort += 1;
    if (leadInWindow && referredNow) slot.referredCohort += 1;

    aggByAdId.set(adId, slot);
  }

  // 3b. ALL-SIGNS PASS (no utmAdId filter).
  //     Walks every signed-in-window opp regardless of Meta attribution
  //     and buckets by the opp's pipeline.practice_area + contact state.
  //     This surfaces the gap between "signs the dashboard credits to
  //     Meta ads" and "total signs from any source" (referrals, organic,
  //     direct, returning clients, walk-ins, etc.).
  const signedAllByPa = new Map<string, number>();
  const signedAllByAreaState = new Map<string, number>();
  // Meta-source recovery: signs WITHOUT utmAdId whose contact.source
  // matches Facebook/Instagram/Meta lead-form patterns. Disjoint from
  // the utmAdId-attributed `signed` counter.
  const signedMetaSourceByPa = new Map<string, number>();
  const signedMetaSourceByAreaState = new Map<string, number>();
  let totalSignedAll = 0;
  let totalSignedMetaSource = 0;
  for (const o of all) {
    if (!o.includeInMetrics) continue;
    if (o.stageClass !== "signed") continue;
    const lastChange = o.raw.lastStageChangeAt ? Date.parse(o.raw.lastStageChangeAt) : NaN;
    if (!Number.isFinite(lastChange) || lastChange < sMs || lastChange >= eMs) continue;
    totalSignedAll += 1;
    // Prefer the opp-level Practice Area custom field over the pipeline's
    // practice_area mapping. This keeps "General PI" honest: signs only
    // land there when the rep actually marked the case as general PI, not
    // because the in-house Maryland pipeline defaults everything to PI.
    const fieldId = oppFieldsByKey[o.locationKey].practiceArea;
    const fieldRaw = readOppCustomField(o.raw.customFields, fieldId);
    const fieldNormalized = normalizePracticeAreaValue(fieldRaw);
    if (fieldNormalized) oppPaFieldHits++;
    else oppPaFieldMisses++;
    const paKey = fieldNormalized ?? o.practiceArea ?? "unknown";
    const paLabel = paKey === "unknown" ? "Unclassified" : practiceAreaLabel(paKey);
    signedAllByPa.set(paLabel, (signedAllByPa.get(paLabel) ?? 0) + 1);

    const stateIdx = o.locationKey === "abogado" ? contactStateA : contactStateP;
    const state =
      (o.raw.contactId && stateIdx.get(o.raw.contactId)) ||
      (typeof o.raw.contact?.state === "string" ? o.raw.contact.state.trim().toUpperCase() : null) ||
      "Unknown";
    const asKey = `${paLabel}|||${state}`;
    signedAllByAreaState.set(asKey, (signedAllByAreaState.get(asKey) ?? 0) + 1);

    // Meta-source fallback: only counts when there's NO utmAdId (would be
    // double-counted with the per-ad `signed` total otherwise) AND the
    // contact source pattern-matches Meta.
    const adIdsForThis = adIdsForOpp(o);
    if (adIdsForThis.length === 0) {
      const srcIdx = o.locationKey === "abogado" ? contactSourceA : contactSourceP;
      // ClassifiedOpportunity.raw.contact is narrowly typed (state only).
      // GHL returns source on the same object — cast to read it.
      const oppContact = o.raw.contact as { source?: unknown } | undefined;
      const inlineSrc = typeof oppContact?.source === "string" ? oppContact.source : null;
      const src =
        (o.raw.contactId && srcIdx.get(o.raw.contactId)) ||
        inlineSrc ||
        null;
      if (isMetaLeadFormSource(src)) {
        totalSignedMetaSource += 1;
        signedMetaSourceByPa.set(paLabel, (signedMetaSourceByPa.get(paLabel) ?? 0) + 1);
        signedMetaSourceByAreaState.set(asKey, (signedMetaSourceByAreaState.get(asKey) ?? 0) + 1);
      }
    }
  }

  // 4. Build per-ad rows (both lenses).
  const byAd: AdCostRow[] = adsRaw.map((ad) => {
    const practiceArea = classifyAdPracticeArea(ad);
    const agg = aggByAdId.get(ad.adId) ?? emptyAgg();
    return {
      adId: ad.adId,
      adName: ad.adName,
      adsetName: ad.adsetName,
      campaignName: ad.campaignName,
      account: ad.account,
      practiceArea,
      spend: ad.spend,
      leadsMeta: ad.leads,
      signed: agg.signed,
      referred: agg.referred,
      signedCohort: agg.signedCohort,
      referredCohort: agg.referredCohort,
      cpl: ad.leads > 0 ? ad.spend / ad.leads : null,
      cpsc: agg.signed > 0 ? ad.spend / agg.signed : null,
      cpscCohort: agg.signedCohort > 0 ? ad.spend / agg.signedCohort : null,
      avgDaysToSigned:
        agg.daysToSignedCount > 0
          ? agg.daysToSignedSum / agg.daysToSignedCount
          : null,
      avgDaysToReferred:
        agg.daysToReferredCount > 0
          ? agg.daysToReferredSum / agg.daysToReferredCount
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
    signedCohort: number;
    referredCohort: number;
    adCount: number;
    dts: number;
    dtsCount: number;
    dtr: number;
    dtrCount: number;
  }
  const paAgg = new Map<string, PaAgg>();
  for (const row of byAd) {
    const slot = paAgg.get(row.practiceArea) ?? {
      spend: 0, leads: 0, signed: 0, referred: 0,
      signedCohort: 0, referredCohort: 0, adCount: 0,
      dts: 0, dtsCount: 0, dtr: 0, dtrCount: 0,
    };
    slot.spend += row.spend;
    slot.leads += row.leadsMeta;
    slot.signed += row.signed;
    slot.referred += row.referred;
    slot.signedCohort += row.signedCohort;
    slot.referredCohort += row.referredCohort;
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
    .map(([area, v]) => {
      const areaLabel = area === "unknown" ? "Unclassified" : practiceAreaLabel(area);
      return {
        area: areaLabel,
        spend: v.spend,
        leadsMeta: v.leads,
        signed: v.signed,
        referred: v.referred,
        signedCohort: v.signedCohort,
        referredCohort: v.referredCohort,
        signedAll: signedAllByPa.get(areaLabel) ?? 0,
        signedMetaSource: signedMetaSourceByPa.get(areaLabel) ?? 0,
        cpl: v.leads > 0 ? v.spend / v.leads : null,
        cpsc: v.signed > 0 ? v.spend / v.signed : null,
        cpscCohort: v.signedCohort > 0 ? v.spend / v.signedCohort : null,
        avgDaysToSigned: v.dtsCount > 0 ? v.dts / v.dtsCount : null,
        avgDaysToReferred: v.dtrCount > 0 ? v.dtr / v.dtrCount : null,
        adCount: v.adCount,
        cohortMaturing,
      };
    });
  // Add rows for practice areas that have signs but NO ad spend (referrals,
  // organic, walk-ins). These rows show $0 spend with the full sign count
  // so the table sums match the firm's total signed-in-window.
  const paLabelsInTable = new Set(byPracticeArea.map((r) => r.area));
  for (const [label, count] of signedAllByPa.entries()) {
    if (paLabelsInTable.has(label)) continue;
    byPracticeArea.push({
      area: label,
      spend: 0,
      leadsMeta: 0,
      signed: 0,
      referred: 0,
      signedCohort: 0,
      referredCohort: 0,
      signedAll: count,
      signedMetaSource: signedMetaSourceByPa.get(label) ?? 0,
      cpl: null,
      cpsc: null,
      cpscCohort: null,
      avgDaysToSigned: null,
      avgDaysToReferred: null,
      adCount: 0,
      cohortMaturing,
    });
  }
  byPracticeArea.sort((a, b) => b.spend - a.spend || (b.signedAll ?? 0) - (a.signedAll ?? 0));

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
    signedCohort: number;
    referredCohort: number;
    dts: number;
    dtsCount: number;
    dtr: number;
    dtrCount: number;
  }
  const byAreaStateMap = new Map<string, AreaStateAgg>();
  for (const o of all) {
    if (!o.includeInMetrics) continue;
    const adIds = adIdsForOpp(o);
    if (adIds.length === 0) continue;
    const adId = adIds[adIds.length - 1];
    const ad = adById.get(adId);
    if (!ad || ad.leadsMeta === 0) continue;

    const created = o.raw.createdAt ? Date.parse(o.raw.createdAt) : NaN;
    const lastChange = o.raw.lastStageChangeAt ? Date.parse(o.raw.lastStageChangeAt) : NaN;
    const leadInWindow =
      Number.isFinite(created) && created >= sMs && created < eMs;
    const signedNow = o.stageClass === "signed";
    const referredNow =
      o.stageClass === "referred_out" ||
      o.pipelinePurpose === "co_counsel_tracking" ||
      o.pipelinePurpose === "referral_broker";
    const stageFlippedInWindow =
      Number.isFinite(lastChange) && lastChange >= sMs && lastChange < eMs;
    if (!leadInWindow && !(stageFlippedInWindow && (signedNow || referredNow))) continue;

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
        signedCohort: 0, referredCohort: 0,
        dts: 0, dtsCount: 0, dtr: 0, dtrCount: 0,
      };
      byAreaStateMap.set(key, slot);
    }
    if (leadInWindow) {
      slot.leads += 1;
      slot.spend += costPerLead;
      if (signedNow) slot.signedCohort += 1;
      if (referredNow) slot.referredCohort += 1;
    }
    if (signedNow && stageFlippedInWindow) {
      slot.signed += 1;
      if (Number.isFinite(created) && lastChange >= created) {
        slot.dts += (lastChange - created) / DAY_MS;
        slot.dtsCount += 1;
      }
    }
    if (referredNow && stageFlippedInWindow) {
      slot.referred += 1;
      if (Number.isFinite(created) && lastChange >= created) {
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
      signedCohort: r.signedCohort,
      referredCohort: r.referredCohort,
      signedAll: signedAllByAreaState.get(`${r.area}|||${r.state}`) ?? 0,
      signedMetaSource: signedMetaSourceByAreaState.get(`${r.area}|||${r.state}`) ?? 0,
      cpl: r.leads > 0 ? r.spend / r.leads : null,
      cpsc: r.signed > 0 ? r.spend / r.signed : null,
      cpscCohort: r.signedCohort > 0 ? r.spend / r.signedCohort : null,
      avgDaysToSigned: r.dtsCount > 0 ? r.dts / r.dtsCount : null,
      avgDaysToReferred: r.dtrCount > 0 ? r.dtr / r.dtrCount : null,
      cohortMaturing,
    }));
  // Add (area, state) rows for signs from any source — referrals, walk-ins,
  // organic — so the table reflects the firm's true sign volume.
  const asKeysInTable = new Set(byAreaState.map((r) => `${r.area}|||${r.state}`));
  for (const [key, count] of signedAllByAreaState.entries()) {
    if (asKeysInTable.has(key)) continue;
    const [area, state] = key.split("|||");
    byAreaState.push({
      area,
      state,
      spend: 0,
      leads: 0,
      signed: 0,
      referred: 0,
      signedCohort: 0,
      referredCohort: 0,
      signedAll: count,
      signedMetaSource: signedMetaSourceByAreaState.get(key) ?? 0,
      cpl: null,
      cpsc: null,
      cpscCohort: null,
      avgDaysToSigned: null,
      avgDaysToReferred: null,
      cohortMaturing,
    });
  }
  byAreaState.sort((a, b) => b.spend - a.spend || (b.signedAll ?? 0) - (a.signedAll ?? 0));

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
    totalSignedAll,
    totalSignedMetaSource,
    oppPracticeAreaHits: oppPaFieldHits,
    oppPracticeAreaMisses: oppPaFieldMisses,
    totalCpl: totalLeadsMeta > 0 ? totalSpend / totalLeadsMeta : null,
    totalCpsc: totalSigned > 0 ? totalSpend / totalSigned : null,
    byAd,
    byPracticeArea,
    byAreaState,
    warnings,
    metaStaleAsOf,
  };
}
