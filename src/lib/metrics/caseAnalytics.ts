/**
 * Case Analytics: snapshot of active cases broken down by practice area,
 * status (stage class), co-counsel firm, and state.
 *
 * State extraction: GHL stores state in multiple custom fields per location.
 * mapping.json's custom_fields list which fields have kind="state"; we look
 * them up in priority order for each opp until we find a non-empty value.
 */
import { authAbogado, authPplt } from "../ghl/client";
import { streamContacts } from "../ghl/contacts";
import {
  activeNow,
  classifyOpportunities,
  streamOpportunities,
} from "../ghl/opportunities";
import { getLocation, practiceAreaLabel } from "../mapping";
import { sortDescByCount } from "./helpers";
import type { CaseAnalytics, LocationKey } from "../types";

function stateFromOpp(
  o: ReturnType<typeof classifyOpportunities>[number],
  contactStateById: Map<string, string>,
  stateFieldIds: string[]
): string | null {
  // 1. Opportunity-level custom fields (rarely populated, but cheap to check)
  const oppCfList = o.raw.customFields ?? [];
  if (oppCfList.length > 0) {
    const cfMap = new Map(oppCfList.map((cf) => [cf.id, cf.fieldValue]));
    for (const id of stateFieldIds) {
      const v = cfMap.get(id);
      if (typeof v === "string" && v.trim()) return v.trim().toUpperCase();
    }
  }
  // 2. Joined contact's state custom field
  if (o.raw.contactId) {
    const fromContact = contactStateById.get(o.raw.contactId);
    if (fromContact) return fromContact;
  }
  // 3. contact.state direct field
  const contactState = o.raw.contact?.state;
  if (typeof contactState === "string" && contactState.trim()) {
    return contactState.trim().toUpperCase();
  }
  return null;
}

function stateFieldIdsFor(key: LocationKey): string[] {
  const loc = getLocation(key);
  // Jason: prefer "State (Jurisdiction)" first, then fall back to others.
  // Sort by a priority key: jurisdiction-named fields beat everything else,
  // and original mapping order breaks ties.
  const stateFields = loc.custom_fields.filter((c) => c.kind === "state");
  const ranked = stateFields
    .map((f, i) => ({
      f,
      priority: /jurisdiction/i.test(f.name) ? 0 : 1,
      originalIndex: i,
    }))
    .sort(
      (a, b) => a.priority - b.priority || a.originalIndex - b.originalIndex
    );
  return ranked.map((r) => r.f.id);
}

/** Build a contactId -> state map by reading the State (Jurisdiction) custom
 * field on each contact. Falls back to the contact's own `state` property. */
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

export type CaseBucket = "combined" | "english" | "spanish";

export async function caseAnalytics(bucket: CaseBucket = "combined"): Promise<CaseAnalytics> {
  const authA = authAbogado();
  const authP = authPplt();
  const stateFieldsA = stateFieldIdsFor("abogado");
  const stateFieldsP = stateFieldIdsFor("pplt_leads");

  const [oppsA, oppsP, contactsA, contactsP] = await Promise.all([
    streamOpportunities(authA).then((r) => classifyOpportunities(authA, r)),
    streamOpportunities(authP).then((r) => classifyOpportunities(authP, r)),
    streamContacts(authA),
    streamContacts(authP),
  ]);

  const contactStateA = buildContactStateIndex(contactsA, stateFieldsA);
  const contactStateP = buildContactStateIndex(contactsP, stateFieldsP);

  // Pick the right pool of opportunities for the bucket.
  let oppsBucket: typeof oppsA;
  switch (bucket) {
    case "english":
      oppsBucket = oppsP;
      break;
    case "spanish":
      oppsBucket = oppsA;
      break;
    case "combined":
    default:
      oppsBucket = [...oppsA, ...oppsP];
  }
  const active = activeNow(oppsBucket);

  const paMap = new Map<string, number>();
  const ccActiveMap = new Map<string, number>();
  const ccSignedMap = new Map<string, number>();
  const stateMap = new Map<string, number>();
  let lexamicaActive = 0;
  let litifyActive = 0;
  let lexamicaSigned = 0;
  let litifySigned = 0;

  // Active-only views (practice area, currently-with-co-counsel, state)
  for (const o of active) {
    if (o.pipelinePurpose === "active_practice") {
      const label = practiceAreaLabel(o.practiceArea);
      paMap.set(label, (paMap.get(label) ?? 0) + 1);
    } else if (
      o.pipelinePurpose === "co_counsel_tracking" ||
      o.pipelinePurpose === "referral_broker"
    ) {
      const firm = o.coCounselFirm ?? o.pipelineName;
      const firmLower = firm.toLowerCase();
      if (firmLower.includes("lexamica")) lexamicaActive++;
      else if (firmLower.includes("litify")) litifyActive++;
      else ccActiveMap.set(firm, (ccActiveMap.get(firm) ?? 0) + 1);
    }
    const idx = o.locationKey === "abogado" ? contactStateA : contactStateP;
    const fields = o.locationKey === "abogado" ? stateFieldsA : stateFieldsP;
    const st = stateFromOpp(o, idx, fields);
    if (st) stateMap.set(st, (stateMap.get(st) ?? 0) + 1);
  }

  // Signed-by-co-counsel view: ALL opps in the 180d window that reached a
  // signed stage *while in a co-counsel/referral-broker pipeline*. Counts
  // include both currently-signed and later-withdrawn-after-signing.
  for (const o of oppsBucket) {
    if (!o.includeInMetrics) continue;
    if (o.stageClass !== "signed") continue;
    if (
      o.pipelinePurpose !== "co_counsel_tracking" &&
      o.pipelinePurpose !== "referral_broker"
    )
      continue;
    const firm = o.coCounselFirm ?? o.pipelineName;
    const firmLower = firm.toLowerCase();
    if (firmLower.includes("lexamica")) lexamicaSigned++;
    else if (firmLower.includes("litify")) litifySigned++;
    else ccSignedMap.set(firm, (ccSignedMap.get(firm) ?? 0) + 1);
  }

  return {
    byPracticeArea: sortDescByCount(
      Array.from(paMap.entries()).map(([area, count]) => ({ area, count }))
    ),
    byCoCounsel: sortDescByCount(
      Array.from(ccActiveMap.entries()).map(([firm, count]) => ({ firm, count }))
    ),
    byCoCounselSigned: sortDescByCount(
      Array.from(ccSignedMap.entries()).map(([firm, count]) => ({ firm, count }))
    ),
    byState: sortDescByCount(
      Array.from(stateMap.entries()).map(([state, count]) => ({ state, count }))
    ),
    referralBrokers: {
      lexamica: lexamicaActive,
      litify: litifyActive,
    },
    referralBrokersSigned: {
      lexamica: lexamicaSigned,
      litify: litifySigned,
    },
  };
}
