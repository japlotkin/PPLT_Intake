/**
 * Contact / lead pagination. GHL has 21K Abogado + 48K PPLT contacts -- we
 * never want to walk all of them. The dashboard always queries by
 * dateAdded range, which the search endpoint supports natively.
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

/**
 * Returns *all* contacts with dateAdded in [start, end). For dashboard
 * windows this is typically thousands or fewer; pagination handles it.
 */
export async function contactsInRange(
  auth: GhlAuth,
  start: Date,
  end: Date,
  pageLimit = 100
): Promise<RawContact[]> {
  const filters = [
    {
      group: "AND",
      filters: [
        {
          field: "dateAdded",
          operator: "range",
          value: { gte: start.toISOString(), lt: end.toISOString() },
        },
      ],
    },
  ];

  const out: RawContact[] = [];
  let searchAfter: unknown = undefined;
  let page = 0;
  while (true) {
    page++;
    if (page > 500) break;
    const body: Record<string, unknown> = {
      locationId: auth.locationId,
      pageLimit,
      sort: [{ field: "dateAdded", direction: "desc" }],
      filters,
    };
    if (searchAfter) body.searchAfter = searchAfter;
    const resp: SearchResp = await postV2(auth, "/contacts/search", body);
    const got = resp.contacts ?? [];
    out.push(...got);
    if (got.length < pageLimit) break;
    searchAfter = resp.searchAfter;
    if (!searchAfter) break;
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
  if (r.includes("consultation")) return "Consultation Form";
  if (r.includes("chat")) return "Website Chat";
  return raw;
}
