"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Sparkles, Lock } from "lucide-react";

function GateForm() {
  const router = useRouter();
  const search = useSearchParams();
  const next = search.get("next") || "/dashboard";
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/gate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        router.push(next);
      } else {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? "Incorrect password");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="w-full max-w-sm bg-white rounded-2xl border border-slate-200 p-8 space-y-6 shadow-[0_1px_3px_rgba(15,23,42,0.04)]"
    >
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 text-white shadow-[0_2px_8px_rgba(37,99,235,0.35)]">
          <Sparkles className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-slate-900">
            Pinder Plotkin Legal Team
          </h1>
          <p className="text-xs text-slate-500">Internal intake dashboard</p>
        </div>
      </div>
      <div>
        <label className="text-xs font-semibold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
          <Lock className="h-3 w-3" />
          Firm password
        </label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          required
          className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 transition"
        />
        {error && (
          <p className="mt-2 text-sm text-rose-600" role="alert">
            {error}
          </p>
        )}
      </div>
      <button
        type="submit"
        disabled={submitting || password.length === 0}
        className="w-full rounded-lg bg-blue-600 text-white py-2.5 text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition shadow-[0_1px_2px_rgba(37,99,235,0.3)]"
      >
        {submitting ? "Verifying…" : "Continue"}
      </button>
      <p className="text-[11px] text-slate-400 leading-relaxed">
        Authorized staff only. After the firm password, log in with your
        individual account.
      </p>
    </form>
  );
}

export default function GatePage() {
  return (
    <main className="min-h-screen flex items-center justify-center px-6 bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-50">
      <Suspense fallback={<div className="text-sm text-slate-500">Loading…</div>}>
        <GateForm />
      </Suspense>
    </main>
  );
}
