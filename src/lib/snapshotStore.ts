/**
 * Persistent snapshot store for the dashboard payload.
 *
 * One snapshot per date-range preset. Range-independent sections
 * (Overview, KPI, Cases) are still recomputed for each preset but only
 * hit GHL once thanks to the per-process memo on streamOpportunities
 * and streamContacts -- so storing multiple snapshots costs storage,
 * not many extra API calls.
 *
 * The dashboard reads the snapshot matching the user's date picker.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { kv } from "@vercel/kv";
import { env } from "./env";
import type { DashboardData } from "./types";

const SNAPSHOT_PREFIX = "dash:snapshot:v3:";
const SNAPSHOT_TTL_SECONDS = 25 * 60 * 60; // 25 hours

function keyFor(preset: string): string {
  return `${SNAPSHOT_PREFIX}${preset}`;
}
function devPath(preset: string): string {
  return path.join(os.tmpdir(), `pplt-intake-snapshot-${preset}.json`);
}

/** Presets the sync pre-computes and stores. The date picker can pick any of these. */
export const SYNCED_PRESETS = [
  "this_month",
  "last_month",
  "this_week",
  "last_week",
  "last_7_days",
  "last_30_days",
  "this_quarter",
  "last_quarter",
] as const;

export type SyncedPreset = (typeof SYNCED_PRESETS)[number];

const IS_VERCEL = Boolean(process.env.VERCEL);

export class SnapshotStoreNotConfiguredError extends Error {
  constructor() {
    super(
      "Snapshot store not configured: provision Upstash for Redis via Vercel " +
        "Marketplace and connect it to this project. The KV_REST_API_URL and " +
        "KV_REST_API_TOKEN env vars will be auto-injected. After that, click " +
        "Refresh to run the first sync."
    );
    this.name = "SnapshotStoreNotConfiguredError";
  }
}

export interface SnapshotEnvelope {
  data: DashboardData;
  syncedAt: string;
  durationMs: number;
}

export async function readSnapshot(preset: string): Promise<SnapshotEnvelope | null> {
  if (env.kv.enabled()) {
    const v = await kv.get<SnapshotEnvelope>(keyFor(preset));
    if (v) return v;
    // Fallback: if the requested preset isn't pre-synced, try the default.
    if (preset !== "this_month") {
      return ((await kv.get<SnapshotEnvelope>(keyFor("this_month"))) ?? null);
    }
    return null;
  }
  if (IS_VERCEL) return null;
  try {
    const raw = await fs.readFile(devPath(preset), "utf-8");
    return JSON.parse(raw) as SnapshotEnvelope;
  } catch {
    try {
      const raw = await fs.readFile(devPath("this_month"), "utf-8");
      return JSON.parse(raw) as SnapshotEnvelope;
    } catch {
      return null;
    }
  }
}

export async function writeSnapshot(preset: string, envelope: SnapshotEnvelope): Promise<void> {
  if (env.kv.enabled()) {
    await kv.set(keyFor(preset), envelope, { ex: SNAPSHOT_TTL_SECONDS });
    return;
  }
  if (IS_VERCEL) {
    throw new SnapshotStoreNotConfiguredError();
  }
  await fs.writeFile(devPath(preset), JSON.stringify(envelope, null, 2), "utf-8");
}

export async function deleteAllSnapshots(): Promise<void> {
  if (env.kv.enabled()) {
    for (const p of SYNCED_PRESETS) {
      await kv.del(keyFor(p));
    }
    return;
  }
  for (const p of SYNCED_PRESETS) {
    try {
      await fs.unlink(devPath(p));
    } catch {
      /* ok */
    }
  }
}
