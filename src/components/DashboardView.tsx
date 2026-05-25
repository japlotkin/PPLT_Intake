"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  RefreshCcw,
  Users,
  UserPlus,
  CheckCircle2,
  Activity,
  TrendingUp,
  Sparkles,
  DollarSign,
  Target,
  Download,
  Menu,
  X,
  BookOpen,
} from "lucide-react";
import { downloadCsv } from "@/lib/csv";
import { DateRangePicker } from "@/components/DateRangePicker";
import { DeltaPill } from "@/components/DeltaPill";
import { EmptyState } from "@/components/EmptyState";
import { KpiTable } from "@/components/KpiTable";
import { SectionHeader } from "@/components/SectionHeader";
import { StatCard } from "@/components/StatCard";
import { BarCount } from "@/components/charts/BarCount";
import { Pie } from "@/components/charts/Pie";
import { SortHeader, useSortable } from "@/components/sortable";
import { BucketSwitcher, type Bucket } from "@/components/BucketSwitcher";
import { UserButton } from "@clerk/nextjs";
import { Shield, RefreshCcw as RefreshIcon, FileDown } from "lucide-react";
import type { Preset } from "@/lib/dateRanges";
import type {
  AdCostRow,
  AreaStateCostRow,
  DashboardData,
  IntakeMemberMetrics,
  KpiBlock,
  PracticeAreaCostRow,
} from "@/lib/types";

interface DashboardViewProps {
  /** API endpoint to fetch DashboardData from. Defaults to /api/data. */
  endpoint?: string;
  /** Optional refresh endpoint; if null, the Refresh button just re-fetches. */
  refreshEndpoint?: string | null;
  /** Right-side header slot (overrides built-in Clerk UserButton w/ admin menu). */
  headerRight?: ReactNode;
  /** Show a "DEMO" pill in the header. */
  demoBadge?: boolean;
}

/** Hidden form for the historical-KPI CSV export.
 *  Submitting a hidden link triggers the file download via the browser. */
function downloadHistoricalKpi(months: number) {
  const a = document.createElement("a");
  a.href = `/api/admin/kpi-history?months=${months}`;
  a.download = "";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
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

/**
 * Detect a Meta-API-blocked state from the warnings array + cost payload
 * and render a prominent top-of-dashboard banner pointing at the fix.
 * Falls back to null when Meta is healthy.
 */
function metaBlockedBanner(data: DashboardData): ReactNode {
  const warnings = data.warnings ?? [];
  const isBlocked = warnings.some(
    (w) =>
      w.toLowerCase().includes("api access blocked") ||
      w.toLowerCase().includes("meta ad insights fetch failed")
  );
  const staleAsOf = data.cost?.metaStaleAsOf;
  if (!isBlocked && !staleAsOf) return null;

  const APP_DASH =
    "https://developers.facebook.com/apps/1522616902816088/dashboard/";

  // Two flavours:
  //   - "Meta blocked AND we have cached data" => amber, still useful
  //   - "Meta blocked AND no fallback" => red, action required
  if (staleAsOf) {
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50 text-amber-900 px-4 py-3 text-sm flex items-start gap-3">
        <span aria-hidden className="text-lg leading-none">⚠</span>
        <div className="flex-1 space-y-1">
          <div className="font-semibold">Meta access needs to be restored</div>
          <div className="text-xs text-amber-800 leading-relaxed">
            Live Meta fetch returned <span className="font-mono">API access blocked</span>.
            Ad Cost is showing cached data from{" "}
            <span className="font-medium">{new Date(staleAsOf).toLocaleString()}</span>.
            Fix: open{" "}
            <a
              href={APP_DASH}
              target="_blank"
              rel="noreferrer noopener"
              className="underline font-medium hover:text-amber-950"
            >
              the Jaguar Ad Reporting App dashboard
            </a>{" "}
            and verify the app is in <strong>Live</strong> mode (not Development) and
            that the system user&apos;s token is still valid. Once fixed, click{" "}
            <strong>Refresh</strong> to repopulate.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-rose-300 bg-rose-50 text-rose-900 px-4 py-3 text-sm flex items-start gap-3">
      <span aria-hidden className="text-lg leading-none">⚠</span>
      <div className="flex-1 space-y-1">
        <div className="font-semibold">Meta access blocked — action required</div>
        <div className="text-xs text-rose-800 leading-relaxed">
          Live Meta fetch is failing AND there&apos;s no cached fallback. Ad Cost
          will be blank until Meta access is restored. Fix:
          <ol className="list-decimal pl-5 mt-1 space-y-0.5">
            <li>
              Open{" "}
              <a
                href={APP_DASH}
                target="_blank"
                rel="noreferrer noopener"
                className="underline font-medium hover:text-rose-950"
              >
                the Jaguar Ad Reporting App dashboard
              </a>
              .
            </li>
            <li>Check the app mode badge near the top. If &quot;In development&quot;, switch to <strong>Live</strong>.</li>
            <li>If Live, regenerate the system user token: business.facebook.com → System Users → Jaguar_Meta_Reporting → Generate token (scopes: ads_read, business_management, read_insights).</li>
            <li>Update <span className="font-mono">META_ACCESS_TOKEN</span> in Vercel env, redeploy, click Refresh here.</li>
          </ol>
        </div>
      </div>
    </div>
  );
}

/**
 * Find dynamic compute warnings for a section. dashboardCompute prefixes
 * each warning with the section label (e.g. "Cost analytics: ..."). This
 * filter returns the matching warning strings sans prefix.
 */
function sectionWarnings(data: DashboardData | null, prefixes: string[]): string[] {
  if (!data?.warnings || data.warnings.length === 0) return [];
  const out: string[] = [];
  for (const w of data.warnings) {
    for (const p of prefixes) {
      if (w.toLowerCase().startsWith(p.toLowerCase())) {
        out.push(w.slice(p.length).replace(/^[:\s]+/, ""));
        break;
      }
    }
  }
  return out;
}

/**
 * A small inline advisory banner. tone:
 *   "warn"   = amber, dynamic compute issue
 *   "info"   = slate, known data caveat / "needs verification" note
 */
function SectionWarning({
  tone = "info",
  items,
}: {
  tone?: "warn" | "info";
  items: string[];
}) {
  if (items.length === 0) return null;
  const cls =
    tone === "warn"
      ? "rounded-lg border border-amber-200 bg-amber-50/70 text-amber-900"
      : "rounded-lg border border-slate-200 bg-slate-50 text-slate-600";
  const icon = tone === "warn" ? "⚠" : "ⓘ";
  return (
    <div className={`${cls} px-3 py-2 text-[11px] space-y-1 mb-3`}>
      {items.map((t, i) => (
        <div key={i} className="flex gap-2">
          <span aria-hidden className="shrink-0">{icon}</span>
          <span>{t}</span>
        </div>
      ))}
    </div>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]!.toUpperCase())
    .join("");
}

