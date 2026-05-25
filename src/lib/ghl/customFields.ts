/**
 * Discover and cache opportunity-level custom-field IDs.
 *
 * mapping.json only contains contact-level custom fields. For opp-level
 * fields (e.g. "Practice Area (Opportunity)") we hit GHL's customFields
 * endpoint once per process and memoize the ID lookup.
 *
 * Why opportunity-level: a contact can submit multiple Meta lead forms
 * across time for different case types. Storing practice area on the
 * contact would overwrite the historical sign attribution; storing it
 * on the opportunity preserves it.
 */
import { getV2, type GhlAuth } from "./client";

interface CustomFieldDef {
  id: string;
  name?: string;
  fieldKey?: string;
  dataType?: string;
  model?: string;
}

interface ListResp {
  customFields?: CustomFieldDef[];
}

const TTL_MS = 60 * 60 * 1000; // 1h
const cache = new Map<string, { expires: number; ids: OppFieldIds }>();

export interface OppFieldIds {
  practiceArea: string | null;
  state: string | null;
}

/**
 * Look up the opportunity-level "Practice Area" + "State" field IDs for
 * a location. Returns nulls when the field doesn't exist (so older
 * locations without the field still work).
 */
export async function getOppCustomFieldIds(auth: GhlAuth): Promise<OppFieldIds> {
  const cacheKey = auth.locationId;
  const now = Date.now();
  const hit = cache.get(cacheKey);
  if (hit && hit.expires > now) return hit.ids;

  try {
    const resp = await getV2<ListResp>(
      auth,
      `/locations/${auth.locationId}/customFields`,
      { model: "opportunity" }
    );
    const fields = resp.customFields ?? [];
    const practiceArea =
      fields.find((f) => f.fieldKey === "opportunity.practice_area_opportunity")?.id ??
      fields.find((f) => /practice[\s_-]?area/i.test(f.name ?? ""))?.id ??
      null;
    const state =
      fields.find((f) => f.fieldKey === "opportunity.state_opportunity")?.id ??
      fields.find((f) => /^state\b/i.test(f.name ?? ""))?.id ??
      null;
    const ids = { practiceArea, state };
    cache.set(cacheKey, { expires: now + TTL_MS, ids });
    return ids;
  } catch {
    // Failure (e.g. token can't read customFields) -> remember empty for a
    // short window so we don't hammer the endpoint, then retry next sync.
    const ids = { practiceArea: null, state: null };
    cache.set(cacheKey, { expires: now + 5 * 60 * 1000, ids });
    return ids;
  }
}

/**
 * Normalize a free-text "Practice Area (Opportunity)" value into one of
 * the canonical practice-area keys used by the dashboard. Returns null
 * when the input doesn't match any known pattern (caller falls back to
 * pipeline.practice_area).
 *
 * Single-line text field = expect variants:
 *   "Workers' Comp", "Workers Comp", "WCC", "WC"  -> workers_comp
 *   "Dog Bite", "DB", "dog-bite"                  -> dog_bite
 *   "Auto", "MVA", "Car Accident"                  -> auto
 */
export function normalizePracticeAreaValue(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  if (/hair[\s-]?relaxer|hrmt/.test(v)) return "mass_tort_hair_relaxer";
  if (/ultra[\s-]?processed|upf/.test(v)) return "mass_tort_upf";
  if (/dog[\s-]?bite|\bdb\b/.test(v)) return "dog_bite";
  if (/workers?['’]?[\s-]?comp|\bwcc?\b/.test(v)) return "workers_comp";
  if (/disabilit|ssdi|\bssi\b|social[\s-]?security/.test(v)) return "disability";
  if (/slip[\s-]?and[\s-]?fall|premises|trip[\s-]?and[\s-]?fall/.test(v))
    return "slip_and_fall";
  if (/med[\s-]?mal|medical[\s-]?mal/.test(v)) return "medical_malpractice";
  if (/wrongful[\s-]?death/.test(v)) return "wrongful_death";
  if (/nursing[\s-]?home/.test(v)) return "nursing_home";
  if (/auto|motor[\s-]?vehicle|\bmva\b|\bcar\b|\btruck\b|\bmotorcycle\b|rideshare|uber|lyft/.test(v))
    return "auto";
  if (/personal[\s-]?injury|\bpi\b/.test(v)) return "general_pi";
  return null;
}

/** Read an opportunity-level custom-field string value by field id. */
export function readOppCustomField(
  customFields: Array<{ id: string; fieldValue?: unknown }> | undefined,
  fieldId: string | null
): string | null {
  if (!fieldId || !customFields) return null;
  const hit = customFields.find((c) => c.id === fieldId);
  if (!hit) return null;
  if (typeof hit.fieldValue === "string") return hit.fieldValue;
  if (Array.isArray(hit.fieldValue) && typeof hit.fieldValue[0] === "string") {
    return hit.fieldValue[0];
  }
  return null;
}
