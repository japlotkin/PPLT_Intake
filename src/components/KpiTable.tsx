import type { KpiBlock } from "@/lib/types";

export function KpiTable({ block }: { block: KpiBlock }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-200 bg-slate-50/60 flex items-center justify-between">
        <div className="text-sm font-semibold tracking-tight text-slate-900">
          {block.title}
        </div>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-slate-50/40 text-[11px] uppercase tracking-wider text-slate-500">
          <tr className="border-b border-slate-200">
            <th className="text-left px-5 py-2.5 font-semibold">Metric</th>
            <th className="text-right px-5 py-2.5 font-semibold">Spanish</th>
            <th className="text-right px-5 py-2.5 font-semibold">English</th>
            <th className="text-right px-5 py-2.5 font-semibold text-blue-700">Total</th>
          </tr>
        </thead>
        <tbody>
          {block.rows.map((r, i) => (
            <tr
              key={i}
              className="border-t border-slate-100 hover:bg-slate-50/60 transition-colors"
            >
              <td className="px-5 py-2.5 font-medium text-slate-800">{r.label}</td>
              <td className="px-5 py-2.5 text-right tabular-nums text-slate-700">{r.spanish}</td>
              <td className="px-5 py-2.5 text-right tabular-nums text-slate-700">{r.english}</td>
              <td className="px-5 py-2.5 text-right tabular-nums font-semibold text-slate-900">
                {r.total}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
