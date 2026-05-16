/**
 * Persistent snapshot store for the dashboard payload.
 *
 * Reads/writes a single key in Vercel KV (or any KV-compatible store
 * connected via KV_REST_API_URL / KV_REST_API_TOKEN). The dashboard page
 * loads this snapshot in ~50ms instead of walking GHL/Meta live.
 *
 * In dev (no KV env vars), falls back to writing the snapshot to disk so
 * the local /dashboard works without a real KV. Cron won't run locally
 * anyway, so this is just for testing the read path.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { kv } from "@vercel/kv";
import { env } from "./env";
import type { DashboardData } from "./types";

const SNAPSHOT_KEY = "dash:snapshot:current";
const SNAPSHOT_TTL_SECONDS = 25 * 60 * 60; // 25 hours (a bit over the 30-min cron interval, with safety margin)

const DEV_SNAPSHOT_PATH = path.join(process.cwd(), ".snapshot.local.json");

export interface SnapshotEnvelope {
  data: DashboardData;
  syncedAt: string;
  durationMs: number;
}

export async function readSnapshot(): Promise<SnapshotEnvelope | null> {
  if (env.kv.enabled()) {
    return ((await kv.get<SnapshotEnvelope>(SNAPSHOT_KEY)) ?? null);
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
