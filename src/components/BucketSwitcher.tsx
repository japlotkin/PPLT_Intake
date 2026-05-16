"use client";

import { ChevronDown, Globe2, Languages } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export type Bucket = "combined" | "english" | "spanish";

const OPTIONS: Array<{
  id: Bucket;
  label: string;
  sub: string;
  // Use distinct color stops so the swatch reads at a glance.
  accent: string;
}> = [
  { id: "combined", label: "Combined", sub: "English + Spanish", accent: "from-blue-500 to-blue-700" },
  { id: "english", label: "English", sub: "PPLT", accent: "from-emerald-500 to-emerald-700" },
  { id: "spanish", label: "Spanish", sub: "Abogado", accent: "from-rose-500 to-rose-700" },
];

function Icon({ bucket }: { bucket: Bucket }) {
  if (bucket === "combined") return <Globe2 className="h-3.5 w-3.5" />;
  return <Languages className="h-3.5 w-3.5" />;
}

export function BucketSwitcher({
  value,
  onChange,
}: {
  value: Bucket;
  onChange: (b: Bucket) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const cur = OPTIONS.find((o) => o.id === value) ?? OPTIONS[0];

  return (
    <div ref={ref} className="relative w-full">
      <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold px-1 mb-1.5">
        Book
      </div>
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        className={`w-full flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left transition hover:border-slate-300 ${
          open ? "ring-2 ring-blue-500/30 border-blue-300" : ""
        }`}
      >
        <span className="flex items-center gap-2 min-w-0">
          <span
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-gradient-to-br ${cur.accent} text-white`}
          >
            <Icon bucket={cur.id} />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-slate-900 truncate">
              {cur.label}
            </span>
            <span className="block text-[10px] uppercase tracking-wider text-slate-400">
              {cur.sub}
            </span>
          </span>
        </span>
        <ChevronDown
          className={`h-4 w-4 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="absolute z-40 mt-1 left-0 right-0 rounded-lg border border-slate-200 bg-white shadow-[0_4px_12px_rgba(15,23,42,0.08)] py-1">
          {OPTIONS.map((o) => {
            const active = o.id === value;
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => {
                  onChange(o.id);
                  setOpen(false);
                }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-slate-50 transition ${
                  active ? "bg-blue-50/60" : ""
                }`}
              >
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-gradient-to-br ${o.accent} text-white`}
                >
                  <Icon bucket={o.id} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-slate-900">{o.label}</span>
                  <span className="block text-[10px] uppercase tracking-wider text-slate-400">
                    {o.sub}
                  </span>
                </span>
                {active && (
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-blue-700">
                    ✓
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
