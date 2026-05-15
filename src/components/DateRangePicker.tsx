"use client";

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
    <div className="flex flex-wrap items-center gap-3">
      <label className="text-xs uppercase tracking-wide text-neutral-500 font-medium">
        Range
      </label>
      <select
        value={preset}
        onChange={(e) => onChange(e.target.value as Preset, start, end)}
        className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
      >
        {PRESETS.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </select>
      {preset === "custom" && (
        <>
          <input
            type="date"
            value={start}
            onChange={(e) => onChange("custom", e.target.value, end)}
            className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm"
          />
          <span className="text-neutral-400 text-sm">to</span>
          <input
            type="date"
            value={end}
            onChange={(e) => onChange("custom", start, e.target.value)}
            className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm"
          />
        </>
      )}
    </div>
  );
}
