/**
 * Site-wide password gate. Single shared firm password; once verified,
 * we set an HMAC-signed cookie. Clerk handles per-user auth after.
 *
 * Cookie format: `<hex-hmac>.<expiry-epoch-ms>`. We sign expiry with the
 * SITE_GATE_COOKIE_SECRET so a stolen cookie can't be extended.
 *
 * Uses Web Crypto (SubtleCrypto) so the same module works in both Edge
 * (middleware) and Node (API routes). bcryptjs runs in pure JS — fine in
 * both runtimes too, just slower.
 */
import { compare as bcryptCompare } from "bcryptjs";
import { env } from "./env";

export const GATE_COOKIE = "pplt_gate";
const COOKIE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function bufToHex(buf: ArrayBuffer): string {
  const view = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < view.length; i++) {
    s += view[i].toString(16).padStart(2, "0");
  }
  return s;
}

function hexToBuf(hex: string): Uint8Array {
  const clean = hex.length % 2 === 0 ? hex : "0" + hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

async function hmacKey(): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    "raw",
    enc.encode(env.gate.secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

async function sign(payload: string): Promise<string> {
  const key = await hmacKey();
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return bufToHex(sig);
}

export async function makeCookieValue(): Promise<{ value: string; maxAgeSeconds: number }> {
  const expiry = Date.now() + COOKIE_TTL_MS;
  const sig = await sign(String(expiry));
  return { value: `${sig}.${expiry}`, maxAgeSeconds: COOKIE_TTL_MS / 1000 };
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function verifyCookieValue(raw: string | undefined | null): Promise<boolean> {
  if (!raw) return false;
  const [sig, exp] = raw.split(".");
  if (!sig || !exp) return false;
  const expMs = Number(exp);
  if (!Number.isFinite(expMs) || expMs < Date.now()) return false;
  const expected = await sign(String(expMs));
  try {
    return constantTimeEqual(hexToBuf(sig), hexToBuf(expected));
  } catch {
    return false;
  }
}

export async function passwordMatches(input: string): Promise<boolean> {
  return bcryptCompare(input, env.gate.hash());
}
