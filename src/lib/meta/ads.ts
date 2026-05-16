/**
 * Meta ad-level insights. Fetches every ad's spend + leads in a given
 * window, across all three ad accounts. Used by the cost analytics layer
 * to compute CPL / CPSC per ad and per practice area.
 *
 * Uses the same "lead" action_type as _meta_leads_per_ad.py (matches the
 * Results column in Ads Manager). Other lead-like action_types are
 * alternate lenses on the same leads and would triple-count if summed.
 */
import { env } from "../env";

const META_BASE = "https://graph.facebook.com/v20.0";

export interface MetaAdRow {
  adId: string;
  adName: string;
  adsetName: string;
  campaignName: string;
  account: "pplt" | "workersComp" | "abogado";
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  leads: number;
}

interface RawAction {
  action_type: string;
  value: string;
}

interface RawAdInsights {
  ad_id?: string;
  ad_name?: string;
  adset_name?: string;
  campaign_name?: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  clicks?: string;
  actions?: RawAction[];
  date_start?: string;
  date_stop?: string;
}

interface InsightsResp {
  data: RawAdInsights[];
  paging?: { next?: string };
}

function leadCount(actions?: RawAction[]): number {
  if (!actions) return 0;
  for (const a of actions) {
    if (a.action_type === "lead") return Number(a.value) || 0;
  }
  return 0;
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function fetchAdInsightsForAccount(
  accountId: string,
  accountLabel: "pplt" | "workersComp" | "abogado",
  start: Date,
  end: Date
): Promise<MetaAdRow[]> {
  const since = isoDay(start);
  const untilDate = new Date(end.getTime() - 24 * 3600 * 1000);
  const until = isoDay(untilDate < start ? start : untilDate);

  const params = new URLSearchParams({
    level: "ad",
    time_range: JSON.stringify({ since, until }),
    fields: "ad_id,ad_name,adset_name,campaign_name,spend,impressions,reach,clicks,actions",
    limit: "500",
    access_token: env.meta.token(),
  });
  let url: string | null = `${META_BASE}/${accountId}/insights?${params}`;
  const out: MetaAdRow[] = [];
  let pages = 0;

  while (url && pages < 20) {
    pages++;
    const res = await fetch(url, { headers: { "User-Agent": "pplt-dash/1.0" } });
    if (!res.ok) {
      throw new Error(
        `Meta ad insights ${res.status} for ${accountId}: ${(await res.text()).slice(0, 200)}`
      );
    }
    const data = (await res.json()) as InsightsResp;
    for (const r of data.data ?? []) {
      out.push({
        adId: r.ad_id ?? "",
        adName: r.ad_name ?? "(unnamed)",
        adsetName: r.adset_name ?? "",
        campaignName: r.campaign_name ?? "",
        account: accountLabel,
        spend: Number(r.spend ?? 0) || 0,
        impressions: Number(r.impressions ?? 0) || 0,
        reach: Number(r.reach ?? 0) || 0,
        clicks: Number(r.clicks ?? 0) || 0,
        leads: leadCount(r.actions),
      });
    }
    url = data.paging?.next ?? null;
  }

  return out;
}

export async function allAdInsights(start: Date, end: Date): Promise<MetaAdRow[]> {
  const ids = env.meta.accounts();
  const [pplt, wc, ab] = await Promise.all([
    fetchAdInsightsForAccount(ids.pplt, "pplt", start, end),
    fetchAdInsightsForAccount(ids.workersComp, "workersComp", start, end),
    fetchAdInsightsForAccount(ids.abogado, "abogado", start, end),
  ]);
  return [...pplt, ...wc, ...ab];
}
