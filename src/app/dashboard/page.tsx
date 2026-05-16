"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { UserButton } from "@clerk/nextjs";
import { RefreshCcw } from "lucide-react";
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

export default function DashboardPage() {
  const [preset, setPreset] = useState<Preset>("this_month");
  const [startISO, setStartISO] = useState<string>(todayISO());
  const [endISO, setEndISO] = useState<string>(todayISO());
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
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
    setElapsed(0);
    const t0 = Date.now();
    const tick = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000);
    try {
      const res = await fetch(`/api/data?${queryString}`);
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
  }, [queryString]);

  useEffect(() => {
    load();
  }, [load]);

  async function refresh() {
    setRefreshing(true);
    try {
      await fetch("/api/refresh", { method: "POST" });
      await load();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="border-b border-neutral-200 bg-white sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-6 py-4 flex flex-wrap items-center gap-4 justify-between">
          <div>
            <h1 className="text-base font-semibold tracking-tight">
              PPLT Intake Dashboard
            </h1>
            <p className="text-xs text-neutral-500">
              Pinder Plotkin Legal Team · Abogado Attorney
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
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
              className="inline-flex items-center gap-2 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm hover:bg-neutral-50 disabled:opacity-50"
            >
              <RefreshCcw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
              Refresh
            </button>
            <UserButton />
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-12">
        {loading && !data && (
          <div className="bg-white border border-neutral-200 rounded-xl px-5 py-8 text-center space-y-2">
            <div className="text-sm font-medium text-neutral-700">
              Loading dashboard data…
            </div>
            <div className="text-xs text-neutral-500">
              {elapsed}s elapsed · first cold load typically takes 60–120s
              while we walk 109 GHL pipelines + 3 Meta accounts. Subsequent
              loads use the hourly cache.
            </div>
          </div>
        )}
        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-800 px-4 py-3 text-sm">
            {error}
          </div>
        )}
        {data?.warnings && data.warnings.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 text-amber-900 px-4 py-3 text-sm space-y-1">
            {data.warnings.map((w, i) => (
              <div key={i}>⚠ {w}</div>
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
            <p className="text-xs text-neutral-400 text-center pt-8">
              Generated {new Date(data.generatedAt).toLocaleString()} · Range:{" "}
              {data.range.label}
            </p>
          </>
        )}
      </main>
    </div>
  );

  function Overview({ data }: { data: DashboardData }) {
    const o = data.overview;
    return (
      <section>
        <SectionHeader title="Overview" subtitle="This period vs prior period" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Leads · This Month"
            value={o.leadsMonth.current.toLocaleString()}
            delta={o.leadsMonth}
            sub={`Last month: ${o.leadsMonth.previous.toLocaleString()}`}
          />
          <StatCard
            label="Leads · This Week"
            value={o.leadsWeek.current.toLocaleString()}
            delta={o.leadsWeek}
            sub={`Last week: ${o.leadsWeek.previous.toLocaleString()}`}
          />
          <StatCard
            label="Referrals · This Month"
            value={o.referralsMonth.current.toLocaleString()}
            delta={o.referralsMonth}
            sub={`Last month: ${o.referralsMonth.previous.toLocaleString()}`}
          />
          <StatCard
            label="Referrals · This Week"
            value={o.referralsWeek.current.toLocaleString()}
            delta={o.referralsWeek}
            sub={`Last week: ${o.referralsWeek.previous.toLocaleString()}`}
          />
          <StatCard
            label="Signed · This Month"
            value={o.signedMonth.current.toLocaleString()}
            delta={o.signedMonth}
            sub={`Last month: ${o.signedMonth.previous.toLocaleString()}`}
          />
          <StatCard
            label="Signed · This Week"
            value={o.signedWeek.current.toLocaleString()}
            delta={o.signedWeek}
            sub={`Last week: ${o.signedWeek.previous.toLocaleString()}`}
          />
          <StatCard
            label="Active Cases (total)"
            value={o.activeTotal.toLocaleString()}
          />
          <StatCard
            label="Google Reviews · Lifetime"
            value={o.reviews.lifetime.toLocaleString()}
            sub={`Week ${o.reviews.week} · Month ${o.reviews.month} · YTD ${o.reviews.year}`}
          />
        </div>
        {o.reviews.perProfile.length > 0 && (
          <div className="mt-3 text-xs text-neutral-500 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {o.reviews.perProfile.map((p) => (
              <div key={p.name} className="bg-white rounded-lg border border-neutral-200 px-3 py-2">
                <div className="font-medium text-neutral-700">{p.name}</div>
                <div>Lifetime: {p.lifetime}</div>
              </div>
            ))}
          </div>
        )}
      </section>
    );
  }

  function Kpi({ data }: { data: DashboardData }) {
    return (
      <section>
        <SectionHeader
          title="KPIs"
          subtitle="Spanish vs English, by month and quarter (year to date)"
        />
        <div className="space-y-8">
          <div>
            <h3 className="text-sm font-medium text-neutral-500 mb-3">By Month</h3>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {data.kpi.months.map((b) => (
                <KpiTable key={b.title} block={b} />
              ))}
            </div>
          </div>
          <div>
            <h3 className="text-sm font-medium text-neutral-500 mb-3">By Quarter</h3>
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
      <section>
        <SectionHeader
          title="Email"
          subtitle="GHL email campaigns by bucket, current range"
        />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {data.email.map((b) => (
            <div
              key={b.bucket}
              className="bg-white border border-neutral-200 rounded-xl p-5"
            >
              <div className="text-sm font-semibold mb-3 capitalize">
                {b.bucket}
              </div>
              <dl className="grid grid-cols-3 gap-y-2 text-sm">
                <dt className="text-neutral-500">Sends</dt>
                <dd className="col-span-2 text-right tabular-nums">
                  {b.sends.toLocaleString()}
                </dd>
                <dt className="text-neutral-500">Opens</dt>
                <dd className="col-span-2 text-right tabular-nums">
                  {b.opens.toLocaleString()}
                </dd>
                <dt className="text-neutral-500">Clicks</dt>
                <dd className="col-span-2 text-right tabular-nums">
                  {b.clicks.toLocaleString()}
                </dd>
                <dt className="text-neutral-500">Replies</dt>
                <dd className="col-span-2 text-right tabular-nums">
                  {b.replies.toLocaleString()}
                </dd>
                <dt className="text-neutral-500">Unsubscribes</dt>
                <dd className="col-span-2 text-right tabular-nums">
                  {b.unsubscribes.toLocaleString()}
                </dd>
                <dt className="text-neutral-500">Signed within 30d of reply</dt>
                <dd className="col-span-2 text-right tabular-nums font-semibold">
                  {b.signedWithin30dOfReply.toLocaleString()}
                </dd>
              </dl>
            </div>
          ))}
        </div>
      </section>
    );
  }

  function LeadsBlock({ data }: { data: DashboardData }) {
    return (
      <section>
        <SectionHeader
          title="Lead Analytics"
          subtitle="Sources, status mix, and conversion — current range"
        />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white border border-neutral-200 rounded-xl p-5">
            <h3 className="text-sm font-semibold mb-3">English — Sources</h3>
            <Pie
              data={data.leadsEnglish.sourceMix.map((r) => ({
                name: r.source,
                value: r.count,
              }))}
            />
            <div className="mt-3 text-xs text-neutral-500 flex justify-between">
              <span>Conv. rate: {data.leadsEnglish.conversionRatePct.toFixed(1)}%</span>
              <span>
                Time to signed:{" "}
                {data.leadsEnglish.avgDaysToSigned === null
                  ? "—"
                  : `${data.leadsEnglish.avgDaysToSigned.toFixed(1)} days`}
              </span>
            </div>
          </div>
          <div className="bg-white border border-neutral-200 rounded-xl p-5">
            <h3 className="text-sm font-semibold mb-3">Spanish — Sources</h3>
            <Pie
              data={data.leadsSpanish.sourceMix.map((r) => ({
                name: r.source,
                value: r.count,
              }))}
            />
            <div className="mt-3 text-xs text-neutral-500 flex justify-between">
              <span>Conv. rate: {data.leadsSpanish.conversionRatePct.toFixed(1)}%</span>
              <span>
                Time to signed:{" "}
                {data.leadsSpanish.avgDaysToSigned === null
                  ? "—"
                  : `${data.leadsSpanish.avgDaysToSigned.toFixed(1)} days`}
              </span>
            </div>
          </div>
          <div className="bg-white border border-neutral-200 rounded-xl p-5">
            <h3 className="text-sm font-semibold mb-3">English — Leads by Status</h3>
            <BarCount
              data={data.leadsEnglish.byStatus.map((r) => ({
                name: r.status,
                value: r.count,
              }))}
            />
          </div>
          <div className="bg-white border border-neutral-200 rounded-xl p-5">
            <h3 className="text-sm font-semibold mb-3">Spanish — Leads by Status</h3>
            <BarCount
              data={data.leadsSpanish.byStatus.map((r) => ({
                name: r.status,
                value: r.count,
              }))}
            />
          </div>
        </div>
      </section>
    );
  }

  function IntakeTeamBlock({ data }: { data: DashboardData }) {
    if (!data.intakeTeam || data.intakeTeam.length === 0) {
      return (
        <section>
          <SectionHeader title="Intake Team" />
          <EmptyState />
        </section>
      );
    }
    return (
      <section>
        <SectionHeader
          title="Intake Team"
          subtitle="Per-member referrals, calls, SMS, and trends"
        />
        <div className="bg-white border border-neutral-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm min-w-[1000px]">
            <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Member</th>
                <th className="text-right px-4 py-2 font-medium">Referrals</th>
                <th className="text-right px-4 py-2 font-medium">Signed (from ref.)</th>
                <th className="text-right px-4 py-2 font-medium">Calls In</th>
                <th className="text-right px-4 py-2 font-medium">Calls Out</th>
                <th className="text-right px-4 py-2 font-medium">SMS</th>
                <th className="text-right px-4 py-2 font-medium">Avg call</th>
                <th className="text-right px-4 py-2 font-medium">Ref MoM</th>
                <th className="text-right px-4 py-2 font-medium">Ref WoW</th>
                <th className="text-right px-4 py-2 font-medium">Signed MoM</th>
                <th className="text-right px-4 py-2 font-medium">Signed WoW</th>
                <th className="text-right px-4 py-2 font-medium">Active</th>
              </tr>
            </thead>
            <tbody>
              {data.intakeTeam.map((m) => (
                <tr key={m.userId} className="border-t border-neutral-100">
                  <td className="px-4 py-2 font-medium text-neutral-800">
                    {m.name}
                    <div className="text-xs text-neutral-400">{m.email}</div>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{m.referrals}</td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {m.signedFromReferrals}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{m.callsInbound}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{m.callsOutbound}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{m.sms}</td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {fmtSeconds(m.avgPickupSeconds)}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <DeltaPill stat={m.referralsMonth} />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <DeltaPill stat={m.referralsWeek} />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <DeltaPill stat={m.signedMonth} />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <DeltaPill stat={m.signedWeek} />
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums font-semibold">
                    {m.activeFromReferrals}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-neutral-400 mt-2">
          Avg call shows mean duration of answered calls in the current range (proxy for pickup time).
        </p>
      </section>
    );
  }

  function CasesBlock({ data }: { data: DashboardData }) {
    const c = data.cases;
    return (
      <section>
        <SectionHeader
          title="Case Analytics"
          subtitle="Snapshot of active cases (not date-filtered)"
        />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white border border-neutral-200 rounded-xl p-5">
            <h3 className="text-sm font-semibold mb-3">By Practice Area</h3>
            <BarCount
              data={c.byPracticeArea.map((r) => ({ name: r.area, value: r.count }))}
            />
          </div>
          <div className="bg-white border border-neutral-200 rounded-xl p-5">
            <h3 className="text-sm font-semibold mb-3">By Status</h3>
            <BarCount
              data={c.byStatus.map((r) => ({ name: r.status, value: r.count }))}
            />
          </div>
          <div className="bg-white border border-neutral-200 rounded-xl p-5">
            <h3 className="text-sm font-semibold mb-3">By Co-Counsel Firm</h3>
            <BarCount
              data={c.byCoCounsel.slice(0, 15).map((r) => ({ name: r.firm, value: r.count }))}
            />
          </div>
          <div className="bg-white border border-neutral-200 rounded-xl p-5">
            <h3 className="text-sm font-semibold mb-3">By State</h3>
            <BarCount
              data={c.byState.slice(0, 15).map((r) => ({ name: r.state, value: r.count }))}
            />
          </div>
        </div>
      </section>
    );
  }
}
