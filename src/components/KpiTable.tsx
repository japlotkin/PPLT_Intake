"use client";

import type { KpiBlock } from "@/lib/types";
import { parseSortable, SortHeader, useSortable } from "./sortable";

type KpiCol = "label" | "spanish" | "english" | "total";

export function KpiTable({ block }: { block: KpiBlock }) {
  const { sorted, sortKey, sortDir, onSort } = useSortable<typeof block.rows[number], KpiCol>(
    block.rows,
    null,
    "desc",
    (r, k) => (k === "label" ? r.label : parseSortable(r[k]))
  );

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/60 flex items-center justify-between">
        <div className="text-sm font-semibold tracking-tight text-slate-900">
          {block.title}
        </div>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-slate-50/40">
          <tr className="border-b border-slate-200">
            <SortHeader label="Metric" columnKey="label" activeKey={sortKey} activeDir={sortDir} onSort={onSort} align="left" className="px-4" />
            <SortHeader label="Spanish" columnKey="spanish" activeKey={sortKey} activeDir={sortDir} onSort={onSort} align="right" className="px-4" />
            <SortHeader label="English" columnKey="english" activeKey={sortKey} activeDir={sortDir} onSort={onSort} align="right" className="px-4" />
            <SortHeader label="Total" columnKey="total" activeKey={sortKey} activeDir={sortDir} onSort={onSort} align="right" className="px-4" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr
              key={i}
              className="border-t border-slate-100 hover:bg-slate-50/60 transition-colors"
            >
              <td className="px-4 py-2.5 font-medium text-slate-800">{r.label}</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{r.spanish}</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{r.english}</td>
              <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-slate-900">
                {r.total}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
