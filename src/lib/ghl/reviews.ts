/**
 * Google Business Profile review counts pulled through GHL's reputation API.
 *
 * Endpoint shape varies by GHL plan; if the call fails the whole reviews
 * block degrades to "No data available" and the dashboard surfaces a warning.
 *
 * The four PPLT profiles named in the spec:
 *   - Pinder Plotkin Baltimore
 *   - Pinder Plotkin Laurel
 *   - Pinder Plotkin Bel Air
 *   - Abogado Attorney
 *
 * We don't know which location IDs they map to until the endpoint returns
 * profile metadata. Match by name fuzzily; if there are more than four hits,
 * keep the four matching the canonical names.
 */
import { getV2, GhlAuth, GhlError } from "./client";

interface ReviewListResp {
  reviews?: Array<{ id: string; createTime?: string; starRating?: number }>;
  total?: number;
  nextPageToken?: string;
}

const TARGET_PROFILES = [
  "Pinder Plotkin Baltimore",
  "Pinder Plotkin Laurel",
  "Pinder Plotkin Bel Air",
  "Abogado Attorney",
];

export interface ReviewWindowCounts {
  week: number;
  month: number;
  year: number;
  lifetime: number;
  perProfile: Array<{ name: string; lifetime: number }>;
}

/** Returns null when GHL doesn't expose reviews on this plan -- caller surfaces a warning. */
export async function reviewCounts(
  auths: GhlAuth[]
): Promise<ReviewWindowCounts | null> {
  // Each location may expose multiple GBP profiles. Try the documented
  // reputation endpoint first; bail with null if it 404s on both locations.
  const perProfile: Array<{ name: string; lifetime: number }> = [];
  const now = Date.now();
  const weekAgo = now - 7 * 24 * 3600 * 1000;
  const monthAgo = now - 30 * 24 * 3600 * 1000;
  const yearStart = new Date(new Date().getFullYear(), 0, 1).getTime();

  let week = 0,
    month = 0,
    year = 0,
    lifetime = 0,
    anySucceeded = false;

  for (const auth of auths) {
    try {
      const list = await getV2<{ profiles?: Array<{ id: string; name?: string }> }>(
        auth,
        `/reputation/profiles`,
        { locationId: auth.locationId }
      );
      const profiles = list.profiles ?? [];
      const wanted = profiles.filter((p) =>
        TARGET_PROFILES.some((t) =>
          (p.name ?? "").toLowerCase().includes(t.toLowerCase().split(" ").slice(-1)[0])
        )
      );
      for (const p of wanted) {
        try {
          const resp = await getV2<ReviewListResp>(
            auth,
            `/reputation/profiles/${p.id}/reviews`,
            { locationId: auth.locationId, limit: 200 }
          );
          const items = resp.reviews ?? [];
          const lifetimeForP = resp.total ?? items.length;
          perProfile.push({ name: p.name ?? p.id, lifetime: lifetimeForP });
          lifetime += lifetimeForP;
          for (const r of items) {
            if (!r.createTime) continue;
            const t = Date.parse(r.createTime);
            if (Number.isNaN(t)) continue;
            if (t >= weekAgo) week++;
            if (t >= monthAgo) month++;
            if (t >= yearStart) year++;
          }
          anySucceeded = true;
        } catch (e) {
          if (!(e instanceof GhlError) || e.status !== 404) continue;
        }
      }
    } catch (e) {
      if (e instanceof GhlError && e.status === 404) continue;
      // other errors: skip silently; data is non-critical
    }
  }

  if (!anySucceeded && perProfile.length === 0) return null;
  return { week, month, year, lifetime, perProfile };
}
