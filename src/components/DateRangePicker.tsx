"use client";

import { CalendarRange } from "lucide-react";
import { PRESETS, type Preset } from "@/lib/dateRanges";

export function DateRangePicker({
  preset,
  start,
  end,
  onChange,
}: {
  preset: Preset;
  start: string;
  end: string;
  onChange: (preset: Preset, start: string, end: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm">
        <CalendarRange className="h-4 w-4 text-slate-500" />
        <select
          value={preset}
          onChange={(e) => onChange(e.target.value as Preset, start, end)}
          className="bg-transparent focus:outline-none text-slate-800 font-medium pr-1"
        >
          {PRESETS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
      {preset === "custom" && (
        <>
          <input
            type="date"
            value={start}
            onChange={(e) => onChange("custom", e.target.value, end)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40"
          />
          <span className="text-slate-400 text-sm">→</span>
          <input
            type="date"
            value={end}
            onChange={(e) => onChange("custom", start, e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40"
          />
        </>
      )}
    </div>
  );
}
