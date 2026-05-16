import type { LucideIcon } from "lucide-react";
import { DeltaPill } from "./DeltaPill";
import type { DeltaStat } from "@/lib/types";

export function StatCard({
  label,
  value,
  sub,
  delta,
  icon: Icon,
  accent = "primary",
}: {
  label: string;
  value: string | number;
  sub?: string;
  delta?: DeltaStat;
  icon?: LucideIcon;
  accent?: "primary" | "neutral";
}) {
  const iconWrap =
    accent === "primary"
      ? "bg-blue-50 text-blue-600 ring-1 ring-blue-100"
      : "bg-slate-100 text-slate-600 ring-1 ring-slate-200";
  return (
    <div className="group relative rounded-xl border border-slate-200 bg-white p-5 transition hover:border-slate-300 hover:shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          {Icon && (
            <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${iconWrap}`}>
              <Icon className="h-4 w-4" />
            </span>
          )}
          <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold truncate">
            {label}
          </div>
        </div>
        {delta && <DeltaPill stat={delta} />}
      </div>
      <div className="mt-3 text-[28px] leading-tight font-semibold tabular-nums text-slate-900">
        {value}
      </div>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}
