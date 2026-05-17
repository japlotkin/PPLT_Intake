/**
 * Centralized env reading. Throws loudly at request time if a required
 * server-side var is missing -- better than NaN/undefined leaking into the
 * GHL or Meta clients.
 */

function req(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

function opt(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== "" ? v : undefined;
}

export const env = {
  // GHL
  ghlAbogado: {
    locationId: () => req("GHL_ABOGADO_LOCATION_ID"),
    pit: () => req("GHL_ABOGADO_PIT_TOKEN"),
    v1: () => req("GHL_ABOGADO_V1_JWT"),
  },
  ghlPplt: {
    locationId: () => req("GHL_PPLT_LOCATION_ID"),
    pit: () => req("GHL_PPLT_PIT_TOKEN"),
    v1: () => req("GHL_PPLT_V1_JWT"),
  },

  // Meta
  meta: {
    token: () => req("META_ACCESS_TOKEN"),
    accounts: () => ({
      pplt: req("META_AD_ACCOUNT_PPLT"),
      workersComp: req("META_AD_ACCOUNT_WORKERS_COMP"),
      abogado: req("META_AD_ACCOUNT_ABOGADO"),
    }),
  },

  // Site gate
  gate: {
    hash: () => req("SITE_GATE_PASSWORD_HASH"),
    secret: () => req("SITE_GATE_COOKIE_SECRET"),
  },

  // Cache
  kv: {
    url: () => opt("KV_REST_API_URL"),
    token: () => opt("KV_REST_API_TOKEN"),
    enabled: () => Boolean(opt("KV_REST_API_URL") && opt("KV_REST_API_TOKEN")),
  },

  // Admin -- supports either ADMIN_EMAILS (comma-separated) or legacy
  // ADMIN_EMAIL (single email) for back-compat.
  adminEmails: () => {
    const multi = opt("ADMIN_EMAILS");
    const single = opt("ADMIN_EMAIL");
    const raw = multi ?? single ?? "";
    return raw
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
  },
  isAdminEmail: (email: string | null | undefined) => {
    if (!email) return false;
    const list = (() => {
      const multi = opt("ADMIN_EMAILS");
      const single = opt("ADMIN_EMAIL");
      const raw = multi ?? single ?? "";
      return raw.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
    })();
    return list.includes(email.trim().toLowerCase());
  },
  /** Legacy single-email accessor. Returns the FIRST admin email or throws. */
  adminEmail: () => {
    const multi = opt("ADMIN_EMAILS");
    const single = opt("ADMIN_EMAIL");
    const raw = multi ?? single ?? "";
    const first = raw.split(",").map((e) => e.trim()).filter(Boolean)[0];
    if (!first) throw new Error("ADMIN_EMAILS / ADMIN_EMAIL not configured");
    return first.toLowerCase();
  },
};
