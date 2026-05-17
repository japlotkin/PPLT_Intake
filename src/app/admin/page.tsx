"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Sparkles, Save, Loader2, Lock, ArrowLeft, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import {
  SECTION_IDS,
  SECTION_LABELS,
  SUBSECTION_LABELS,
  SUBSECTIONS_BY_SECTION,
  ROLE_PRESETS,
  ROLE_LABELS,
  type SectionId,
  type Role,
} from "@/lib/visibility";

interface UserRow {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  isAdmin: boolean;
  hasConfig: boolean;
  hiddenSectionCount: number;
  hiddenSubsectionCount: number;
}

interface ConfigShape {
  email: string;
  role?: Role;
  hiddenSections: SectionId[];
  hiddenSubsections: string[];
  restrictIntakeToOwnRow?: boolean;
  updatedAt: string;
  updatedBy: string;
}

export default function AdminPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [usersLoading, setUsersLoading] = useState(true);

  const [selectedEmail, setSelectedEmail] = useState<string | null>(null);
  const [config, setConfig] = useState<ConfigShape | null>(null);
  const [configLoading, setConfigLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    setUsersLoading(true);
    setUsersError(null);
    try {
      const res = await fetch("/api/admin/users");
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `Failed: ${res.status}`);
      }
      const j = (await res.json()) as { users: UserRow[] };
      setUsers(j.users);
    } catch (e) {
      setUsersError(e instanceof Error ? e.message : String(e));
    } finally {
      setUsersLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const loadConfig = useCallback(async (email: string) => {
    setConfigLoading(true);
    setSavedAt(null);
    try {
      const res = await fetch(`/api/admin/visibility?email=${encodeURIComponent(email)}`);
      const j = (await res.json()) as { config: ConfigShape };
      setConfig(j.config);
    } catch {
      setConfig({
        email,
        role: undefined,
        hiddenSections: [],
        hiddenSubsections: [],
        restrictIntakeToOwnRow: false,
        updatedAt: "",
        updatedBy: "",
      });
    } finally {
      setConfigLoading(false);
    }
  }, []);

  function pickUser(email: string) {
    setSelectedEmail(email);
    loadConfig(email);
  }

  function toggleSection(s: SectionId) {
    if (!config) return;
    const has = config.hiddenSections.includes(s);
    setConfig({
      ...config,
      // Manual toggle implies Custom tier going forward.
      role: "custom",
      hiddenSections: has
        ? config.hiddenSections.filter((x) => x !== s)
        : [...config.hiddenSections, s],
    });
  }

  function applyRolePreset(role: Role) {
    if (!config) return;
    if (role === "custom") {
      setConfig({ ...config, role: "custom" });
      return;
    }
    const preset = ROLE_PRESETS[role];
    setConfig({
      ...config,
      role,
      hiddenSections: [...preset.hiddenSections],
      hiddenSubsections: [...preset.hiddenSubsections],
      restrictIntakeToOwnRow: preset.restrictIntakeToOwnRow,
    });
  }

  function toggleOwnRow() {
    if (!config) return;
    setConfig({
      ...config,
      role: "custom",
      restrictIntakeToOwnRow: !config.restrictIntakeToOwnRow,
    });
  }

  function toggleSubsection(s: SectionId, sub: string) {
    if (!config) return;
    const key = `${s}.${sub}`;
    const has = config.hiddenSubsections.includes(key);
    setConfig({
      ...config,
      role: "custom",
      hiddenSubsections: has
        ? config.hiddenSubsections.filter((x) => x !== key)
        : [...config.hiddenSubsections, key],
    });
  }

  async function save() {
    if (!config) return;
    setSaving(true);
    setSavedAt(null);
    try {
      const res = await fetch("/api/admin/visibility", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: config.email,
          role: config.role,
          hiddenSections: config.hiddenSections,
          hiddenSubsections: config.hiddenSubsections,
          restrictIntakeToOwnRow: Boolean(config.restrictIntakeToOwnRow),
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `Save failed: ${res.status}`);
      }
      setSavedAt(new Date().toISOString());
      // refresh user list so the count badges update
      loadUsers();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const selectedUser = useMemo(
    () => users.find((u) => u.email.toLowerCase() === (selectedEmail ?? "").toLowerCase()),
    [users, selectedEmail]
  );

  return (
    <div className="min-h-screen bg-slate-50/50">
      <header className="border-b border-slate-200 bg-white/85 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-[1400px] mx-auto px-6 py-3.5 flex flex-wrap items-center gap-4 justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 text-white shadow-[0_1px_2px_rgba(37,99,235,0.4)]">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <h1 className="text-[15px] font-semibold tracking-tight text-slate-900 flex items-center gap-2">
                Admin · Section Visibility
                <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 text-[10px] font-semibold uppercase tracking-wider ring-1 ring-inset ring-blue-200">
                  Admin
                </span>
              </h1>
              <p className="text-[11px] text-slate-500">
                Pinder Plotkin Legal Team · Abogado Attorney
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 hover:text-blue-700 hover:border-blue-200 transition"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to dashboard
            </Link>
            <UserButton />
          </div>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
        <aside className="rounded-xl border border-slate-200 bg-white overflow-hidden h-fit">
          <div className="px-4 py-3 border-b border-slate-200">
            <div className="text-sm font-semibold text-slate-900">Users</div>
            <div className="text-xs text-slate-500">Pick a user to edit</div>
          </div>
          {usersLoading && (
            <div className="px-4 py-6 text-sm text-slate-500 flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          )}
          {usersError && (
            <div className="px-4 py-3 text-sm text-rose-700 bg-rose-50">{usersError}</div>
          )}
          <ul>
            {users.map((u) => {
              const active = u.email.toLowerCase() === (selectedEmail ?? "").toLowerCase();
              return (
                <li key={u.id}>
                  <button
                    onClick={() => !u.isAdmin && pickUser(u.email)}
                    disabled={u.isAdmin}
                    className={`w-full text-left px-4 py-3 border-b border-slate-100 transition flex items-start gap-3 ${
                      active
                        ? "bg-blue-50"
                        : u.isAdmin
                          ? "opacity-60 cursor-not-allowed"
                          : "hover:bg-slate-50"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-slate-900 truncate flex items-center gap-1.5">
                        {(u.firstName + " " + u.lastName).trim() || u.email}
                        {u.isAdmin && (
                          <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-amber-700 bg-amber-50 ring-1 ring-amber-200 px-1.5 py-0.5 rounded">
                            <Lock className="h-2.5 w-2.5" /> Admin
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500 truncate">{u.email}</div>
                      {!u.isAdmin && u.hasConfig && (
                        <div className="text-[11px] text-blue-700 mt-1">
                          {u.hiddenSectionCount} section
                          {u.hiddenSectionCount === 1 ? "" : "s"} hidden ·{" "}
                          {u.hiddenSubsectionCount} subsection
                          {u.hiddenSubsectionCount === 1 ? "" : "s"} hidden
                        </div>
                      )}
                      {!u.isAdmin && !u.hasConfig && (
                        <div className="text-[11px] text-slate-400 mt-1">Sees everything</div>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        <section>
          {!selectedEmail && (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white/40 px-6 py-12 text-center text-sm text-slate-500">
              Pick a user from the list to set what they can see.
            </div>
          )}
          {selectedEmail && configLoading && (
            <div className="rounded-xl border border-slate-200 bg-white px-6 py-12 text-center text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
              Loading {selectedEmail}…
            </div>
          )}
          {selectedEmail && !configLoading && config && (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900">
                    {selectedUser
                      ? `${(selectedUser.firstName + " " + selectedUser.lastName).trim() || selectedUser.email}`
                      : selectedEmail}
                  </div>
                  <div className="text-[11px] text-slate-500">{selectedEmail}</div>
                </div>
                <div className="flex items-center gap-2">
                  {savedAt && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700 bg-emerald-50 ring-1 ring-emerald-200 px-2 py-1 rounded">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Saved
                    </span>
                  )}
                  <button
                    onClick={save}
                    disabled={saving}
                    className="inline-flex items-center gap-2 rounded-lg bg-blue-600 text-white px-3 py-1.5 text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition shadow-[0_1px_2px_rgba(37,99,235,0.3)]"
                  >
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Save
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                <div className="px-5 py-3 border-b border-slate-200 bg-slate-50/60 flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold">
                      Role preset
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Picking a tier sets the toggles below. You can manually
                      override any toggle (the role label becomes &quot;Custom&quot;).
                    </div>
                  </div>
                  <select
                    value={config.role ?? "custom"}
                    onChange={(e) => applyRolePreset(e.target.value as Role)}
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="custom">{ROLE_LABELS.custom}</option>
                    <option value="manager">{ROLE_LABELS.manager}</option>
                    <option value="staff">{ROLE_LABELS.staff}</option>
                  </select>
                </div>
                <div className="px-5 py-3 border-b border-slate-200 bg-slate-50/30">
                  <label className="flex items-center justify-between gap-3 cursor-pointer">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">
                        Restrict Intake Team to user&apos;s own row only
                      </div>
                      <div className="text-[11px] text-slate-500">
                        When on, the user sees only their own intake activity, not their peers&apos;.
                        Server-side filter; peer numbers never reach the browser.
                      </div>
                    </div>
                    <Switch
                      checked={Boolean(config.restrictIntakeToOwnRow)}
                      onChange={toggleOwnRow}
                    />
                  </label>
                </div>
                <div className="px-5 py-3 border-b border-slate-200 bg-slate-50/60 text-xs uppercase tracking-wider text-slate-500 font-semibold">
                  Toggle off any section or subsection to hide it from this user.
                </div>
                <div className="divide-y divide-slate-100">
                  {SECTION_IDS.map((sec) => {
                    const sectionHidden = config.hiddenSections.includes(sec);
                    const subs = SUBSECTIONS_BY_SECTION[sec];
                    return (
                      <div key={sec} className="px-5 py-4">
                        <label className="flex items-center justify-between gap-3 cursor-pointer">
                          <div>
                            <div className="text-sm font-semibold text-slate-900">
                              {SECTION_LABELS[sec]}
                            </div>
                            <div className="text-[11px] text-slate-500">
                              {sectionHidden ? "Hidden from user" : "Visible to user"}
                            </div>
                          </div>
                          <Switch
                            checked={!sectionHidden}
                            onChange={() => toggleSection(sec)}
                          />
                        </label>
                        {subs.length > 0 && !sectionHidden && (
                          <div className="mt-3 ml-1 pl-4 border-l-2 border-slate-100 space-y-2">
                            {subs.map((sub) => {
                              const key = `${sec}.${sub}`;
                              const subHidden = config.hiddenSubsections.includes(key);
                              return (
                                <label
                                  key={key}
                                  className="flex items-center justify-between gap-3 cursor-pointer"
                                >
                                  <span className="text-xs text-slate-700">
                                    {SUBSECTION_LABELS[key] ?? sub}
                                  </span>
                                  <Switch
                                    checked={!subHidden}
                                    onChange={() => toggleSubsection(sec, sub)}
                                  />
                                </label>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {config.updatedAt && (
                <p className="text-[11px] text-slate-400">
                  Last updated {new Date(config.updatedAt).toLocaleString()} by {config.updatedBy}
                </p>
              )}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function Switch({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition ${
        checked ? "bg-blue-600" : "bg-slate-300"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition translate-y-0.5 ${
          checked ? "translate-x-4" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}
