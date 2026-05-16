/**
 * Tiny client-side CSV export. Generates a Blob, triggers a download.
 * No external dependency — for our row counts (a few hundred max) this
 * is plenty.
 */

export interface CsvColumn<T> {
  header: string;
  /** Value extractor. Return null/undefined for blank cells. */
  get: (row: T) => string | number | null | undefined;
}

function escapeCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}`
  );
}

export function downloadCsv<T>(
  baseFilename: string,
  columns: CsvColumn<T>[],
  rows: T[]
): void {
  const headerLine = columns.map((c) => escapeCell(c.header)).join(",");
  const bodyLines = rows.map((r) =>
    columns.map((c) => escapeCell(c.get(r))).join(",")
  );
  const csv = [headerLine, ...bodyLines].join("\n");
  // Prepend a UTF-8 BOM so Excel auto-detects encoding.
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${baseFilename}-${timestamp()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
