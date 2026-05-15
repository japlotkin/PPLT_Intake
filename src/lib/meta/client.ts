/**
 * Meta Graph API client. Single token covers all three ad accounts.
 * Uses Meta's "lead" action_type as the canonical lead count
 * (matches Ads Manager Results column; other lead-like action_types are
 * lenses on the same leads and would triple-count if summed).
 */
import { env } from "../env";

const META_BASE = "https://graph.facebook.com/v20.0";

export interface MetaInsightsRow {
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  leads: number;
  ctr: number;
  cpc: number;
  date_start?: string;
  date_stop?: string;
  account_id?: string;
}

interface RawAction {
  action_type: string;
  value: string;
}

interface RawInsightsRow {
  spend?: string;
  impressions?: string;
  reach?: string;
  clicks?: string;
  ctr?: string;
  cpc?: string;
  actions?: RawAction[];
  date_start?: string;
  date_stop?: string;
  account_id?: string;
}

interface InsightsResp {
  data: RawInsightsRow[];
  paging?: { next?: string };
}

function leadsFromActions(actions?: RawAction[]): number {
  if (!actions) return 0;
  for (const a of actions) {
    if (a.action_type === "lead") return Number(a.value) || 0;
  }
  return 0;
}

function normalize(r: RawInsightsRow): MetaInsightsRow {
  return {
    spend: Number(r.spend ?? 0) || 0,
    impressions: Number(r.impressions ?? 0) || 0,
    reach: Number(r.reach ?? 0) || 0,
    clicks: Number(r.clicks ?? 0) || 0,
    leads: leadsFromActions(r.actions),
    ctr: Number(r.ctr ?? 0) || 0,
    cpc: Number(r.cpc ?? 0) || 0,
    date_start: r.date_start,
    date_stop: r.date_stop,
    account_id: r.account_id,
  };
}

/** Inclusive ISO date string from a JS Date (YYYY-MM-DD). */
function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function accountInsights(
  accountId: string,
  start: Date,
  end: Date
): Promise<MetaInsightsRow> {
  const since = isoDay(start);
  // end is exclusive in our range model, but Meta's time_range "until" is inclusive,
  // so subtract a day.
  const untilDate = new Date(end.getTime() - 24 * 3600 * 1000);
  const until = isoDay(untilDate < start ? start : untilDate);

  const params = new URLSearchParams({
    level: "account",
    time_range: JSON.stringify({ since, until }),
    fields: "spend,impressions,reach,clicks,ctr,cpc,actions",
    access_token: env.meta.token(),
  });
  const url = `${META_BASE}/${accountId}/insights?${params}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "pplt-dash/1.0" },
  });
  if (!res.ok) {
    throw new Error(`Meta insights ${res.status} for ${accountId}: ${await res.text()}`);
  }
  const data = (await res.json()) as InsightsResp;
  const first = data.data?.[0];
  if (!first) {
    return {
      spend: 0,
      impressions: 0,
      reach: 0,
      clicks: 0,
      leads: 0,
      ctr: 0,
      cpc: 0,
      account_id: accountId,
    };
  }
  return normalize(first);
}

export async function allAccountInsights(
  start: Date,
  end: Date
): Promise<Record<"pplt" | "workersComp" | "abogado", MetaInsightsRow>> {
  const ids = env.meta.accounts();
  const [pplt, workersComp, abogado] = await Promise.all([
    accountInsights(ids.pplt, start, end),
    accountInsights(ids.workersComp, start, end),
    accountInsights(ids.abogado, start, end),
  ]);
  return { pplt, workersComp, abogado };
}
