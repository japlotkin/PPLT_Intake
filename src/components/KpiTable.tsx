import type { KpiBlock } from "@/lib/types";

export function KpiTable({ block }: { block: KpiBlock }) {
  return (
    <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-neutral-200 text-sm font-semibold">
        {block.title}
      </div>
      <table className="w-full text-sm">
        <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
          <tr>
            <th className="text-left px-5 py-2 font-medium">Metric</th>
            <th className="text-right px-5 py-2 font-medium">Spanish</th>
            <th className="text-right px-5 py-2 font-medium">English</th>
            <th className="text-right px-5 py-2 font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {block.rows.map((r, i) => (
            <tr key={i} className="border-t border-neutral-100">
              <td className="px-5 py-2 font-medium text-neutral-800">{r.label}</td>
              <td className="px-5 py-2 text-right tabular-nums">{r.spanish}</td>
              <td className="px-5 py-2 text-right tabular-nums">{r.english}</td>
              <td className="px-5 py-2 text-right tabular-nums font-semibold">{r.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
