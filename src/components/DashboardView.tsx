"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  RefreshCcw,
  Users,
  UserPlus,
  CheckCircle2,
  Briefcase,
  Star,
  Activity,
  TrendingUp,
  Sparkles,
} from "lucide-react";
import { DateRangePicker } from "@/components/DateRangePicker";
import { DeltaPill } from "@/components/DeltaPill";
import { EmptyState } from "@/components/EmptyState";
import { KpiTable } from "@/components/KpiTable";
import { SectionHeader } from "@/components/SectionHeader";
import { StatCard } from "@/components/StatCard";
import { BarCount } from "@/components/charts/BarCount";
import { Pie } from "@/components/charts/Pie";
import type { Preset } from "@/lib/dateRanges";
import type { DashboardData } from "@/lib/types";

interface DashboardViewProps {
  /** API endpoint to fetch DashboardData from. Defaults to /api/data. */
  endpoint?: string;
  /** Optional refresh endpoint; if null, the Refresh button just re-fetches. */
  refreshEndpoint?: string | null;
  /** Right-side header slot (e.g. Clerk's <UserButton/>). */
  headerRight?: ReactNode;
  /** Show a "DEMO" pill in the header. */
  demoBadge?: boolean;
}

function todayISO() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function fmtSeconds(secs: number | null): string {
  if (secs === null || !Number.isFinite(secs)) return "—";
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]!.toUpperCase())
    .join("");
}

const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "kpi", label: "KPIs" },
  { id: "email", label: "Email" },
  { id: "leads", label: "Lead Analytics" },
  { id: "intake", label: "Intake Team" },
  { id: "cases", label: "Case Analytics" },
];

function SectionNav() {
  return (
    <aside className="hidden lg:block w-48 shrink-0">
      <div className="sticky top-24 space-y-0.5">
        <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold px-3 pb-2">
          Sections
        </div>
        {SECTIONS.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className="block px-3 py-1.5 rounded-md text-sm text-slate-600 hover:text-blue-700 hover:bg-blue-50/60 transition-colors"
          >
            {s.label}
          </a>
        ))}
      </div>
    </aside>
  );
}

