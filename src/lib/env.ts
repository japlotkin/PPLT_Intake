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

  // Admin
  adminEmail: () => req("ADMIN_EMAIL").toLowerCase(),
};
