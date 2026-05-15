/**
 * Email campaign metrics. GHL's public API exposes message-level events
 * (sent/opened/clicked/replied/unsubscribed); aggregated campaign rollups
 * are not always available across plans, so we accumulate from the message
 * stream and skip silently if the endpoint returns nothing useful.
 */
import { getV2, GhlAuth, GhlError } from "./client";
import type { EmailMetrics, Bucket } from "../types";

interface EmailEventsResp {
  messages?: Array<{
    id: string;
    type?: string;
    direction?: string;
    status?: string;
    events?: Array<{ type: string; createdAt?: string }>;
    dateAdded?: string;
  }>;
  total?: number;
  nextPageToken?: string;
}

function bucketFor(auth: GhlAuth): Bucket {
  return auth.key === "abogado" ? "spanish" : "english";
}

export async function emailMetricsForLocation(
  auth: GhlAuth,
  start: Date,
  end: Date
): Promise<EmailMetrics> {
  const m: EmailMetrics = {
    bucket: bucketFor(auth),
    sends: 0,
    opens: 0,
    clicks: 0,
    replies: 0,
    unsubscribes: 0,
    signedWithin30dOfReply: 0, // filled in by metrics layer (needs cross-ref with opps)
  };

  try {
    // Try campaign-level stats endpoint first
    const campaigns = await getV2<{
      stats?: { sends?: number; opens?: number; clicks?: number; replies?: number; unsubscribes?: number };
      campaigns?: Array<{ stats?: { sends?: number; opens?: number; clicks?: number; replies?: number; unsubscribes?: number } }>;
    }>(auth, `/emails/stats`, {
      locationId: auth.locationId,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
    });
    if (campaigns?.stats) {
      m.sends += campaigns.stats.sends ?? 0;
      m.opens += campaigns.stats.opens ?? 0;
      m.clicks += campaigns.stats.clicks ?? 0;
      m.replies += campaigns.stats.replies ?? 0;
      m.unsubscribes += campaigns.stats.unsubscribes ?? 0;
    }
    if (Array.isArray(campaigns?.campaigns)) {
      for (const c of campaigns.campaigns) {
        m.sends += c.stats?.sends ?? 0;
        m.opens += c.stats?.opens ?? 0;
        m.clicks += c.stats?.clicks ?? 0;
        m.replies += c.stats?.replies ?? 0;
        m.unsubscribes += c.stats?.unsubscribes ?? 0;
      }
    }
  } catch (e) {
    if (!(e instanceof GhlError) || e.status >= 500) throw e;
    // 4xx -> not available on this plan; fall through to message-event count
  }

  // If campaign stats were empty, walk message events
  if (m.sends === 0) {
    try {
      let pageToken: string | undefined;
      let pages = 0;
      while (true) {
        pages++;
        if (pages > 30) break;
        const resp: EmailEventsResp = await getV2(auth, "/emails/events", {
          locationId: auth.locationId,
          startDate: start.toISOString(),
          endDate: end.toISOString(),
          limit: 200,
          pageToken,
        });
        const msgs = resp.messages ?? [];
        for (const msg of msgs) {
          const events = msg.events ?? [];
          for (const ev of events) {
            switch (ev.type) {
              case "sent":
              case "delivered":
                m.sends++;
                break;
              case "opened":
                m.opens++;
                break;
              case "clicked":
                m.clicks++;
                break;
              case "replied":
                m.replies++;
                break;
              case "unsubscribed":
                m.unsubscribes++;
                break;
            }
          }
        }
        if (!resp.nextPageToken || msgs.length === 0) break;
        pageToken = resp.nextPageToken;
      }
    } catch (e) {
      if (!(e instanceof GhlError) || e.status >= 500) throw e;
      // 4xx -> not available; leave zeros
    }
  }

  return m;
}