const SECTIONS: Array<{ id: SectionVisId; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "kpi", label: "KPIs" },
  { id: "cost", label: "Ad Cost" },
  { id: "leads", label: "Lead Analytics" },
  { id: "cases", label: "Case Analytics" },
];

type SectionVisId = "overview" | "kpi" | "cost" | "leads" | "intake" | "cases";

function isVisible(
  vis: DashboardData["visibility"],
  section: SectionVisId
): boolean {
  if (!vis) return true;
  return vis.sections[section] !== false;
}

function isSubVisible(
  vis: DashboardData["visibility"],
  section: SectionVisId,
  sub: string
): boolean {
  if (!vis) return true;
  if (vis.sections[section] === false) return false;
  const key = `${section}.${sub}`;
  return vis.subsections[key] !== false;
}

function SectionNav({
  visibility,
  bucket,
  onBucketChange,
}: {
  visibility: DashboardData["visibility"];
  bucket: Bucket;
  onBucketChange: (b: Bucket) => void;
}) {
  const visible = SECTIONS.filter((s) => isVisible(visibility, s.id));
  return (
    <aside className="hidden lg:block w-56 shrink-0">
      <div className="sticky top-24 space-y-4">
        <BucketSwitcher value={bucket} onChange={onBucketChange} />
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold px-3 pb-2">
            Sections
          </div>
          {visible.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="block px-3 py-1.5 rounded-md text-sm text-slate-600 hover:text-blue-700 hover:bg-blue-50/60 transition-colors"
            >
              {s.label}
            </a>
          ))}
        </div>
      </div>
    </aside>
  );
}

