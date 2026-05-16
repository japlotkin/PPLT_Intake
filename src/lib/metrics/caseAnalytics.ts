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
import { getLocation, practiceAreaLabel, stageClassLabel } from "../mapping";
import { sortDescByCount } from "./helpers";
import type { CaseAnalytics, LocationKey } from "../types";

const REFERRAL_BROKER_NAMES = new Set(["lexamica", "litify"]);

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

  const activeA = activeNow(oppsA);
  const activeP = activeNow(oppsP);
  let all: typeof activeA;
  switch (bucket) {
    case "english":
      all = activeP; // PPLT = English book
      break;
    case "spanish":
      all = activeA; // Abogado = Spanish book
      break;
    case "combined":
    default:
      all = [...activeA, ...activeP];
  }

  const paMap = new Map<string, number>();
  const stMap = new Map<string, number>();
  const ccMap = new Map<string, number>();
  const stateMap = new Map<string, number>();
  let lexamicaCount = 0;
  let litifyCount = 0;

  for (const o of all) {
    if (o.pipelinePurpose === "active_practice") {
      const label = practiceAreaLabel(o.practiceArea);
      paMap.set(label, (paMap.get(label) ?? 0) + 1);
    } else if (
      o.pipelinePurpose === "co_counsel_tracking" ||
      o.pipelinePurpose === "referral_broker"
    ) {
      const firm = o.coCounselFirm ?? o.pipelineName;
      const firmLower = firm.toLowerCase();
      // Lexamica and Litify are referral *brokers*, not co-counsel firms;
      // they swamp the chart and obscure the named firms. Track them
      // separately and surface as a footnote.
      if (firmLower.includes("lexamica")) {
        lexamicaCount++;
      } else if (firmLower.includes("litify")) {
        litifyCount++;
      } else {
        ccMap.set(firm, (ccMap.get(firm) ?? 0) + 1);
      }
    }
    const statusLabel = stageClassLabel(o.stageClass);
    stMap.set(statusLabel, (stMap.get(statusLabel) ?? 0) + 1);

    const idx = o.locationKey === "abogado" ? contactStateA : contactStateP;
    const fields = o.locationKey === "abogado" ? stateFieldsA : stateFieldsP;
    const st = stateFromOpp(o, idx, fields);
    if (st) stateMap.set(st, (stateMap.get(st) ?? 0) + 1);
  }

  return {
    byPracticeArea: sortDescByCount(
      Array.from(paMap.entries()).map(([area, count]) => ({ area, count }))
    ),
    byStatus: sortDescByCount(
      Array.from(stMap.entries()).map(([status, count]) => ({ status, count }))
    ),
    byCoCounsel: sortDescByCount(
      Array.from(ccMap.entries()).map(([firm, count]) => ({ firm, count }))
    ),
    byState: sortDescByCount(
      Array.from(stateMap.entries()).map(([state, count]) => ({ state, count }))
    ),
    referralBrokers: {
      lexamica: lexamicaCount,
      litify: litifyCount,
    },
  };
}

void REFERRAL_BROKER_NAMES; // exported constant reserved for future use
