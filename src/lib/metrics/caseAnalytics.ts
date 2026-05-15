/**
 * Case Analytics: snapshot of active cases broken down by practice area,
 * status (stage class), co-counsel firm, and state.
 *
 * State extraction: GHL stores state in multiple custom fields per location.
 * mapping.json's custom_fields list which fields have kind="state"; we look
 * them up in priority order for each opp until we find a non-empty value.
 */
import { authAbogado, authPplt } from "../ghl/client";
import {
  activeNow,
  classifyOpportunities,
  streamOpportunities,
} from "../ghl/opportunities";
import { getLocation, practiceAreaLabel, stageClassLabel } from "../mapping";
import { sortDescByCount } from "./helpers";
import type { CaseAnalytics, LocationKey } from "../types";

function stateFromOpp(
  o: ReturnType<typeof classifyOpportunities>[number],
  stateFieldIds: string[]
): string | null {
  const cfList = o.raw.customFields ?? [];
  const cfMap = new Map(cfList.map((cf) => [cf.id, cf.fieldValue]));
  for (const id of stateFieldIds) {
    const v = cfMap.get(id);
    if (typeof v === "string" && v.trim()) return v.trim().toUpperCase();
  }
  // Fall back to contact.state if attached
  const contactState = o.raw.contact?.state;
  if (typeof contactState === "string" && contactState.trim()) {
    return contactState.trim().toUpperCase();
  }
  return null;
}

function stateFieldIdsFor(key: LocationKey): string[] {
  const loc = getLocation(key);
  return loc.custom_fields.filter((c) => c.kind === "state").map((c) => c.id);
}

export async function caseAnalytics(): Promise<CaseAnalytics> {
  const authA = authAbogado();
  const authP = authPplt();
  const [oppsA, oppsP] = await Promise.all([
    streamOpportunities(authA).then((r) => classifyOpportunities(authA, r)),
    streamOpportunities(authP).then((r) => classifyOpportunities(authP, r)),
  ]);

  const activeA = activeNow(oppsA);
  const activeP = activeNow(oppsP);
  const all = [...activeA, ...activeP];

  const stateFieldsA = stateFieldIdsFor("abogado");
  const stateFieldsP = stateFieldIdsFor("pplt_leads");

  const paMap = new Map<string, number>();
  const stMap = new Map<string, number>();
  const ccMap = new Map<string, number>();
  const stateMap = new Map<string, number>();

  for (const o of all) {
    // Practice area: only count in-house pipelines (co-counsel pipelines counted separately)
    if (o.pipelinePurpose === "active_practice") {
      const label = practiceAreaLabel(o.practiceArea);
      paMap.set(label, (paMap.get(label) ?? 0) + 1);
    } else if (
      o.pipelinePurpose === "co_counsel_tracking" ||
      o.pipelinePurpose === "referral_broker"
    ) {
      const firm = o.coCounselFirm ?? o.pipelineName;
      ccMap.set(firm, (ccMap.get(firm) ?? 0) + 1);
    }
    // Status (stage class) snapshot across all active
    const statusLabel = stageClassLabel(o.stageClass);
    stMap.set(statusLabel, (stMap.get(statusLabel) ?? 0) + 1);

    // State
    const fields = o.locationKey === "abogado" ? stateFieldsA : stateFieldsP;
    const st = stateFromOpp(o, fields);
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
  };
}
