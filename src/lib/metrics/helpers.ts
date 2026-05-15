/**
 * Small helpers shared across metric calculators.
 */
import type { DeltaStat } from "../types";

export function delta(current: number, previous: number): DeltaStat {
  let pctChange: number | null = null;
  if (previous !== 0) pctChange = ((current - previous) / previous) * 100;
  else if (current !== 0) pctChange = null;
  else pctChange = 0;
  const direction: DeltaStat["direction"] =
    current > previous ? "up" : current < previous ? "down" : "flat";
  return { current, previous, pctChange, direction };
}

export function pct(num: number, denom: number): number {
  if (denom === 0) return 0;
  return (num / denom) * 100;
}

export function sortDescByCount<T extends { count: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => b.count - a.count);
}
