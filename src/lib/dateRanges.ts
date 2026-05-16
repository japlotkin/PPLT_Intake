/**
 * Date range presets. All ranges operate in America/New_York (the firm's TZ).
 *
 * Convention: ranges are half-open [start, end). `start` is inclusive,
 * `end` is the next instant after the range (e.g. end of "This Week" is
 * the following Monday 00:00 ET).
 *
 * Weeks are Monday–Sunday (per spec).
 */
import {
  addDays,
  addMonths,
  addQuarters,
  endOfDay,
  startOfDay,
  startOfMonth,
  startOfQuarter,
  startOfYear,
  subDays,
  subMonths,
  subQuarters,
  subWeeks,
} from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";

const TZ = "America/New_York";

/** Today in the firm's TZ as a "local" Date object (still UTC under the hood). */
function nowLocal(now = new Date()): Date {
  return toZonedTime(now, TZ);
}

/** Convert a "local" Date back to a real UTC instant for API calls. */
function toUtc(local: Date): Date {
  return fromZonedTime(local, TZ);
}

/** Start of week (Monday) in the firm's TZ. */
function startOfWeekMon(local: Date): Date {
  const d = startOfDay(local);
  // 0=Sun,1=Mon,…,6=Sat -> shift Sun to -6, otherwise (day-1)
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(d, diff);
}

export type Preset =
  | "today"
  | "yesterday"
  | "this_week"
  | "last_week"
  | "this_month"
  | "last_month"
  | "this_quarter"
  | "last_quarter"
  | "ytd"
  | "last_7_days"
  | "last_30_days"
  | "last_90_days"
  | "custom";

export interface Range {
  start: Date;
  end: Date;
  label: string;
}

export function rangeFor(preset: Preset, now = new Date()): Range {
  const local = nowLocal(now);
  switch (preset) {
    case "today": {
      const s = startOfDay(local);
      return { start: toUtc(s), end: toUtc(addDays(s, 1)), label: "Today" };
    }
    case "yesterday": {
      const s = subDays(startOfDay(local), 1);
      return { start: toUtc(s), end: toUtc(addDays(s, 1)), label: "Yesterday" };
    }
    case "this_week": {
      const s = startOfWeekMon(local);
      return { start: toUtc(s), end: toUtc(addDays(s, 7)), label: "This Week" };
    }
    case "last_week": {
      const s = subWeeks(startOfWeekMon(local), 1);
      return { start: toUtc(s), end: toUtc(addDays(s, 7)), label: "Last Week" };
    }
    case "this_month": {
      const s = startOfMonth(local);
      return {
        start: toUtc(s),
        end: toUtc(startOfMonth(addMonths(s, 1))),
        label: "This Month",
      };
    }
    case "last_month": {
      const cur = startOfMonth(local);
      const s = subMonths(cur, 1);
      return { start: toUtc(s), end: toUtc(cur), label: "Last Month" };
    }
    case "this_quarter": {
      const s = startOfQuarter(local);
      return {
        start: toUtc(s),
        end: toUtc(startOfQuarter(addQuarters(s, 1))),
        label: "This Quarter",
      };
    }
    case "last_quarter": {
      const cur = startOfQuarter(local);
      const s = subQuarters(cur, 1);
      return { start: toUtc(s), end: toUtc(cur), label: "Last Quarter" };
    }
    case "ytd": {
      const s = startOfYear(local);
      return {
        start: toUtc(s),
        end: toUtc(endOfDay(local)),
        label: "Year to Date",
      };
    }
    case "last_7_days": {
      const e = startOfDay(addDays(local, 1));
      return { start: toUtc(subDays(e, 7)), end: toUtc(e), label: "Last 7 Days" };
    }
    case "last_30_days": {
      const e = startOfDay(addDays(local, 1));
      return { start: toUtc(subDays(e, 30)), end: toUtc(e), label: "Last 30 Days" };
    }
    case "last_90_days": {
      const e = startOfDay(addDays(local, 1));
      return { start: toUtc(subDays(e, 90)), end: toUtc(e), label: "Last 90 Days" };
    }
    case "custom":
      throw new Error("custom preset requires explicit start/end");
  }
}

/** Build a custom range from ISO date strings (YYYY-MM-DD, inclusive both sides). */
export function customRange(startISO: string, endISO: string): Range {
  const startLocal = startOfDay(toZonedTime(new Date(startISO + "T00:00:00"), TZ));
  const endLocal = addDays(
    startOfDay(toZonedTime(new Date(endISO + "T00:00:00"), TZ)),
    1
  );
  return {
    start: toUtc(startLocal),
    end: toUtc(endLocal),
    label: `${startISO} → ${endISO}`,
  };
}

/** Previous-period range (same width, immediately before this range). */
export function previousPeriod(r: Range): Range {
  const widthMs = r.end.getTime() - r.start.getTime();
  const start = new Date(r.start.getTime() - widthMs);
  const end = new Date(r.start.getTime());
  return { start, end, label: `prev ${r.label}` };
}

/** All preset choices with display labels, in the order shown in the picker. */
export const PRESETS: { value: Preset; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "this_week", label: "This Week" },
  { value: "last_week", label: "Last Week" },
  { value: "this_month", label: "This Month" },
  { value: "last_month", label: "Last Month" },
  { value: "this_quarter", label: "This Quarter" },
  { value: "last_quarter", label: "Last Quarter" },
  { value: "ytd", label: "Year to Date" },
  { value: "last_7_days", label: "Last 7 Days" },
  { value: "last_30_days", label: "Last 30 Days" },
  { value: "last_90_days", label: "Last 90 Days" },
  { value: "custom", label: "Custom range" },
];

/**
 * KPI table months -- current month + the previous one only.
 * Older history is in the dedicated "Export Historical KPIs" admin CSV.
 */
export function monthsThisYear(now = new Date()): Range[] {
  const local = nowLocal(now);
  const out: Range[] = [];
  for (let offset = 1; offset >= 0; offset--) {
    const m = startOfMonth(subMonths(local, offset));
    const next = startOfMonth(addMonths(m, 1));
    out.push({
      start: toUtc(m),
      end: toUtc(next),
      label: m.toLocaleString("en-US", { month: "short", year: "numeric" }),
    });
  }
  return out;
}

/** KPI table quarters -- current + previous. */
export function quartersThisYear(now = new Date()): Range[] {
  const local = nowLocal(now);
  const out: Range[] = [];
  for (let offset = 1; offset >= 0; offset--) {
    const q = startOfQuarter(subQuarters(local, offset));
    const next = startOfQuarter(addQuarters(q, 1));
    const qNum = Math.floor(q.getMonth() / 3) + 1;
    out.push({
      start: toUtc(q),
      end: toUtc(next),
      label: `Q${qNum} ${q.getFullYear()}`,
    });
  }
  return out;
}

export const FIRM_TZ = TZ;
