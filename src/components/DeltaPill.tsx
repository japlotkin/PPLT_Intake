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
      ? "text-emerald-700 bg-emerald-50"
      : stat.direction === "down"
        ? "text-rose-700 bg-rose-50"
        : "text-neutral-600 bg-neutral-100";
  const pct =
    stat.pctChange === null
      ? "new"
      : stat.pctChange === 0
        ? "0%"
        : `${stat.pctChange > 0 ? "+" : ""}${stat.pctChange.toFixed(1)}%`;
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full ${tone}`}
    >
      <Icon className="h-3.5 w-3.5" />
      {pct}
      {suffix && <span className="text-neutral-500 font-normal">{suffix}</span>}
    </span>
  );
}
