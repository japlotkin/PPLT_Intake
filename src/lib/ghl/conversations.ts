/**
 * Conversation/message pagination for calls + SMS counts.
 *
 * Pattern (from the existing _count_calls_yesterday.py script):
 *   1. /conversations/search sorted desc by lastMessageDate, stop once we
 *      pass the window's start.
 *   2. For each conversation, walk /conversations/{id}/messages, stop once
 *      messages go past the window's start, bucket TYPE_CALL / TYPE_SMS
 *      by (userId, UTC-day).
 *
 * Per-day bucketing lets downstream callers slice arbitrary sub-windows
 * (rolling 7d/30d, this_week, last_month, today's preset) without
 * re-walking conversations. /api/sync/intake walks once every 4 hours
 * over a 60-day window and persists the per-day buckets to KV; the
 * dashboard reads from KV at request time.
 *
 * This is rate-limited heavy: ~1 request per conversation per page.
 */
import { getV2, GhlAuth } from "./client";

interface ConvSearchResp {
  conversations: Array<{
    id: string;
    lastMessageDate?: number;
    dateUpdated?: number;
  }>;
}

interface MessagesResp {
  messages: {
    messages: Array<{
      id: string;
      userId?: string;
      messageType?: string;
      direction?: string;
      dateAdded?: string;
      callDuration?: number;
      meta?: { callStatus?: string };
    }>;
    nextPage?: boolean;
    lastMessageId?: string;
  };
}

/** "YYYY-MM-DD" in UTC. Matches intakeConversationsStore.utcDateKey. */
function utcDateKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export interface CallDayBucket {
  inbound: number;
  outbound: number;
  answered: number;
  durationSeconds: number;
}

export interface SmsDayBucket {
  inbound: number;
  outbound: number;
}

/** Per-user activity over the walked window. Keys: UTC date strings. */
export interface UserDailyActivity {
  calls: Record<string, CallDayBucket>;
  sms: Record<string, SmsDayBucket>;
}

export interface ConversationActivityByDay {
  /** GHL userId -> per-day buckets. */
  byUser: Map<string, UserDailyActivity>;
  /** Calls + SMS we couldn't attribute to a user (missing userId on message). */
  unassignedCalls: number;
  unassignedSms: number;
  /** Diagnostics for the cron log. */
  conversationsScanned: number;
  messagesScanned: number;
}

function ensureUser(
  byUser: Map<string, UserDailyActivity>,
  userId: string
): UserDailyActivity {
  let u = byUser.get(userId);
  if (!u) {
    u = { calls: {}, sms: {} };
    byUser.set(userId, u);
  }
  return u;
}

function ensureCallBucket(activity: UserDailyActivity, dateKey: string): CallDayBucket {
  let b = activity.calls[dateKey];
  if (!b) {
    b = { inbound: 0, outbound: 0, answered: 0, durationSeconds: 0 };
    activity.calls[dateKey] = b;
  }
  return b;
}

function ensureSmsBucket(activity: UserDailyActivity, dateKey: string): SmsDayBucket {
  let b = activity.sms[dateKey];
  if (!b) {
    b = { inbound: 0, outbound: 0 };
    activity.sms[dateKey] = b;
  }
  return b;
}

export async function conversationsActivityByDay(
  auth: GhlAuth,
  start: Date,
  end: Date
): Promise<ConversationActivityByDay> {
  const startMs = start.getTime();
  const endMs = end.getTime();

  // Step 1: find conversations active in the window.
  const convIds: string[] = [];
  let startAfterDate: number | undefined;
  let startAfterId: string | undefined;
  let page = 0;
  while (true) {
    page++;
    if (page > 200) break;
    const q: Record<string, string | number | undefined> = {
      locationId: auth.locationId,
      limit: 100,
      sortBy: "last_message_date",
      sort: "desc",
    };
    if (startAfterDate !== undefined) q.startAfterDate = startAfterDate;
    if (startAfterId) q.startAfterId = startAfterId;
    const resp: ConvSearchResp = await getV2(auth, "/conversations/search", q);
    const convs = resp.conversations ?? [];
    if (!convs.length) break;
    let stop = false;
    for (const c of convs) {
      const lmd = c.lastMessageDate ?? c.dateUpdated ?? 0;
      if (lmd < startMs) {
        stop = true;
        break;
      }
      convIds.push(c.id);
    }
    if (stop || convs.length < 100) break;
    const last = convs[convs.length - 1];
    startAfterDate = last.lastMessageDate ?? last.dateUpdated;
    startAfterId = last.id;
  }

  // Step 2: walk messages in each, bucketing by (userId, UTC day).
  const byUser = new Map<string, UserDailyActivity>();
  let unassignedCalls = 0;
  let unassignedSms = 0;
  let messagesScanned = 0;

  for (const cid of convIds) {
    let lastMessageId: string | undefined;
    let msgPage = 0;
    while (true) {
      msgPage++;
      if (msgPage > 50) break;
      const q: Record<string, string | number | undefined> = { limit: 100 };
      if (lastMessageId) q.lastMessageId = lastMessageId;
      let resp: MessagesResp;
      try {
        resp = await getV2(auth, `/conversations/${cid}/messages`, q);
      } catch {
        break;
      }
      const wrapper = resp.messages;
      const msgs = wrapper?.messages ?? [];
      if (!msgs.length) break;
      let stop = false;
      for (const m of msgs) {
        messagesScanned++;
        const da = m.dateAdded;
        if (!da) continue;
        const t = Date.parse(da);
        if (Number.isNaN(t)) continue;
        if (t < startMs) {
          stop = true;
          continue;
        }
        if (t >= endMs) continue;
        const dateKey = utcDateKey(t);
        if (m.messageType === "TYPE_CALL") {
          if (!m.userId) {
            unassignedCalls++;
            continue;
          }
          const u = ensureUser(byUser, m.userId);
          const bucket = ensureCallBucket(u, dateKey);
          if (m.direction === "inbound") bucket.inbound++;
          else bucket.outbound++;
          const status = m.meta?.callStatus?.toLowerCase();
          const dur = Number(m.callDuration ?? 0) || 0;
          if (status === "answered" || (dur > 0 && status !== "missed")) {
            bucket.answered++;
            bucket.durationSeconds += dur;
          }
        } else if (m.messageType === "TYPE_SMS") {
          if (!m.userId) {
            unassignedSms++;
            continue;
          }
          const u = ensureUser(byUser, m.userId);
          const bucket = ensureSmsBucket(u, dateKey);
          if (m.direction === "inbound") bucket.inbound++;
          else bucket.outbound++;
        }
      }
      if (stop || !wrapper.nextPage) break;
      lastMessageId = wrapper.lastMessageId ?? msgs[msgs.length - 1].id;
      if (!lastMessageId) break;
    }
  }

  return {
    byUser,
    unassignedCalls,
    unassignedSms,
    conversationsScanned: convIds.length,
    messagesScanned,
  };
}
