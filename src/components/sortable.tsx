"use client";

import { useCallback, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

export type SortDir = "asc" | "desc";

/**
 * Generic sort hook. Pass rows + the initial sort key/direction; get back
 * the sorted rows, the active key/dir, and an onSort handler that flips
 * direction on re-click.
 *
 * `getValue(row, key)` lets the caller decide how to extract the sortable
 * value for a given column — handy for tables whose cells are formatted
 * strings ($1,234 / 29.5% / "Apr 2026") that need parsing back to numbers.
 */
export function useSortable<T, K extends string>(
  rows: T[],
  initialKey: K | null,
  initialDir: SortDir = "desc",
  getValue: (row: T, key: K) => string | number | null | undefined = (r, k) =>
    (r as unknown as Record<string, unknown>)[k] as string | number | null | undefined
) {
  const [key, setKey] = useState<K | null>(initialKey);
  const [dir, setDir] = useState<SortDir>(initialDir);

  const sorted = useMemo(() => {
    if (!key) return rows;
    const cp = [...rows];
    cp.sort((a, b) => {
      const av = getValue(a, key);
      const bv = getValue(b, key);
      const aNull = av === null || av === undefined || av === "";
      const bNull = bv === null || bv === undefined || bv === "";
      if (aNull && bNull) return 0;
      if (aNull) return 1;
      if (bNull) return -1;
      if (typeof av === "number" && typeof bv === "number") {
        return dir === "asc" ? av - bv : bv - av;
      }
      const as = String(av);
      const bs = String(bv);
      return dir === "asc"
        ? as.localeCompare(bs, undefined, { numeric: true })
        : bs.localeCompare(as, undefined, { numeric: true });
    });
    return cp;
  }, [rows, key, dir, getValue]);

  const onSort = useCallback(
    (next: K) => {
      if (key === next) {
        setDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setKey(next);
        setDir("desc");
      }
    },
    [key]
  );

  return { sorted, sortKey: key, sortDir: dir, onSort };
}

/** Parse a formatted display string back to a number for sorting. */
export function parseSortable(v: string | number | null | undefined): number {
  if (v === null || v === undefined) return -Infinity;
  if (typeof v === "number") return v;
  const cleaned = v.replace(/[$%,\s]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : -Infinity;
}

/** Render a <th> that sorts the table when clicked. */
export function SortHeader<K extends string>({
  label,
  columnKey,
  activeKey,
  activeDir,
  onSort,
  align = "left",
  className = "",
}: {
  label: React.ReactNode;
  columnKey: K;
  activeKey: K | null;
  activeDir: SortDir;
  onSort: (key: K) => void;
  align?: "left" | "right";
  className?: string;
}) {
  const active = activeKey === columnKey;
  const Icon = active ? (activeDir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  const justify = align === "right" ? "justify-end" : "justify-start";
  return (
    <th className={`${align === "right" ? "text-right" : "text-left"} px-4 py-2.5 font-semibold ${className}`}>
      <button
        type="button"
        onClick={() => onSort(columnKey)}
        className={`group inline-flex items-center gap-1 ${justify} w-full font-semibold uppercase tracking-wider text-[11px] ${
          active ? "text-blue-700" : "text-slate-500"
        } hover:text-slate-900 transition`}
      >
        <span>{label}</span>
        <Icon
          className={`h-3 w-3 ${active ? "opacity-100" : "opacity-30 group-hover:opacity-60"}`}
        />
      </button>
    </th>
  );
}
