/**
 * KV-backed last-successful Meta ad insights cache.
 *
 * Meta access has been flaky (token blocked / unblocked / re-blocked).
 * When the live fetch fails, we fall back to the most recent successful
 * pull for the same window so the Ad Cost section doesn't go blank.
 *
 * One entry per (start-day, end-day) so each preset has its own
 * fallback. 7-day TTL.
 */
import { kv } from "@vercel/kv";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { env } from "./env";
import type { MetaAdRow } from "./meta/ads";

const PREFIX = "meta:ads:v1:";
const TTL_SECONDS = 7 * 24 * 3600;
const IS_VERCEL = Boolean(process.env.VERCEL);

export interface MetaAdsCacheEntry {
  syncedAt: string;
  startISO: string;
  endISO: string;
  ads: MetaAdRow[];
}

export function windowKeyFor(start: Date, end: Date): string {
  return `${start.toISOString().slice(0, 10)}_${end.toISOString().slice(0, 10)}`;
}

function devPath(key: string): string {
  return path.join(os.tmpdir(), `pplt-intake-meta-ads-${key}.json`);
}

export async function readMetaAdsCache(
  windowKey: string
): Promise<MetaAdsCacheEntry | null> {
  if (env.kv.enabled()) {
    return ((await kv.get<MetaAdsCacheEntry>(`${PREFIX}${windowKey}`)) ?? null);
  }
  if (IS_VERCEL) return null;
  try {
    const raw = await fs.readFile(devPath(windowKey), "utf-8");
    return JSON.parse(raw) as MetaAdsCacheEntry;
  } catch {
    return null;
  }
}

export async function writeMetaAdsCache(
  windowKey: string,
  entry: MetaAdsCacheEntry
): Promise<void> {
  if (env.kv.enabled()) {
    await kv.set(`${PREFIX}${windowKey}`, entry, { ex: TTL_SECONDS });
    return;
  }
  if (IS_VERCEL) return;
  await fs.writeFile(devPath(windowKey), JSON.stringify(entry), "utf-8");
}
