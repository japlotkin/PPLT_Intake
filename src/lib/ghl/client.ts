/**
 * GHL HTTP client. Supports both LeadConnector v2 (PIT token) and the
 * legacy v1 REST API (JWT token) -- some endpoints only exist on one side,
 * notably v1 /users/.
 *
 * Retries 429/5xx with backoff. Throws GhlError on persistent failure so
 * the data layer can decide whether to fall back or surface a warning.
 */
import type { LocationKey } from "../types";
import { acquire, release, notify429 } from "./rateLimiter";

const V2_BASE = "https://services.leadconnectorhq.com";
const V1_BASE = "https://rest.gohighlevel.com/v1";

export class GhlError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: string,
    public path: string
  ) {
    super(message);
    this.name = "GhlError";
  }
}

interface ReqOptions {
  retries?: number;
  timeoutMs?: number;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  opts: ReqOptions = {}
): Promise<Response> {
  const { retries = 10, timeoutMs = 60_000 } = opts;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await acquire();
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: ctl.signal });
      clearTimeout(to);
      release();
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("retry-after") ?? 0);
        // notify the bucket; it'll pause >= 10s. We add light jitter on top
        // so concurrent 429s don't all wake at the same instant.
        notify429(retryAfter > 0 ? retryAfter * 1000 : undefined);
        if (attempt < retries) {
          await sleep(200 + Math.random() * 400);
          continue;
        }
      }
      if (res.status >= 500 && res.status < 600) {
        if (attempt < retries) {
          await sleep(500 * Math.pow(2, attempt) + Math.random() * 200);
          continue;
        }
      }
      return res;
    } catch (e) {
      clearTimeout(to);
      release();
      lastErr = e;
      if (attempt < retries) {
        await sleep(500 * Math.pow(2, attempt) + Math.random() * 200);
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

export interface GhlAuth {
  locationId: string;
  pit: string;
  v1: string;
  key: LocationKey;
}

function v2Headers(auth: GhlAuth, version = "2021-07-28"): HeadersInit {
  return {
    Authorization: `Bearer ${auth.pit}`,
    Version: version,
    Accept: "application/json",
    "User-Agent": "pplt-dash/1.0",
  };
}

function v1Headers(auth: GhlAuth): HeadersInit {
  return {
    Authorization: `Bearer ${auth.v1}`,
    Accept: "application/json",
    "User-Agent": "pplt-dash/1.0",
  };
}

export async function getV2<T>(
  auth: GhlAuth,
  path: string,
  query?: Record<string, string | number | undefined>,
  opts?: ReqOptions
): Promise<T> {
  const qs = query
    ? "?" +
      Object.entries(query)
        .filter(([, v]) => v !== undefined && v !== null && v !== "")
        .map(
          ([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`
        )
        .join("&")
    : "";
  const url = `${V2_BASE}${path}${qs}`;
  const res = await fetchWithRetry(url, { headers: v2Headers(auth) }, opts);
  const text = await res.text();
  if (!res.ok) {
    throw new GhlError(`GHL v2 ${res.status} ${path}`, res.status, text, path);
  }
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

export async function postV2<T>(
  auth: GhlAuth,
  path: string,
  body: unknown,
  opts?: ReqOptions
): Promise<T> {
  const url = `${V2_BASE}${path}`;
  const res = await fetchWithRetry(
    url,
    {
      method: "POST",
      headers: { ...v2Headers(auth), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    opts
  );
  const text = await res.text();
  if (!res.ok) {
    throw new GhlError(`GHL v2 ${res.status} ${path}`, res.status, text, path);
  }
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

export async function getV1<T>(
  auth: GhlAuth,
  path: string,
  opts?: ReqOptions
): Promise<T> {
  const url = `${V1_BASE}${path}`;
  const res = await fetchWithRetry(url, { headers: v1Headers(auth) }, {
    retries: 4,
    ...opts,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new GhlError(`GHL v1 ${res.status} ${path}`, res.status, text, path);
  }
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

// Build the two auth bundles from env. Imported by metric layer.
import { env } from "../env";
export function authAbogado(): GhlAuth {
  return {
    locationId: env.ghlAbogado.locationId(),
    pit: env.ghlAbogado.pit(),
    v1: env.ghlAbogado.v1(),
    key: "abogado",
  };
}
export function authPplt(): GhlAuth {
  return {
    locationId: env.ghlPplt.locationId(),
    pit: env.ghlPplt.pit(),
    v1: env.ghlPplt.v1(),
    key: "pplt_leads",
  };
}
export function bothAuths(): GhlAuth[] {
  return [authAbogado(), authPplt()];
}
