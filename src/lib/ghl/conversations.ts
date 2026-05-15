/**
 * Conversation/message pagination for calls + SMS counts.
 *
 * Pattern (from the existing _count_calls_yesterday.py script):
 *   1. /conversations/search sorted desc by lastMessageDate, stop once we
 *      pass the window's start.
 *   2. For each conversation, walk /conversations/{id}/messages, stop once
 *      messages go past the window's start, count TYPE_CALL / TYPE_SMS.
 *
 * This is rate-limited heavy: ~1 request per conversation. Cache the result
 * per (location, window) for the full hour.
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

export interface CallSummary {
  userId: string | null;
  inbound: number;
  outbound: number;
  answered: number;
  missed: number;
  durationSeconds: number; // sum of answered call duration
}

export interface ConversationActivity {
  callsByUser: Map<string, CallSummary>;
  smsByUser: Map<string, { inbound: number; outbound: number }>;
  callsUnassigned: number;
}

function emptyCall(uid: string): CallSummary {
  return {
    userId: uid,
    inbound: 0,
    outbound: 0,
    answered: 0,
    missed: 0,
    durationSeconds: 0,
  };
}

export async function conversationsActivity(
  auth: GhlAuth,
  start: Date,
  end: Date
): Promise<ConversationActivity> {
  const startMs = start.getTime();
  const endMs = end.getTime();

  // Step 1: find conversations active in window
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

  // Step 2: walk messages in each
  const callsByUser = new Map<string, CallSummary>();
  const smsByUser = new Map<string, { inbound: number; outbound: number }>();
  let callsUnassigned = 0;

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
        const da = m.dateAdded;
        if (!da) continue;
        const t = Date.parse(da);
        if (Number.isNaN(t)) continue;
        if (t < startMs) {
          stop = true;
          continue;
        }
        if (t >= endMs) continue;
        if (m.messageType === "TYPE_CALL") {
          if (!m.userId) {
            callsUnassigned++;
            continue;
          }
          const u = callsByUser.get(m.userId) ?? emptyCall(m.userId);
          if (m.direction === "inbound") u.inbound++;
          else u.outbound++;
          const status = m.meta?.callStatus?.toLowerCase();
          const dur = Number(m.callDuration ?? 0) || 0;
          if (status === "answered" || (dur > 0 && status !== "missed")) {
            u.answered++;
            u.durationSeconds += dur;
          } else {
            u.missed++;
          }
          callsByUser.set(m.userId, u);
        } else if (m.messageType === "TYPE_SMS") {
          const uid = m.userId ?? "(system)";
          const s = smsByUser.get(uid) ?? { inbound: 0, outbound: 0 };
          if (m.direction === "inbound") s.inbound++;
          else s.outbound++;
          smsByUser.set(uid, s);
        }
      }
      if (stop || !wrapper.nextPage) break;
      lastMessageId = wrapper.lastMessageId ?? msgs[msgs.length - 1].id;
      if (!lastMessageId) break;
    }
  }

  return { callsByUser, smsByUser, callsUnassigned };
}
