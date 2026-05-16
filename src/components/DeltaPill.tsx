import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import type { DeltaStat } from "@/lib/types";

export function DeltaPill({ stat, suffix = "" }: { stat: DeltaStat; suffix?: string }) {
  const Icon =
    stat.direction === "up"
      ? ArrowUpRight
      : stat.direction === "down"
        ? ArrowDownRight
        : ArrowRight;
  const tone =
    stat.direction === "up"
      ? "text-emerald-700 bg-emerald-50 ring-emerald-600/20"
      : stat.direction === "down"
        ? "text-rose-700 bg-rose-50 ring-rose-600/20"
        : "text-slate-600 bg-slate-100 ring-slate-400/20";
  const pct =
    stat.pctChange === null
      ? "new"
      : stat.pctChange === 0
        ? "0%"
        : `${stat.pctChange > 0 ? "+" : ""}${stat.pctChange.toFixed(1)}%`;
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-md ring-1 ring-inset ${tone}`}
    >
      <Icon className="h-3.5 w-3.5" />
      {pct}
      {suffix && <span className="text-slate-500 font-normal">{suffix}</span>}
    </span>
  );
}
