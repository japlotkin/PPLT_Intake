/**
 * Lead Analytics: source mix, status mix, conversion rate, avg time-to-signed.
 * Built per bucket (Spanish / English).
 */
import { authAbogado, authPplt } from "../ghl/client";
import { contactsInRange, normalizeSource } from "../ghl/contacts";
import {
  classifyOpportunities,
  streamOpportunities,
} from "../ghl/opportunities";
import { stageClassLabel } from "../mapping";
import type { LeadAnalytics, Bucket } from "../types";
import { sortDescByCount } from "./helpers";

export async function leadAnalyticsForBucket(
  bucket: Bucket,
  start: Date,
  end: Date
): Promise<LeadAnalytics> {
  const auth = bucket === "spanish" ? authAbogado() : authPplt();

  const [contacts, oppsRaw] = await Promise.all([
    contactsInRange(auth, start, end),
    streamOpportunities(auth),
  ]);
  const opps = classifyOpportunities(auth, oppsRaw);

  // Source mix
  const srcMap = new Map<string, number>();
  for (const c of contacts) {
    const s = normalizeSource(c.source);
    srcMap.set(s, (srcMap.get(s) ?? 0) + 1);
  }
  const sourceMix = sortDescByCount(
    Array.from(srcMap.entries()).map(([source, count]) => ({ source, count }))
  );

  // By status (stage class) for opps created in range
  const statusMap = new Map<string, number>();
  const sMs = start.getTime();
  const eMs = end.getTime();
  for (const o of opps) {
    if (!o.includeInMetrics) continue;
    const created = o.raw.createdAt ? Date.parse(o.raw.createdAt) : NaN;
    if (Number.isNaN(created) || created < sMs || created >= eMs) continue;
    const key = stageClassLabel(o.stageClass);
    statusMap.set(key, (statusMap.get(key) ?? 0) + 1);
  }
  const byStatus = sortDescByCount(
    Array.from(statusMap.entries()).map(([status, count]) => ({ status, count }))
  );

  // Conversion: signed / leads (leads = contacts in range)
  let signedFromWindow = 0;
  let daysSum = 0;
  let daysCount = 0;
  for (const o of opps) {
    if (!o.includeInMetrics) continue;
    if (o.stageClass !== "signed") continue;
    const sigAt = o.raw.lastStageChangeAt ? Date.parse(o.raw.lastStageChangeAt) : NaN;
    if (Number.isNaN(sigAt) || sigAt < sMs || sigAt >= eMs) continue;
    signedFromWindow++;
    if (o.raw.createdAt) {
      const created = Date.parse(o.raw.createdAt);
      if (!Number.isNaN(created) && sigAt >= created) {
        daysSum += (sigAt - created) / (24 * 3600 * 1000);
        daysCount++;
      }
    }
  }
  const conversionRatePct =
    contacts.length === 0 ? 0 : (signedFromWindow / contacts.length) * 100;
  const avgDaysToSigned = daysCount === 0 ? null : daysSum / daysCount;

  return { sourceMix, byStatus, conversionRatePct, avgDaysToSigned };
}
