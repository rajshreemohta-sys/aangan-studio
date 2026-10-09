import { after } from "next/server";
import type { DispatchRow } from "@/lib/database.types";
import { one, query } from "@/lib/db";
import { insertCall, processCall } from "@/lib/pipeline";
import { findHistoryCall, parseVaaniTime, parseWebhook, verifyWebhook } from "@/lib/vaani";

export const maxDuration = 60;

/**
 * Vaani webhook (Settings → Webhooks in the Vaani dashboard, URL ending ?secret=…).
 * `call_postprocessing` carries the finished transcript → store, then classify and route
 * after responding. No-answer / rejected / failed events update our outbound call log.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifyWebhook(req, raw)) return Response.json({ error: "invalid secret" }, { status: 401 });

  let event;
  try {
    event = parseWebhook(JSON.parse(raw));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "bad payload" }, { status: 400 });
  }

  if (event.kind === "ignored") return Response.json({ ignored: event.event });

  if (event.kind === "not_connected") {
    await query("update dispatches set status = $2, error = $3 where vaani_call_id = $1", [event.callId, event.status, event.error]);
    return Response.json({ ok: true });
  }

  // A call we placed? Then we already know the number and when the enquiry came in.
  const dispatch = await one<DispatchRow>("select * from dispatches where vaani_call_id = $1", [event.callId]);
  // A browser voice call from the /talk page?
  const isWeb = !!(await one<{ id: string }>("select id from voice_sessions where room_name = $1", [event.callId])) || event.callId.startsWith("webrtc-");
  let phone = dispatch?.phone ?? null;
  let startedAt = new Date(event.finishedAt.getTime() - event.durationSeconds * 1000);
  let direction: "inbound" | "outbound" = dispatch || event.callId.startsWith("outbound-") ? "outbound" : "inbound";

  // The webhook doesn't include the caller's number; Vaani's call history does.
  try {
    const h = await findHistoryCall(event.callId);
    if (h) {
      direction = /out/i.test(h.direction ?? h.call_type ?? "") ? "outbound" : direction;
      if (!isWeb) phone ??= (direction === "outbound" ? h.to_number : h.from_number) ?? null;
      startedAt = parseVaaniTime(h.Start_time) ?? startedAt;
    }
  } catch (e) {
    console.error("Vaani call-history lookup failed", event.callId, e);
  }

  const { id, duplicate } = await insertCall({
    vaaniCallId: event.callId,
    source: "vaani",
    direction,
    callerPhone: phone,
    transcript: event.transcript,
    summary: event.summary,
    durationSeconds: event.durationSeconds,
    startedAt,
    enquiryAt: dispatch ? new Date(dispatch.enquiry_at) : startedAt,
    recordingUrl: event.recordingUrl,
    rawPayload: JSON.parse(raw),
    channel: isWeb ? "web" : "phone",
  });
  if (duplicate) return Response.json({ ok: true, callId: id, duplicate: true });

  after(async () => {
    try {
      await processCall(id);
    } catch (e) {
      console.error("processCall failed", id, e);
    }
  });
  return Response.json({ ok: true, callId: id });
}
