import { DeltaPill } from "./DeltaPill";
import type { DeltaStat } from "@/lib/types";

export function StatCard({
  label,
  value,
  sub,
  delta,
}: {
  label: string;
  value: string | number;
  sub?: string;
  delta?: DeltaStat;
}) {
  return (
    <div className="bg-white border border-neutral-200 rounded-xl p-5 flex flex-col gap-2">
      <div className="text-xs uppercase tracking-wide text-neutral-500 font-medium">
        {label}
      </div>
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-3xl font-semibold tabular-nums">{value}</div>
        {delta && <DeltaPill stat={delta} />}
      </div>
      {sub && <div className="text-xs text-neutral-500">{sub}</div>}
    </div>
  );
}
