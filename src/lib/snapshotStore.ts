/**
 * Persistent snapshot store for the dashboard payload.
 *
 * Reads/writes a single key in Vercel KV (or any KV-compatible store
 * connected via KV_REST_API_URL / KV_REST_API_TOKEN). The dashboard page
 * loads this snapshot in ~50ms instead of walking GHL/Meta live.
 *
 * Dev fallback (when KV envs are absent AND we're NOT on Vercel) writes
 * to disk so local testing works. On Vercel we refuse to write to disk
 * (the filesystem is read-only outside /tmp, and /tmp is per-invocation
 * so a snapshot written there is invisible to the next request).
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { kv } from "@vercel/kv";
import { env } from "./env";
import type { DashboardData } from "./types";

const SNAPSHOT_KEY = "dash:snapshot:current";
const SNAPSHOT_TTL_SECONDS = 25 * 60 * 60; // 25 hours

// Dev fallback file -- put it in tmpdir so it doesn't end up in the repo
// or in Vercel's read-only /var/task.
const DEV_SNAPSHOT_PATH = path.join(os.tmpdir(), "pplt-intake-snapshot.json");

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

export async function readSnapshot(): Promise<SnapshotEnvelope | null> {
  if (env.kv.enabled()) {
    return ((await kv.get<SnapshotEnvelope>(SNAPSHOT_KEY)) ?? null);
  }
  if (IS_VERCEL) {
    // No KV on Vercel = no shared storage. Treat as "no snapshot" so the
    // UI shows the needs-sync CTA; the sync itself will throw with a
    // clearer error when the user clicks Refresh.
    return null;
  }
  try {
    const raw = await fs.readFile(DEV_SNAPSHOT_PATH, "utf-8");
    return JSON.parse(raw) as SnapshotEnvelope;
  } catch {
    return null;
  }
}

export async function writeSnapshot(envelope: SnapshotEnvelope): Promise<void> {
  if (env.kv.enabled()) {
    await kv.set(SNAPSHOT_KEY, envelope, { ex: SNAPSHOT_TTL_SECONDS });
    return;
  }
  if (IS_VERCEL) {
    throw new SnapshotStoreNotConfiguredError();
  }
  await fs.writeFile(DEV_SNAPSHOT_PATH, JSON.stringify(envelope, null, 2), "utf-8");
}

export async function deleteSnapshot(): Promise<void> {
  if (env.kv.enabled()) {
    await kv.del(SNAPSHOT_KEY);
    return;
  }
  try {
    await fs.unlink(DEV_SNAPSHOT_PATH);
  } catch {
    /* ok */
  }
}