function timeAgo(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export default function DashboardView({
  endpoint = "/api/data",
  refreshEndpoint = "/api/refresh",
  headerRight,
  demoBadge = false,
}: DashboardViewProps) {
  const [preset, setPreset] = useState<Preset>("this_month");
  const [startISO, setStartISO] = useState<string>(todayISO());
  const [endISO, setEndISO] = useState<string>(todayISO());
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsSync, setNeedsSync] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const queryString = useMemo(() => {
    const params = new URLSearchParams({ preset });
    if (preset === "custom") {
      params.set("start", startISO);
      params.set("end", endISO);
    }
    return params.toString();
  }, [preset, startISO, endISO]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNeedsSync(null);
    setElapsed(0);
    const t0 = Date.now();
    const tick = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000);
    try {
      const res = await fetch(`${endpoint}?${queryString}`);
      if (res.status === 503) {
        const j = (await res.json().catch(() => ({}))) as { message?: string };
        setNeedsSync(j.message ?? "No snapshot found. Click Refresh to run the first sync.");
        return;
      }
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `Request failed: ${res.status}`);
      }
      const j = (await res.json()) as DashboardData;
      setData(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      clearInterval(tick);
      setLoading(false);
    }
  }, [queryString, endpoint]);

  useEffect(() => {
    load();
  }, [load]);

  async function refresh() {
    setRefreshing(true);
    setError(null);
    try {
      if (refreshEndpoint) {
        const res = await fetch(refreshEndpoint, { method: "POST" });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error ?? `Refresh failed: ${res.status}`);
        }
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50/50">
      <header className="border-b border-slate-200 bg-white/85 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-6 py-3.5 flex flex-wrap items-center gap-4 justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 text-white shadow-[0_1px_2px_rgba(37,99,235,0.4)]">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <h1 className="text-[15px] font-semibold tracking-tight text-slate-900 flex items-center gap-2">
                PPLT Intake Dashboard
                {demoBadge && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 text-[10px] font-semibold uppercase tracking-wider ring-1 ring-inset ring-blue-200">
                    Demo
                  </span>
                )}
              </h1>
              <p className="text-[11px] text-slate-500">
                Pinder Plotkin Legal Team · Abogado Attorney
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <DateRangePicker
              preset={preset}
              start={startISO}
              end={endISO}
              onChange={(p, s, e) => {
                setPreset(p);
                setStartISO(s);
                setEndISO(e);
              }}
            />
            <button
              onClick={refresh}
              disabled={refreshing || loading}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition shadow-[0_1px_2px_rgba(37,99,235,0.3)]"
            >
              <RefreshCcw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
              Refresh
            </button>
            {headerRight}
          </div>
        </div>
      </header>

      <div className="max-w-[1400px] mx-auto px-6 py-8 flex gap-8">
        <SectionNav />
        <main className="flex-1 min-w-0 space-y-10">
        {loading && !data && !needsSync && (
          <div className="rounded-xl border border-slate-200 bg-white px-6 py-10 text-center space-y-2">
            <div className="inline-flex items-center gap-2 text-sm font-medium text-slate-800">
              <RefreshCcw className="h-4 w-4 animate-spin text-blue-600" />
              Loading dashboard data…
            </div>
            <div className="text-xs text-slate-500">
              {elapsed}s elapsed · reading latest snapshot from cache.
            </div>
          </div>
        )}
        {needsSync && !refreshing && (
          <div className="rounded-xl border border-blue-200 bg-blue-50/50 px-6 py-10 text-center space-y-3">
            <div className="text-sm font-medium text-slate-800">
              No snapshot found yet
            </div>
            <div className="text-xs text-slate-600 max-w-md mx-auto leading-relaxed">
              {needsSync} The sync walks GHL + Meta and typically takes 60–120 seconds.
              After that, the dashboard reads in milliseconds and refreshes
              automatically every 30 minutes.
            </div>
            <button
              onClick={refresh}
              disabled={refreshing}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 text-white px-4 py-2 text-sm font-medium hover:bg-blue-700 transition shadow-[0_1px_2px_rgba(37,99,235,0.3)]"
            >
              <RefreshCcw className="h-4 w-4" />
              Run first sync
            </button>
          </div>
        )}
        {refreshing && !data && (
          <div className="rounded-xl border border-blue-200 bg-blue-50/50 px-6 py-10 text-center space-y-2">
            <div className="inline-flex items-center gap-2 text-sm font-medium text-slate-800">
              <RefreshCcw className="h-4 w-4 animate-spin text-blue-600" />
              Syncing GHL + Meta data…
            </div>
            <div className="text-xs text-slate-500">
              {elapsed}s elapsed · this only takes long on the first run.
            </div>
          </div>
        )}
        {error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 text-rose-800 px-4 py-3 text-sm">
            {error}
          </div>
        )}
        {data?.warnings && data.warnings.length > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50/70 text-amber-900 px-4 py-3 text-xs space-y-1">
            {data.warnings.map((w, i) => (
              <div key={i} className="flex gap-2">
                <span aria-hidden>⚠</span>
                <span>{w}</span>
              </div>
            ))}
          </div>
        )}

        {data && (
          <>
            <Overview data={data} />
            <Kpi data={data} />
            <EmailBlock data={data} />
            <LeadsBlock data={data} />
            <IntakeTeamBlock data={data} />
            <CasesBlock data={data} />
            <p className="text-[11px] text-slate-400 text-center pt-8">
              {data.syncedAt ? (
                <>
                  Snapshot synced {timeAgo(data.syncedAt)}
                  {data.syncDurationMs &&
                    ` (took ${(data.syncDurationMs / 1000).toFixed(1)}s)`}{" "}
                  · auto-refreshes every 30 min · click Refresh for fresh-now data
                </>
              ) : (
                <>
                  Generated {new Date(data.generatedAt).toLocaleString()} · Range:{" "}
                  {data.range.label}
                </>
              )}
            </p>
          </>
        )}
        </main>
      </div>
    </div>
  );

  function Overview({ data }: { data: DashboardData }) {
    const o = data.overview;
    return (
      <section id="overview">
        <SectionHeader title="Overview" subtitle="Last 30 days vs prior 30 days, last 7 days vs prior 7 days" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            icon={Users}
            label="Leads · Last 30 Days"
            value={o.leads30.current.toLocaleString()}
            delta={o.leads30}
            sub={`Prior 30 days: ${o.leads30.previous.toLocaleString()}`}
          />
          <StatCard
            icon={Users}
            label="Leads · Last 7 Days"
            value={o.leads7.current.toLocaleString()}
            delta={o.leads7}
            sub={`Prior 7 days: ${o.leads7.previous.toLocaleString()}`}
          />
          <StatCard
            icon={UserPlus}
            label="Referrals · Last 30 Days"
            value={o.referrals30.current.toLocaleString()}
            delta={o.referrals30}
            sub={`Prior 30 days: ${o.referrals30.previous.toLocaleString()}`}
          />
          <StatCard
            icon={UserPlus}
            label="Referrals · Last 7 Days"
            value={o.referrals7.current.toLocaleString()}
            delta={o.referrals7}
            sub={`Prior 7 days: ${o.referrals7.previous.toLocaleString()}`}
          />
          <StatCard
            icon={CheckCircle2}
            label="Signed · Last 30 Days"
            value={o.signed30.current.toLocaleString()}
            delta={o.signed30}
            sub={`Prior 30 days: ${o.signed30.previous.toLocaleString()}`}
          />
          <StatCard
            icon={CheckCircle2}
            label="Signed · Last 7 Days"
            value={o.signed7.current.toLocaleString()}
            delta={o.signed7}
            sub={`Prior 7 days: ${o.signed7.previous.toLocaleString()}`}
          />
          <StatCard
            icon={Briefcase}
            label="Active Cases (total)"
            value={o.activeTotal.toLocaleString()}
          />
          <StatCard
            icon={Star}
            label="Google Reviews · Lifetime"
            value={o.reviews.lifetime.toLocaleString()}
            sub={`Week ${o.reviews.week} · Month ${o.reviews.month} · YTD ${o.reviews.year}`}
          />
        </div>
        {o.reviews.perProfile.length > 0 && (
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {o.reviews.perProfile.map((p) => (
              <div
                key={p.name}
                className="rounded-xl border border-slate-200 bg-white px-4 py-3"
              >
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  {p.name}
                </div>
                <div className="mt-1 text-xl font-semibold tabular-nums text-slate-900">
                  {p.lifetime.toLocaleString()}
                  <span className="ml-1 text-xs font-normal text-slate-500">reviews</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    );
  }

  function Kpi({ data }: { data: DashboardData }) {
    return (
      <section id="kpi">
        <SectionHeader
          title="KPIs"
          subtitle="Spanish vs English, by month and quarter"
        />
        <div className="space-y-6">
          <div>
            <h3 className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-3">
              By Month
            </h3>
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
              {data.kpi.months.map((b) => (
                <KpiTable key={b.title} block={b} />
              ))}
            </div>
          </div>
          <div>
            <h3 className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-3">
              By Quarter
            </h3>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {data.kpi.quarters.map((b) => (
                <KpiTable key={b.title} block={b} />
              ))}
            </div>
          </div>
        </div>
      </section>
    );
  }

  function EmailBlock({ data }: { data: DashboardData }) {
    if (!data.email || data.email.length === 0) return null;
    return (
      <section id="email">
        <SectionHeader
          title="Email"
          subtitle="GHL email campaigns by bucket, current range"
        />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {data.email.map((b) => {
            const openRate = b.sends > 0 ? (b.opens / b.sends) * 100 : 0;
            const clickRate = b.sends > 0 ? (b.clicks / b.sends) * 100 : 0;
            return (
              <div
                key={b.bucket}
                className="rounded-xl border border-slate-200 bg-white p-5"
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="text-sm font-semibold text-slate-900 capitalize flex items-center gap-2">
                    {b.bucket}
                    <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[10px] font-medium uppercase tracking-wider">
                      {b.bucket === "spanish" ? "Abogado" : "PPLT"}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500 tabular-nums">
                    {openRate.toFixed(1)}% open · {clickRate.toFixed(1)}% click
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <EmailMetric label="Sends" value={b.sends} />
                  <EmailMetric label="Opens" value={b.opens} />
                  <EmailMetric label="Clicks" value={b.clicks} />
                  <EmailMetric label="Replies" value={b.replies} />
                  <EmailMetric label="Unsubs" value={b.unsubscribes} />
                  <EmailMetric
                    label="Signed ≤30d"
                    value={b.signedWithin30dOfReply}
                    emphasized
                  />
                </div>
              </div>
            );
          })}
        </div>
      </section>
    );
  }

  function EmailMetric({
    label,
    value,
    emphasized,
  }: {
    label: string;
    value: number;
    emphasized?: boolean;
  }) {
    return (
      <div
        className={`rounded-lg ${
          emphasized
            ? "bg-blue-50 ring-1 ring-blue-100"
            : "bg-slate-50/60"
        } px-3 py-2`}
      >
        <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
          {label}
        </div>
        <div
          className={`mt-1 text-base tabular-nums font-semibold ${
            emphasized ? "text-blue-700" : "text-slate-900"
          }`}
        >
          {value.toLocaleString()}
        </div>
      </div>
    );
  }

  function LeadsBlock({ data }: { data: DashboardData }) {
    return (
      <section id="leads">
        <SectionHeader
          title="Lead Analytics"
          subtitle="Sources, status mix, and conversion — current range"
        />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <LeadCard
            heading="English Sources"
            badge="PPLT"
            pieData={data.leadsEnglish.sourceMix.map((r) => ({ name: r.source, value: r.count }))}
            conversionPct={data.leadsEnglish.conversionRatePct}
            avgDaysToSigned={data.leadsEnglish.avgDaysToSigned}
          />
          <LeadCard
            heading="Spanish Sources"
            badge="Abogado"
            pieData={data.leadsSpanish.sourceMix.map((r) => ({ name: r.source, value: r.count }))}
            conversionPct={data.leadsSpanish.conversionRatePct}
            avgDaysToSigned={data.leadsSpanish.avgDaysToSigned}
          />
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h3 className="text-sm font-semibold text-slate-900 mb-3">
              English — Leads by Status
            </h3>
            <BarCount
              data={data.leadsEnglish.byStatus.map((r) => ({ name: r.status, value: r.count }))}
            />
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h3 className="text-sm font-semibold text-slate-900 mb-3">
              Spanish — Leads by Status
            </h3>
            <BarCount
              data={data.leadsSpanish.byStatus.map((r) => ({ name: r.status, value: r.count }))}
            />
          </div>
        </div>
      </section>
    );
  }

  function LeadCard({
    heading,
    badge,
    pieData,
    conversionPct,
    avgDaysToSigned,
  }: {
    heading: string;
    badge: string;
    pieData: Array<{ name: string; value: number }>;
    conversionPct: number;
    avgDaysToSigned: number | null;
  }) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            {heading}
            <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[10px] font-medium uppercase tracking-wider">
              {badge}
            </span>
          </h3>
        </div>
        <Pie data={pieData} />
        <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
          <div className="rounded-lg bg-slate-50/60 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold flex items-center gap-1">
              <TrendingUp className="h-3 w-3" /> Conversion
            </div>
            <div className="mt-1 text-base font-semibold tabular-nums text-slate-900">
              {conversionPct.toFixed(1)}%
            </div>
          </div>
          <div className="rounded-lg bg-slate-50/60 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold flex items-center gap-1">
              <Activity className="h-3 w-3" /> Avg time to signed
            </div>
            <div className="mt-1 text-base font-semibold tabular-nums text-slate-900">
              {avgDaysToSigned === null ? "—" : `${avgDaysToSigned.toFixed(1)} d`}
            </div>
          </div>
        </div>
      </div>
    );
  }

  function IntakeTeamBlock({ data }: { data: DashboardData }) {
    if (!data.intakeTeam || data.intakeTeam.length === 0) {
      return (
        <section id="intake">
          <SectionHeader title="Intake Team" />
          <EmptyState />
        </section>
      );
    }
    return (
      <section id="intake">
        <SectionHeader
          title="Intake Team"
          subtitle="Per-member referrals, calls, SMS, and trends"
        />
        <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
          <table className="w-full text-sm min-w-[1100px]">
            <thead className="bg-slate-50/60 text-[11px] uppercase tracking-wider text-slate-500">
              <tr className="border-b border-slate-200">
                <th className="text-left px-4 py-2.5 font-semibold">Member</th>
                <th className="text-right px-4 py-2.5 font-semibold">Referrals</th>
                <th className="text-right px-4 py-2.5 font-semibold">Signed (from ref.)</th>
                <th className="text-right px-4 py-2.5 font-semibold">Calls In</th>
                <th className="text-right px-4 py-2.5 font-semibold">Calls Out</th>
                <th className="text-right px-4 py-2.5 font-semibold">SMS</th>
                <th className="text-right px-4 py-2.5 font-semibold">Avg call</th>
                <th className="text-right px-4 py-2.5 font-semibold">Ref 30d</th>
                <th className="text-right px-4 py-2.5 font-semibold">Ref 7d</th>
                <th className="text-right px-4 py-2.5 font-semibold">Signed 30d</th>
                <th className="text-right px-4 py-2.5 font-semibold">Signed 7d</th>
                <th className="text-right px-4 py-2.5 font-semibold text-blue-700">Active</th>
              </tr>
            </thead>
            <tbody>
              {data.intakeTeam.map((m, i) => (
                <tr
                  key={m.userId}
                  className={`border-t border-slate-100 hover:bg-slate-50/60 transition-colors ${i % 2 === 1 ? "bg-slate-50/30" : ""}`}
                >
                  <td className="px-4 py-2.5 font-medium text-slate-800">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-50 text-blue-700 text-[11px] font-semibold ring-1 ring-blue-100">
                        {initials(m.name)}
                      </div>
                      <div>
                        <div>{m.name}</div>
                        <div className="text-[11px] text-slate-400">{m.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{m.referrals}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{m.signedFromReferrals}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{m.callsInbound}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{m.callsOutbound}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{m.sms}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">
                    {fmtSeconds(m.avgPickupSeconds)}
                  </td>
                  <td className="px-4 py-2.5 text-right"><DeltaPill stat={m.referrals30} /></td>
                  <td className="px-4 py-2.5 text-right"><DeltaPill stat={m.referrals7} /></td>
                  <td className="px-4 py-2.5 text-right"><DeltaPill stat={m.signed30} /></td>
                  <td className="px-4 py-2.5 text-right"><DeltaPill stat={m.signed7} /></td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-blue-700">
                    {m.activeFromReferrals}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-slate-400 mt-2">
          Avg call shows mean duration of answered calls in the current range (proxy for pickup time).
        </p>
      </section>
    );
  }

  function CasesBlock({ data }: { data: DashboardData }) {
    return (
      <section id="cases">
        <SectionHeader
          title="Case Analytics"
          subtitle="Snapshot of active cases (not date-filtered)"
        />
        <CasesTabs data={data} />
      </section>
    );
  }

  function CasesTabs({ data }: { data: DashboardData }) {
    const [bucket, setBucket] = useState<"combined" | "english" | "spanish">("combined");
    const view =
      bucket === "english"
        ? data.casesEnglish ?? data.cases
        : bucket === "spanish"
          ? data.casesSpanish ?? data.cases
          : data.cases;
    const brokers = view.referralBrokers;
    const tabs: Array<{ id: typeof bucket; label: string; sub: string }> = [
      { id: "combined", label: "Combined", sub: "English + Spanish" },
      { id: "english", label: "English", sub: "PPLT" },
      { id: "spanish", label: "Spanish", sub: "Abogado" },
    ];
    return (
      <>
        <div className="inline-flex items-center rounded-lg border border-slate-200 bg-white p-1 mb-4">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setBucket(t.id)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${
                bucket === t.id
                  ? "bg-blue-600 text-white shadow-[0_1px_2px_rgba(37,99,235,0.3)]"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {t.label}
              <span className={`ml-1.5 text-[10px] uppercase tracking-wider ${bucket === t.id ? "text-blue-100" : "text-slate-400"}`}>
                {t.sub}
              </span>
            </button>
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ChartCard title="By Practice Area">
            <BarCount data={view.byPracticeArea.map((r) => ({ name: r.area, value: r.count }))} />
          </ChartCard>
          <ChartCard title="By State" subtitle="State (Jurisdiction) field, top 15">
            <BarCount data={view.byState.slice(0, 15).map((r) => ({ name: r.state, value: r.count }))} />
          </ChartCard>
          <ChartCard
            title="Active at Co-Counsel Firm"
            subtitle="Top 15 · open referrals (excl. brokers)"
            footer={
              brokers && (brokers.lexamica > 0 || brokers.litify > 0) ? (
                <>
                  <span className="font-medium text-slate-700">Referral brokers (active):</span>{" "}
                  Lexamica {brokers.lexamica.toLocaleString()} · Litify{" "}
                  {brokers.litify.toLocaleString()}
                </>
              ) : null
            }
          >
            <BarCount data={view.byCoCounsel.slice(0, 15).map((r) => ({ name: r.firm, value: r.count }))} />
          </ChartCard>
          <ChartCard
            title="Signed by Co-Counsel Firm"
            subtitle="Top 15 · firm signed the referred case"
            footer={
              view.referralBrokersSigned && (view.referralBrokersSigned.lexamica > 0 || view.referralBrokersSigned.litify > 0) ? (
                <>
                  <span className="font-medium text-slate-700">Referral brokers (signed):</span>{" "}
                  Lexamica {view.referralBrokersSigned.lexamica.toLocaleString()} · Litify{" "}
                  {view.referralBrokersSigned.litify.toLocaleString()}
                </>
              ) : null
            }
          >
            <BarCount data={view.byCoCounselSigned.slice(0, 15).map((r) => ({ name: r.firm, value: r.count }))} />
          </ChartCard>
        </div>
      </>
    );
  }

  function ChartCard({
    title,
    subtitle,
    children,
    footer,
  }: {
    title: string;
    subtitle?: string;
    children: ReactNode;
    footer?: ReactNode;
  }) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex items-end justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          {subtitle && <span className="text-[11px] text-slate-500">{subtitle}</span>}
        </div>
        {children}
        {footer && (
          <p className="mt-3 text-[11px] text-slate-500 leading-relaxed">{footer}</p>
        )}
      </div>
    );
  }
}