function MobileNavDrawer({
  open,
  onClose,
  visibility,
  bucket,
  onBucketChange,
}: {
  open: boolean;
  onClose: () => void;
  visibility: DashboardData["visibility"];
  bucket: Bucket;
  onBucketChange: (b: Bucket) => void;
}) {
  const visibleSections = SECTIONS.filter((s) => isVisible(visibility, s.id));
  if (!open) return null;
  return (
    <div className="lg:hidden fixed inset-0 z-40">
      <div
        className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm"
        onClick={onClose}
      />
      <aside className="absolute left-0 top-0 bottom-0 w-72 max-w-[85vw] bg-white shadow-xl flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
          <span className="text-sm font-semibold text-slate-800">Navigation</span>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100"
            aria-label="Close navigation"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          <BucketSwitcher
            value={bucket}
            onChange={(b) => {
              onBucketChange(b);
              onClose();
            }}
          />
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold px-1 pb-2">
              Sections
            </div>
            {visibleSections.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                onClick={onClose}
                className="block px-3 py-2 rounded-md text-sm text-slate-700 hover:bg-blue-50/60 hover:text-blue-700 transition-colors"
              >
                {s.label}
              </a>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}

function AdminUserMenu({
  isAdmin,
  onRefresh,
  refreshing,
}: {
  isAdmin: boolean;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  return (
    <UserButton>
      <UserButton.MenuItems>
        <UserButton.Link
          label="Onboarding guide"
          labelIcon={<BookOpen className="h-4 w-4" />}
          href="/onboarding"
        />
      </UserButton.MenuItems>
      {isAdmin && (
        <UserButton.MenuItems>
          <UserButton.Link
            label="Section visibility"
            labelIcon={<Shield className="h-4 w-4" />}
            href="/admin"
          />
          <UserButton.Action
            label={refreshing ? "Syncing…" : "Refresh data now"}
            labelIcon={<RefreshIcon className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />}
            onClick={onRefresh}
          />
          <UserButton.Action
            label="Export 12-month KPI history"
            labelIcon={<FileDown className="h-4 w-4" />}
            onClick={() => downloadHistoricalKpi(12)}
          />
          <UserButton.Action
            label="Export 24-month KPI history"
            labelIcon={<FileDown className="h-4 w-4" />}
            onClick={() => downloadHistoricalKpi(24)}
          />
        </UserButton.MenuItems>
      )}
    </UserButton>
  );
}

function ExportCsvButton({
  onClick,
  label = "Export CSV",
}: {
  onClick: () => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:text-blue-700 hover:border-blue-200 hover:bg-blue-50 transition"
      title={label}
    >
      <Download className="h-3.5 w-3.5" />
      {label}
    </button>
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
  const [bucket, setBucket] = useState<Bucket>("combined");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

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
        // Clear stale data so the user doesn't see numbers from the
        // previously-loaded preset alongside the "missing snapshot"
        // message — that mismatch was causing confusion.
        setData(null);
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
        <div className="max-w-7xl mx-auto px-3 sm:px-6 py-2.5 sm:py-3.5 flex flex-wrap items-center gap-2 sm:gap-4 justify-between">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              className="lg:hidden p-1.5 rounded-md text-slate-600 hover:bg-slate-100 shrink-0"
              aria-label="Open navigation"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="hidden sm:flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 text-white shadow-[0_1px_2px_rgba(37,99,235,0.4)] shrink-0">
              <Sparkles className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h1 className="text-[14px] sm:text-[15px] font-semibold tracking-tight text-slate-900 flex items-center gap-2 truncate">
                <span className="truncate">PPLT Intake Dashboard</span>
                {demoBadge && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 text-[10px] font-semibold uppercase tracking-wider ring-1 ring-inset ring-blue-200 shrink-0">
                    Demo
                  </span>
                )}
              </h1>
              <p className="hidden sm:block text-[11px] text-slate-500">
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
            {headerRight ?? (
              <AdminUserMenu
                isAdmin={data?.visibility?.isAdmin ?? false}
                onRefresh={refresh}
                refreshing={refreshing}
              />
            )}
          </div>
        </div>
      </header>

      <MobileNavDrawer
        open={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
        visibility={data?.visibility}
        bucket={bucket}
        onBucketChange={setBucket}
      />
      <div className="max-w-[1400px] mx-auto px-3 sm:px-6 py-4 sm:py-8 flex gap-6 lg:gap-8">
        <SectionNav
          visibility={data?.visibility}
          bucket={bucket}
          onBucketChange={setBucket}
        />
        <main className="flex-1 min-w-0 space-y-6 sm:space-y-10">
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
        {data && metaBlockedBanner(data)}
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
            {isVisible(data.visibility, "overview") && <Overview data={data} bucket={bucket} />}
            {isVisible(data.visibility, "kpi") && <Kpi data={data} bucket={bucket} />}
            {isVisible(data.visibility, "cost") && <CostBlock data={data} bucket={bucket} />}
            {isVisible(data.visibility, "leads") && <LeadsBlock data={data} bucket={bucket} />}
            {/* Intake Team section temporarily disabled per user request. */}
            {isVisible(data.visibility, "cases") && <CasesBlock data={data} bucket={bucket} />}
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

  function Overview({ data, bucket }: { data: DashboardData; bucket: Bucket }) {
    const o =
      bucket === "english"
        ? data.overviewEnglish ?? data.overview
        : bucket === "spanish"
          ? data.overviewSpanish ?? data.overview
          : data.overview;
    const bucketLabel =
      bucket === "english" ? "PPLT (English)" : bucket === "spanish" ? "Abogado (Spanish)" : "Combined";
    const dyn = sectionWarnings(data, ["Overview"]);
    const info: string[] = [];
    info.push(
      `"Leads" counts Meta lead-ad form submissions that landed in GHL, deduped within 3 days. "Referred to Co-Counsel" = opps entering co-counsel / referral-broker / referred-out pipelines. "Signed" = opps entering a signed stage.`
    );
    if (o.reviews.lifetime === 0) {
      info.push("Google Reviews showing zero — Reputation API scope likely missing on the GHL Private Integration Token. Regenerate with Reputation > Read.");
    }
    return (
      <section id="overview">
        <SectionHeader
          title="Overview"
          subtitle={`${bucketLabel} · Last 30 days vs prior 30 days, last 7 days vs prior 7 days · DATE PICKER DOES NOT APPLY (rolling windows)`}
        />
        <SectionWarning tone="warn" items={dyn} />
        <SectionWarning tone="info" items={info} />
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
            label="Referred to Co-Counsel · Last 30 Days"
            value={o.referrals30.current.toLocaleString()}
            delta={o.referrals30}
            sub={`Prior 30 days: ${o.referrals30.previous.toLocaleString()}`}
          />
          <StatCard
            icon={UserPlus}
            label="Referred to Co-Counsel · Last 7 Days"
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
        </div>
      </section>
    );
  }

  function Kpi({ data, bucket }: { data: DashboardData; bucket: Bucket }) {
    const showMonths = isSubVisible(data.visibility, "kpi", "by_month");
    const showQuarters = isSubVisible(data.visibility, "kpi", "by_quarter");
    // Filter KPI blocks to show only the matching bucket column when set.
    const filterBlock = (block: KpiBlock): KpiBlock => {
      if (bucket === "combined") return block;
      return {
        ...block,
        rows: block.rows.map((r) => ({
          ...r,
          spanish: bucket === "spanish" ? r.spanish : "—",
          english: bucket === "english" ? r.english : "—",
        })),
      };
    };

    const dyn = sectionWarnings(data, ["KPI table"]);
    return (
      <section id="kpi">
        <SectionHeader
          title="KPIs"
          subtitle="Spanish vs English · current + previous month, current + last quarter · DATE PICKER DOES NOT APPLY (calendar months / quarters)"
        />
        <SectionWarning tone="warn" items={dyn} />
        <div className="space-y-6">
          {showMonths && (
            <div>
              <h3 className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-3">
                By Month
              </h3>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {data.kpi.months.map((b) => (
                  <KpiTable key={b.title} block={filterBlock(b)} />
                ))}
              </div>
            </div>
          )}
          {showQuarters && (
            <div>
              <h3 className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-3">
                By Quarter
              </h3>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {data.kpi.quarters.map((b) => (
                  <KpiTable key={b.title} block={filterBlock(b)} />
                ))}
              </div>
            </div>
          )}
          <p className="text-[11px] text-slate-500 leading-relaxed">
            <span className="font-semibold">* Lead Forms (Meta/GHL):</span>{" "}
            GHL contacts whose source is a Meta (Facebook / Instagram)
            lead-ad form, deduped within 3 days by phone (or email fallback)
            so multiple form-fills from the same person for the same case
            count once. Same person submitting more than 3 days apart
            counts as a new lead. Meta leads that didn't land in GHL are
            excluded by definition.
          </p>
        </div>
      </section>
    );
  }

  // Email + Reviews removed per Jason: GHL public API doesn't expose
  // email campaign stats, and the Reputation endpoint needs a PIT scope
  // we don't have. Will revisit once we have a real data source.

  function CostBlock({ data, bucket }: { data: DashboardData; bucket: Bucket }) {
    const rawCost = data.cost;
    if (!rawCost) return null;
    // Filter ads + practice areas + area×state by ad.account so the totals
    // recompute consistently for English (pplt + workersComp) vs Spanish
    // (abogado). Combined keeps everything.
    const c = useMemo(() => {
      if (bucket === "combined") return rawCost;
      const matchAccount = (acct: string) =>
        bucket === "spanish" ? acct === "abogado" : acct !== "abogado";
      const byAd = rawCost.byAd.filter((r) => matchAccount(r.account));
      const totalSpend = byAd.reduce((s, r) => s + r.spend, 0);
      const totalLeadsMeta = byAd.reduce((s, r) => s + r.leadsMeta, 0);
      const totalSigned = byAd.reduce((s, r) => s + r.signed, 0);
      // Re-aggregate by practice area from the filtered ads.
      const paMap = new Map<
        string,
        {
          area: string;
          spend: number;
          leadsMeta: number;
          signed: number;
          referred: number;
          signedCohort: number;
          referredCohort: number;
          adCount: number;
          dts: number;
          dtsCount: number;
          dtr: number;
          dtrCount: number;
        }
      >();
      for (const ad of byAd) {
        const key = ad.practiceArea === "unknown" ? "Unclassified" : ad.practiceArea;
        const slot = paMap.get(key) ?? {
          area: key, spend: 0, leadsMeta: 0, signed: 0, referred: 0,
          signedCohort: 0, referredCohort: 0, adCount: 0,
          dts: 0, dtsCount: 0, dtr: 0, dtrCount: 0,
        };
        slot.spend += ad.spend;
        slot.leadsMeta += ad.leadsMeta;
        slot.signed += ad.signed;
        slot.referred += ad.referred;
        slot.signedCohort += ad.signedCohort;
        slot.referredCohort += ad.referredCohort;
        slot.adCount += 1;
        if (ad.avgDaysToSigned !== null && ad.signed > 0) {
          slot.dts += ad.avgDaysToSigned * ad.signed;
          slot.dtsCount += ad.signed;
        }
        if (ad.avgDaysToReferred !== null && ad.referred > 0) {
          slot.dtr += ad.avgDaysToReferred * ad.referred;
          slot.dtrCount += ad.referred;
        }
        paMap.set(key, slot);
      }
      const byPracticeArea: PracticeAreaCostRow[] = Array.from(paMap.values())
        .map((r) => ({
          area: r.area,
          spend: r.spend,
          leadsMeta: r.leadsMeta,
          signed: r.signed,
          referred: r.referred,
          signedCohort: r.signedCohort,
          referredCohort: r.referredCohort,
          adCount: r.adCount,
          // signedAll is firm-wide (we don't tag by bucket at compute time).
          // Leave undefined in English/Spanish modes so the column shows "—"
          // and users don't misread firm-wide totals as bucket-specific.
          signedAll: undefined,
          cpl: r.leadsMeta > 0 ? r.spend / r.leadsMeta : null,
          cpsc: r.signed > 0 ? r.spend / r.signed : null,
          cpscCohort: r.signedCohort > 0 ? r.spend / r.signedCohort : null,
          avgDaysToSigned: r.dtsCount > 0 ? r.dts / r.dtsCount : null,
          avgDaysToReferred: r.dtrCount > 0 ? r.dtr / r.dtrCount : null,
          cohortMaturing: rawCost.byPracticeArea[0]?.cohortMaturing ?? false,
        }))
        .sort((a, b) => b.spend - a.spend);
      // byAreaState rows don't carry an account, so we can't filter them
      // cleanly. Hide the table entirely under English/Spanish; user can
      // switch to Combined to see it.
      const byAreaState: typeof rawCost.byAreaState = [];
      return {
        ...rawCost,
        totalSpend,
        totalLeadsMeta,
        totalSigned,
        // totalSignedAll + totalSignedMetaSource + oppPracticeArea* are
        // firm-wide; bucket-filtered views can't accurately re-split them
        // without locationKey tagging at compute time. Leave undefined here
        // so the attribution banner hides in bucket mode.
        totalSignedAll: undefined,
        totalSignedMetaSource: undefined,
        oppPracticeAreaHits: undefined,
        oppPracticeAreaMisses: undefined,
        totalCpl: totalLeadsMeta > 0 ? totalSpend / totalLeadsMeta : null,
        totalCpsc: totalSigned > 0 ? totalSpend / totalSigned : null,
        byAd,
        byPracticeArea,
        byAreaState,
      };
    }, [rawCost, bucket]);
    const fmtUsd = (n: number) =>
      `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
    const fmtUsd2 = (n: number | null) =>
      n === null
        ? "—"
        : `$${Math.round(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
    const showHeadline = isSubVisible(data.visibility, "cost", "headline");
    const showByArea = isSubVisible(data.visibility, "cost", "by_practice_area");
    const showByAreaState = isSubVisible(data.visibility, "cost", "by_area_state");
    const showPerAd = isSubVisible(data.visibility, "cost", "per_ad");
    const dyn = sectionWarnings(data, ["Cost analytics", "Meta ad insights"]);
    const info: string[] = [];
    if (c.metaStaleAsOf) {
      info.push(
        `Live Meta fetch is currently blocked. Showing CACHED Meta data from ${new Date(c.metaStaleAsOf).toLocaleString()}. Spend / Leads / CPL columns are stale; Referred / Signed (joined from GHL) are fresh.`
      );
    } else if (c.totalSpend === 0 && c.totalLeadsMeta === 0) {
      info.push(
        "Meta returning no data for this window. Most common cause: Meta token rejected (\"API access blocked\") AND no cached Meta data on file. Most likely fix: switch the Jaguar Ad Reporting App from Development -> Live mode at developers.facebook.com/apps/1522616902816088/dashboard/."
      );
    }
    info.push(
      "Signed + CPSC each show two numbers: the BIG number is window-attribution (stage flipped IN the window, regardless of lead date — matches Ads Manager). The smaller 'coh N' below is cohort attribution (signs from leads originating IN the window — true CAC, still maturing if window ends < 60 days ago). Avg days-to-Sign / Ref are in the CSV export."
    );
    // Attribution-rate banner: surface the gap between what the dashboard
    // can credit to a Meta ad (utmAdId on the opp) vs. total signs in the
    // window. Only shown in Combined mode — bucket views can't accurately
    // re-split the firm-wide total.
    const totalSignedAll = c.totalSignedAll ?? 0;
    const attributedSigned = c.totalSigned ?? 0;
    const metaSourceRecovered = c.totalSignedMetaSource ?? 0;
    const metaInfluenced = attributedSigned + metaSourceRecovered;
    const showAttributionBanner =
      bucket === "combined" && totalSignedAll > 0;
    const attributionPct = totalSignedAll > 0
      ? Math.round((attributedSigned / totalSignedAll) * 100)
      : 0;
    const metaInfluencedPct = totalSignedAll > 0
      ? Math.round((metaInfluenced / totalSignedAll) * 100)
      : 0;
    const other = Math.max(0, totalSignedAll - metaInfluenced);
    return (
      <section id="cost">
        <SectionHeader
          title="Ad Cost"
          subtitle={`Meta ad spend joined with GHL signed / referred · DATE PICKER APPLIES (window: ${data.range.label})`}
        />
        <SectionWarning tone="warn" items={dyn} />
        <SectionWarning tone="info" items={info} />
        {showAttributionBanner && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-sm text-amber-900">
            <div className="font-semibold mb-2">
              Sign attribution · {totalSignedAll.toLocaleString()} total signs in this window
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-2">
              <div className="rounded-lg bg-white/60 border border-amber-100 px-3 py-2">
                <div className="text-[11px] uppercase tracking-wider text-amber-700 font-semibold">Ad-attributed</div>
                <div className="text-lg font-bold tabular-nums">{attributedSigned.toLocaleString()}</div>
                <div className="text-[10px] text-amber-700">{attributionPct}% · opp has utmAdId</div>
              </div>
              <div className="rounded-lg bg-white/60 border border-amber-100 px-3 py-2">
                <div className="text-[11px] uppercase tracking-wider text-amber-700 font-semibold">Meta-source (recovered)</div>
                <div className="text-lg font-bold tabular-nums">{metaSourceRecovered.toLocaleString()}</div>
                <div className="text-[10px] text-amber-700">contact source = FB / IG / Meta, no ad ID</div>
              </div>
              <div className="rounded-lg bg-white/60 border border-amber-100 px-3 py-2">
                <div className="text-[11px] uppercase tracking-wider text-amber-700 font-semibold">Other</div>
                <div className="text-lg font-bold tabular-nums">{other.toLocaleString()}</div>
                <div className="text-[10px] text-amber-700">referrals, organic, walk-ins, blank source</div>
              </div>
            </div>
            <div className="text-amber-800 text-[12px] leading-relaxed">
              <span className="font-semibold">Meta-influenced total: {metaInfluenced.toLocaleString()} signs ({metaInfluencedPct}%).</span>{" "}
              The "Recovered" bucket comes from contacts where the source field still references Facebook / Instagram / Meta but the <code className="bg-amber-100 px-1 rounded">utmAdId</code> was dropped during the contact → opportunity transfer in GHL — those signs are Meta-driven but can't be tied to a specific ad. The "Total" column in the tables below counts all three buckets.
            </div>
            {(() => {
              const hits = c.oppPracticeAreaHits ?? 0;
              const misses = c.oppPracticeAreaMisses ?? 0;
              const tot = hits + misses;
              if (tot === 0) return null;
              const pct = Math.round((hits / tot) * 100);
              return (
                <div className="mt-2 pt-2 border-t border-amber-200 text-amber-800 text-[11px] leading-relaxed">
                  <span className="font-semibold">Practice Area (Opportunity) data quality:</span>{" "}
                  {hits.toLocaleString()} of {tot.toLocaleString()} signs ({pct}%) have the opp-level field populated. The remaining {misses.toLocaleString()} fall back to the pipeline's practice area (which buckets the in-house Maryland pipeline as &quot;General PI&quot;). Populate the field at intake for cleaner attribution.
                </div>
              );
            })()}
          </div>
        )}
        {showHeadline && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              icon={DollarSign}
              label="Meta Spend"
              value={fmtUsd(c.totalSpend)}
              sub={`${c.windowLabel}`}
            />
            <StatCard
              icon={Users}
              label="Leads (Meta)"
              value={c.totalLeadsMeta.toLocaleString()}
              sub={`Ads Manager 'lead' action`}
            />
            <StatCard
              icon={Target}
              label="Cost Per Lead"
              value={fmtUsd2(c.totalCpl)}
              sub={`Spend / Meta leads`}
            />
            <StatCard
              icon={CheckCircle2}
              label="Cost Per Signed"
              value={fmtUsd2(c.totalCpsc)}
              sub={`Signed in window via ad attribution`}
            />
          </div>
        )}

        {showByArea && (
        <div className="mt-6">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">
              By Practice Area
            </h3>
            <ExportCsvButton
              onClick={() =>
                downloadCsv(
                  "ad-cost-by-practice-area",
                  [
                    { header: "Practice area", get: (r) => r.area },
                    { header: "Ads", get: (r) => r.adCount },
                    { header: "Spend ($)", get: (r) => Math.round(r.spend) },
                    { header: "Leads (Meta)", get: (r) => r.leadsMeta },
                    { header: "Signed (Meta-attributed)", get: (r) => r.signed },
                    { header: "Total signs (any source)", get: (r) => r.signedAll ?? "" },
                    { header: "CPL ($)", get: (r) => (r.cpl === null ? "" : Math.round(r.cpl)) },
                    { header: "CPSC ($)", get: (r) => (r.cpsc === null ? "" : Math.round(r.cpsc)) },
                  ],
                  c.byPracticeArea
                )
              }
            />
          </div>
          <PracticeAreaCostTable rows={c.byPracticeArea} fmtUsd={fmtUsd} fmtUsd2={fmtUsd2} />
        </div>
        )}

        {showByAreaState && (
        <div className="mt-6">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold flex items-center gap-2">
              By Area × State
              <span className="text-[10px] font-normal normal-case tracking-normal text-slate-400">
                · state from contact's State (Jurisdiction); spend attributed via $/Meta-lead
              </span>
            </h3>
            <ExportCsvButton
              onClick={() =>
                downloadCsv(
                  "ad-cost-by-area-state",
                  [
                    { header: "Area", get: (r) => r.area },
                    { header: "State", get: (r) => r.state },
                    { header: "Spend ($)", get: (r) => Math.round(r.spend) },
                    { header: "Leads", get: (r) => r.leads },
                    { header: "Signed (Meta-attributed)", get: (r) => r.signed },
                    { header: "Total signs (any source)", get: (r) => r.signedAll ?? "" },
                    { header: "Referred", get: (r) => r.referred },
                    { header: "CPL ($)", get: (r) => (r.cpl === null ? "" : Math.round(r.cpl)) },
                    { header: "CPSC ($)", get: (r) => (r.cpsc === null ? "" : Math.round(r.cpsc)) },
                  ],
                  c.byAreaState ?? []
                )
              }
            />
          </div>
          <AreaStateCostTable rows={c.byAreaState ?? []} fmtUsd={fmtUsd} fmtUsd2={fmtUsd2} />
        </div>
        )}

        {showPerAd && (
        <div className="mt-6">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">
              Per Ad · top 40 by spend
            </h3>
            <div className="flex items-center gap-2">
              <ExportCsvButton
                label="Top 40"
                onClick={() =>
                  downloadCsv(
                    "ad-cost-per-ad-top40",
                    [
                      { header: "Ad", get: (r) => r.adName },
                      { header: "Campaign", get: (r) => r.campaignName },
                      { header: "Ad set", get: (r) => r.adsetName },
                      { header: "Account", get: (r) => r.account },
                      { header: "Practice area", get: (r) => r.practiceArea },
                      { header: "Spend ($)", get: (r) => Math.round(r.spend) },
                      { header: "Leads (Meta)", get: (r) => r.leadsMeta },
                      { header: "Signed", get: (r) => r.signed },
                      { header: "CPL ($)", get: (r) => (r.cpl === null ? "" : Math.round(r.cpl)) },
                      { header: "CPSC ($)", get: (r) => (r.cpsc === null ? "" : Math.round(r.cpsc)) },
                      { header: "Ad ID", get: (r) => r.adId },
                    ],
                    c.byAd.slice(0, 40)
                  )
                }
              />
              <ExportCsvButton
                label={`All ${c.byAd.length}`}
                onClick={() =>
                  downloadCsv(
                    "ad-cost-per-ad-all",
                    [
                      { header: "Ad", get: (r) => r.adName },
                      { header: "Campaign", get: (r) => r.campaignName },
                      { header: "Ad set", get: (r) => r.adsetName },
                      { header: "Account", get: (r) => r.account },
                      { header: "Practice area", get: (r) => r.practiceArea },
                      { header: "Spend ($)", get: (r) => Math.round(r.spend) },
                      { header: "Leads (Meta)", get: (r) => r.leadsMeta },
                      { header: "Signed", get: (r) => r.signed },
                      { header: "CPL ($)", get: (r) => (r.cpl === null ? "" : Math.round(r.cpl)) },
                      { header: "CPSC ($)", get: (r) => (r.cpsc === null ? "" : Math.round(r.cpsc)) },
                      { header: "Ad ID", get: (r) => r.adId },
                    ],
                    c.byAd
                  )
                }
              />
            </div>
          </div>
          <AdCostTable rows={c.byAd.slice(0, 40)} fmtUsd={fmtUsd} fmtUsd2={fmtUsd2} />
        </div>
        )}
      </section>
    );
  }

  function AreaStateCostTable({
    rows,
    fmtUsd,
    fmtUsd2,
  }: {
    rows: AreaStateCostRow[];
    fmtUsd: (n: number) => string;
    fmtUsd2: (n: number | null) => string;
  }) {
    type Col =
      | "area" | "state" | "cpl" | "cpsc" | "cpscCohort"
      | "spend" | "leads" | "signed" | "signedCohort" | "signedAll" | "referred";
    const { sorted, sortKey, sortDir, onSort } = useSortable<AreaStateCostRow, Col>(
      rows,
      "spend",
      "desc",
      (r, k) => (r[k] ?? null) as string | number | null
    );
    const [expanded, setExpanded] = useState(false);
    const visible = expanded ? sorted : sorted.slice(0, 10);
    const hiddenCount = sorted.length - visible.length;
    return (
      <>
      <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50/60">
            <tr className="border-b border-slate-200">
              <SortHeader label="Area" columnKey="area" activeKey={sortKey} activeDir={sortDir} onSort={onSort} align="left" className="px-3" />
              <SortHeader label="State" columnKey="state" activeKey={sortKey} activeDir={sortDir} onSort={onSort} align="left" className="px-3" />
              <SortHeader label="Spend" columnKey="spend" activeKey={sortKey} activeDir={sortDir} onSort={onSort} align="right" className="px-3" />
              <SortHeader label="Leads" columnKey="leads" activeKey={sortKey} activeDir={sortDir} onSort={onSort} align="right" className="px-3" />
              <SortHeader label="Referred" columnKey="referred" activeKey={sortKey} activeDir={sortDir} onSort={onSort} align="right" className="px-3" />
              <SortHeader label="Signed" columnKey="signed" activeKey={sortKey} activeDir={sortDir} onSort={onSort} align="right" className="px-3" />
              <SortHeader label="Total" columnKey="signedAll" activeKey={sortKey} activeDir={sortDir} onSort={onSort} align="right" className="px-3" />
              <SortHeader label="CPL" columnKey="cpl" activeKey={sortKey} activeDir={sortDir} onSort={onSort} align="right" className="px-3" />
              <SortHeader label="CPSC" columnKey="cpsc" activeKey={sortKey} activeDir={sortDir} onSort={onSort} align="right" className="px-3" />
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-slate-400 text-sm">
                  No (area × state) buckets in this window. Most likely the contacts coming from these ads don&apos;t have State (Jurisdiction) populated.
                </td>
              </tr>
            ) : visible.map((r, i) => (
              <tr key={`${r.area}-${r.state}-${i}`} className={`border-t border-slate-100 hover:bg-slate-50/60 transition-colors ${i % 2 === 1 ? "bg-slate-50/30" : ""}`}>
                <td className="px-3 py-2.5 font-medium text-slate-800">{r.area}</td>
                <td className="px-3 py-2.5 text-slate-700">{r.state}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{fmtUsd(r.spend)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{r.leads.toLocaleString()}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{r.referred.toLocaleString()}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  <div>{r.signed.toLocaleString()}</div>
                  <div className="text-[10px] text-slate-400">coh {r.signedCohort.toLocaleString()}</div>
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-slate-800" title="Total signs in window for this (area, state) from any source.">
                  {r.signedAll === undefined ? <span className="text-slate-300">—</span> : r.signedAll.toLocaleString()}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">{fmtUsd2(r.cpl)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-blue-700">
                  <div>{fmtUsd2(r.cpsc)}</div>
                  <div className="text-[10px] font-normal text-slate-400">coh {fmtUsd2(r.cpscCohort)}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sorted.length > 10 && (
        <div className="mt-2 flex justify-center">
          <button
            type="button"
            onClick={() => setExpanded((s) => !s)}
            className="text-xs text-blue-700 hover:text-blue-900 font-medium px-3 py-1.5 rounded-md hover:bg-blue-50 transition-colors"
          >
            {expanded ? `Show top 10 only` : `Show all ${sorted.length} rows (${hiddenCount} more)`}
          </button>
        </div>
      )}
      </>
    );
  }

  function PracticeAreaCostTable({
    rows,
    fmtUsd,
    fmtUsd2,
  }: {
    rows: PracticeAreaCostRow[];
    fmtUsd: (n: number) => string;
    fmtUsd2: (n: number | null) => string;
  }) {
    type Col =
      | "area" | "adCount" | "spend" | "leadsMeta" | "signed" | "referred"
      | "signedCohort" | "signedAll" | "cpl" | "cpsc" | "cpscCohort";
    const { sorted, sortKey, sortDir, onSort } = useSortable<PracticeAreaCostRow, Col>(
      rows,
      "spend",
      "desc",
      (r, k) => (r[k] ?? null) as string | number | null
    );
    return (
      <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50/60">
            <tr className="border-b border-slate-200">
              <SortHeader label="Practice area" columnKey="area" activeKey={sortKey} activeDir={sortDir} onSort={onSort} align="left" className="px-3" />
              <SortHeader label="Ads" columnKey="adCount" activeKey={sortKey} activeDir={sortDir} onSort={onSort} align="right" className="px-3" />
              <SortHeader label="Spend" columnKey="spend" activeKey={sortKey} activeDir={sortDir} onSort={onSort} align="right" className="px-3" />
              <SortHeader label="Leads" columnKey="leadsMeta" activeKey={sortKey} activeDir={sortDir} onSort={onSort} align="right" className="px-3" />
              <SortHeader label="Referred" columnKey="referred" activeKey={sortKey} activeDir={sortDir} onSort={onSort} align="right" className="px-3" />
              <SortHeader label="Signed" columnKey="signed" activeKey={sortKey} activeDir={sortDir} onSort={onSort} align="right" className="px-3" />
              <SortHeader label="Total" columnKey="signedAll" activeKey={sortKey} activeDir={sortDir} onSort={onSort} align="right" className="px-3" />
              <SortHeader label="CPL" columnKey="cpl" activeKey={sortKey} activeDir={sortDir} onSort={onSort} align="right" className="px-3" />
              <SortHeader label="CPSC" columnKey="cpsc" activeKey={sortKey} activeDir={sortDir} onSort={onSort} align="right" className="px-3" />
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr><td colSpan={9} className="px-3 py-6 text-center text-slate-400 text-sm">No ad spend in this window.</td></tr>
            ) : sorted.map((r) => (
              <tr key={r.area} className="border-t border-slate-100 hover:bg-slate-50/60 transition-colors">
                <td className="px-3 py-2.5 font-medium text-slate-800">{r.area}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">{r.adCount}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{fmtUsd(r.spend)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{r.leadsMeta.toLocaleString()}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{r.referred.toLocaleString()}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  <div>{r.signed.toLocaleString()}</div>
                  <div className="text-[10px] text-slate-400" title="Cohort: leads from this window that have signed by now">
                    coh {r.signedCohort.toLocaleString()}
                  </div>
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-slate-800" title="Total signs in window from any source (Meta ads, referrals, organic, walk-ins). Includes signs the dashboard couldn't attribute to a specific Meta ad.">
                  {r.signedAll === undefined ? <span className="text-slate-300">—</span> : r.signedAll.toLocaleString()}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">{fmtUsd2(r.cpl)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-blue-700">
                  <div>{fmtUsd2(r.cpsc)}</div>
                  <div className="text-[10px] font-normal text-slate-400" title="Cohort: Spend / signs from leads originating in this window">
                    coh {fmtUsd2(r.cpscCohort)}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  function AdCostTable({
    rows,
    fmtUsd,
    fmtUsd2,
  }: {
    rows: AdCostRow[];
    fmtUsd: (n: number) => string;
    fmtUsd2: (n: number | null) => string;
  }) {
    const [expanded, setExpanded] = useState(false);
    type Col =
      | "adName" | "campaignName" | "account" | "practiceArea"
      | "spend" | "leadsMeta" | "signed" | "referred" | "signedCohort"
      | "cpl" | "cpsc" | "cpscCohort";
    const { sorted, sortKey, sortDir, onSort } = useSortable<AdCostRow, Col>(
      rows,
      "spend",
      "desc",
      (r, k) => r[k] as string | number | null
    );
    const visible = expanded ? sorted : sorted.slice(0, 10);
    const hiddenCount = sorted.length - visible.length;
    return (
      <>
      <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50/60">
            <tr className="border-b border-slate-200">
              <SortHeader label="Ad" columnKey="adName" activeKey={sortKey} activeDir={sortDir} onSort={onSort} align="left" />
              <SortHeader label="Acct" columnKey="account" activeKey={sortKey} activeDir={sortDir} onSort={onSort} align="left" />
              <SortHeader label="Area" columnKey="practiceArea" activeKey={sortKey} activeDir={sortDir} onSort={onSort} align="left" />
              <SortHeader label="Spend" columnKey="spend" activeKey={sortKey} activeDir={sortDir} onSort={onSort} align="right" />
              <SortHeader label="Leads" columnKey="leadsMeta" activeKey={sortKey} activeDir={sortDir} onSort={onSort} align="right" />
              <SortHeader label="Ref" columnKey="referred" activeKey={sortKey} activeDir={sortDir} onSort={onSort} align="right" />
              <SortHeader label="Signed" columnKey="signed" activeKey={sortKey} activeDir={sortDir} onSort={onSort} align="right" />
              <SortHeader label="CPL" columnKey="cpl" activeKey={sortKey} activeDir={sortDir} onSort={onSort} align="right" />
              <SortHeader label="CPSC" columnKey="cpsc" activeKey={sortKey} activeDir={sortDir} onSort={onSort} align="right" />
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr><td colSpan={9} className="px-3 py-6 text-center text-slate-400 text-sm">No ads with spend in this window.</td></tr>
            ) : visible.map((r, i) => (
              <tr key={r.adId + i} className={`border-t border-slate-100 hover:bg-slate-50/60 transition-colors ${i % 2 === 1 ? "bg-slate-50/30" : ""}`}>
                <td className="px-3 py-2.5 font-medium text-slate-800 max-w-[260px] truncate" title={`${r.adName} — ${r.campaignName}`}>
                  <div className="truncate">{r.adName}</div>
                  <div className="text-[10px] text-slate-400 truncate">{r.campaignName}</div>
                </td>
                <td className="px-3 py-2.5 text-[11px]">
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-medium uppercase tracking-wider">
                    {r.account === "workersComp" ? "WC" : r.account.toUpperCase()}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-slate-600 text-[11px]">{r.practiceArea === "unknown" ? "—" : r.practiceArea}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{fmtUsd(r.spend)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{r.leadsMeta}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{r.referred}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  <div>{r.signed}</div>
                  <div className="text-[10px] text-slate-400">coh {r.signedCohort}</div>
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">{fmtUsd2(r.cpl)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-blue-700">
                  <div>{fmtUsd2(r.cpsc)}</div>
                  <div className="text-[10px] font-normal text-slate-400">coh {fmtUsd2(r.cpscCohort)}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sorted.length > 10 && (
        <div className="mt-2 flex justify-center">
          <button
            type="button"
            onClick={() => setExpanded((s) => !s)}
            className="text-xs text-blue-700 hover:text-blue-900 font-medium px-3 py-1.5 rounded-md hover:bg-blue-50 transition-colors"
          >
            {expanded ? `Show top 10 only` : `Show all ${sorted.length} rows (${hiddenCount} more)`}
          </button>
        </div>
      )}
      </>
    );
  }

  function LeadsBlock({ data, bucket }: { data: DashboardData; bucket: Bucket }) {
    const showEnSrc =
      isSubVisible(data.visibility, "leads", "english_sources") && bucket !== "spanish";
    const showEsSrc =
      isSubVisible(data.visibility, "leads", "spanish_sources") && bucket !== "english";
    const showEnStatus =
      isSubVisible(data.visibility, "leads", "english_status") && bucket !== "spanish";
    const showEsStatus =
      isSubVisible(data.visibility, "leads", "spanish_status") && bucket !== "english";
    const dyn = sectionWarnings(data, ["Spanish lead analytics", "English lead analytics"]);
    const info: string[] = [
      "Source Mix uses RAW GHL contact sources (every channel, no dedupe) so manual / referral / prior-client buckets remain visible here. The Lead Forms (Meta/GHL) total used elsewhere is a tighter subset.",
    ];
    return (
      <section id="leads">
        <SectionHeader
          title="Lead Analytics"
          subtitle={`Sources and conversion · DATE PICKER APPLIES (window: ${data.range.label})`}
        />
        <SectionWarning tone="warn" items={dyn} />
        <SectionWarning tone="info" items={info} />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {showEnSrc && (
            <LeadCard
              heading="English Sources"
              badge="PPLT"
              pieData={data.leadsEnglish.sourceMix.map((r) => ({ name: r.source, value: r.count }))}
              conversionPct={data.leadsEnglish.conversionRatePct}
              avgDaysToSigned={data.leadsEnglish.avgDaysToSigned}
            />
          )}
          {showEsSrc && (
            <LeadCard
              heading="Spanish Sources"
              badge="Abogado"
              pieData={data.leadsSpanish.sourceMix.map((r) => ({ name: r.source, value: r.count }))}
              conversionPct={data.leadsSpanish.conversionRatePct}
              avgDaysToSigned={data.leadsSpanish.avgDaysToSigned}
            />
          )}
          {showEnStatus && (
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <h3 className="text-sm font-semibold text-slate-900 mb-3">
                English — Leads by Status
              </h3>
              <BarCount
                data={data.leadsEnglish.byStatus.map((r) => ({ name: r.status, value: r.count }))}
              />
            </div>
          )}
          {showEsStatus && (
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <h3 className="text-sm font-semibold text-slate-900 mb-3">
                Spanish — Leads by Status
              </h3>
              <BarCount
                data={data.leadsSpanish.byStatus.map((r) => ({ name: r.status, value: r.count }))}
              />
            </div>
          )}
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

  function IntakeTeamBlock({ data, bucket }: { data: DashboardData; bucket: Bucket }) {
    const rows =
      bucket === "english"
        ? data.intakeTeamEnglish ?? data.intakeTeam ?? []
        : bucket === "spanish"
          ? data.intakeTeamSpanish ?? data.intakeTeam ?? []
          : data.intakeTeam ?? [];
    const dyn = sectionWarnings(data, ["Intake team"]);
    const syncedAbg = data.intakeSyncedAt?.abogado;
    const syncedPplt = data.intakeSyncedAt?.pplt_leads;
    const syncStatus = (() => {
      if (!syncedAbg && !syncedPplt) {
        return "Intake conversation cron (/api/sync/intake) has not run yet — every column will be zero until it does. First fire is up to 4 hours from deploy. Admin can force-trigger by POSTing /api/sync/intake.";
      }
      const fmt = (s: string | null | undefined) =>
        s ? `synced ${timeAgo(s)}` : "not yet";
      return `Intake conversation cron: PPLT ${fmt(syncedPplt)}, Abogado ${fmt(syncedAbg)}.`;
    })();
    const info: string[] = [
      syncStatus,
      "Referrals / Signed attribution: the rep who initiated the action gets credit, defined as the intake user who sent the most recent outbound call/SMS to that contact in the 14 days BEFORE the opp's stage flipped to referred / signed. opp.assignedTo is ignored — this firm's GHL setup doesn't populate it reliably.",
      "Calls Made = every outbound call the rep dialed. Calls Connected = subset that actually picked up (meta.call.status === 'completed' or duration > 0). Pickup rate = Connected / Made. SMS counts every TYPE_SMS + TYPE_CUSTOM_SMS that carried this rep's userId. Inbound calls are NOT in this view because GHL only attaches a userId to ~5% of them (the rest land as unattributed system records).",
    ];
    return (
      <section id="intake">
        <SectionHeader
          title="Intake Team"
          subtitle={`DATE PICKER APPLIES to Referrals + Signed + Calls + SMS columns (window: ${data.range.label}). 30d/7d trend pills are rolling. Active is right-now.`}
        />
        <SectionWarning tone="warn" items={dyn} />
        <SectionWarning tone="info" items={info} />
        <IntakeTeamTable rows={rows} />
      </section>
    );
  }

  function IntakeTeamTable({ rows }: { rows: IntakeMemberMetrics[] }) {
    type Col =
      | "name"
      | "referrals"
      | "signedFromReferrals"
      | "callsOutbound"   // sort by Calls Made
      | "callsAnswered"   // sort by Calls Connected (derived; see getCellValue below)
      | "sms"
      | "avgPickupSeconds"
      | "referrals30"
      | "referrals7"
      | "signed30"
      | "signed7"
      | "activeFromReferrals";

    const { sorted, sortKey, sortDir, onSort } = useSortable<IntakeMemberMetrics, Col>(
      rows,
      "referrals",
      "desc",
      (r, k) => {
        switch (k) {
          case "name":
            return r.name;
          case "referrals30":
            return r.referrals30.current;
          case "referrals7":
            return r.referrals7.current;
          case "signed30":
            return r.signed30.current;
          case "signed7":
            return r.signed7.current;
          case "avgPickupSeconds":
            return r.avgPickupSeconds ?? null;
          default:
            return r[k] as number;
        }
      }
    );

    if (!rows || rows.length === 0) {
      return <EmptyState />;
    }

    return (
      <>
        <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
          <table className="w-full text-sm min-w-[1100px]">
            <thead className="bg-slate-50/60">
              <tr className="border-b border-slate-200">
                <SortHeader label="Member" columnKey="name" activeKey={sortKey} activeDir={sortDir} onSort={onSort} align="left" />
                <SortHeader label="Referrals" columnKey="referrals" activeKey={sortKey} activeDir={sortDir} onSort={onSort} align="right" />
                <SortHeader label="Signed" columnKey="signedFromReferrals" activeKey={sortKey} activeDir={sortDir} onSort={onSort} align="right" />
                <SortHeader label="Calls Made" columnKey="callsOutbound" activeKey={sortKey} activeDir={sortDir} onSort={onSort} align="right" />
                <SortHeader label="Calls Connected" columnKey="callsAnswered" activeKey={sortKey} activeDir={sortDir} onSort={onSort} align="right" />
                <SortHeader label="SMS" columnKey="sms" activeKey={sortKey} activeDir={sortDir} onSort={onSort} align="right" />
                <SortHeader label="Avg call" columnKey="avgPickupSeconds" activeKey={sortKey} activeDir={sortDir} onSort={onSort} align="right" />
                <SortHeader label="Ref 30d" columnKey="referrals30" activeKey={sortKey} activeDir={sortDir} onSort={onSort} align="right" />
                <SortHeader label="Ref 7d" columnKey="referrals7" activeKey={sortKey} activeDir={sortDir} onSort={onSort} align="right" />
                <SortHeader label="Signed 30d" columnKey="signed30" activeKey={sortKey} activeDir={sortDir} onSort={onSort} align="right" />
                <SortHeader label="Signed 7d" columnKey="signed7" activeKey={sortKey} activeDir={sortDir} onSort={onSort} align="right" />
                <SortHeader label="Active" columnKey="activeFromReferrals" activeKey={sortKey} activeDir={sortDir} onSort={onSort} align="right" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((m, i) => (
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
                  <td className="px-4 py-2.5 text-right tabular-nums">{m.callsOutbound.toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-blue-700">{m.callsAnswered.toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{m.sms.toLocaleString()}</td>
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
          Avg call shows mean duration of answered calls in the current range (proxy for pickup time). Calls + SMS are sourced from a separate 4-hourly cron (/api/sync/intake) — lag of up to 4 hours is expected.
        </p>
      </>
    );
  }

  function CasesBlock({ data, bucket }: { data: DashboardData; bucket: Bucket }) {
    const view =
      bucket === "english"
        ? data.casesEnglish ?? data.cases
        : bucket === "spanish"
          ? data.casesSpanish ?? data.cases
          : data.cases;
    // const brokers = view.referralBrokers;  // unused while co-counsel charts are hidden
    const dyn = sectionWarnings(data, ["Case analytics"]);
    const info: string[] = [
      `Date picker filters charts to opps whose LEAD CAME IN during the selected window (currently: ${data.range.label}). Active in-house cases + cases at co-counsel firms come from leads that arrived in the period. By Co-Counsel (Signed) filters by when the stage flipped to signed during the window. Set the picker to "Year to Date" or "Last 90 Days" for a broader view.`,
    ];
    return (
      <section id="cases">
        <SectionHeader
          title="Case Analytics"
          subtitle={`Active in-house cases + signed-by-co-counsel · DATE PICKER APPLIES (leads/signs in ${data.range.label})`}
        />
        <SectionWarning tone="warn" items={dyn} />
        <SectionWarning tone="info" items={info} />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {isSubVisible(data.visibility, "cases", "by_practice_area") && (
            <ChartCard title="By Practice Area">
              <BarCount data={view.byPracticeArea.map((r) => ({ name: r.area, value: r.count }))} />
            </ChartCard>
          )}
          {isSubVisible(data.visibility, "cases", "by_state") && (
            <ChartCard title="By State" subtitle="State (Jurisdiction) field, top 15">
              <BarCount data={view.byState.slice(0, 15).map((r) => ({ name: r.state, value: r.count }))} />
            </ChartCard>
          )}
          {/* Active at Co-Counsel + Signed by Co-Counsel charts removed
              per user request. data.cases.byCoCounsel +
              data.cases.byCoCounselSigned still populate from
              caseAnalytics() so re-enabling is just re-adding the
              JSX. */}
        </div>
      </section>
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
