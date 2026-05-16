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

/**
 * Returns null when GHL doesn't expose reviews on this plan.
 *
 * Single attempt per endpoint with a tight 10s timeout. The reputation
 * API isn't part of every GHL plan and tends to respond with slow 5xx
 * errors (not fast 404s), so the default retry policy can burn 60+
 * seconds per location for no benefit. Reviews are non-critical: if
 * they don't come back fast, we show "Reviews unavailable" and move on.
 */
const REVIEWS_REQ_OPTS = { retries: 0, timeoutMs: 10_000 };

export async function reviewCounts(
  auths: GhlAuth[]
): Promise<ReviewWindowCounts | null> {
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
        { locationId: auth.locationId },
        REVIEWS_REQ_OPTS
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
            { locationId: auth.locationId, limit: 200 },
            REVIEWS_REQ_OPTS
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
        } catch {
          // Plan doesn't expose this profile -- skip and try next.
        }
      }
    } catch (e) {
      if (e instanceof GhlError) continue;
      // Network error / timeout -- skip silently; data is non-critical
    }
  }

  if (!anySucceeded && perProfile.length === 0) return null;
  return { week, month, year, lifetime, perProfile };
}
