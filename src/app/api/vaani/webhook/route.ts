import { after } from "next/server";
import { insertCall, processCall } from "@/lib/pipeline";
import { normaliseWebhook, verifyWebhook } from "@/lib/vaani";

export const maxDuration = 60;

/** Vaani post-call webhook: verify → store the call → classify and route after responding. */
export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifyWebhook(req, raw)) return Response.json({ error: "invalid signature" }, { status: 401 });

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "body must be JSON" }, { status: 400 });
  }

  // Vaani may send in-progress events too; only the finished call has a transcript worth classifying.
  const event = String((body as Record<string, unknown>)?.event ?? (body as Record<string, unknown>)?.type ?? "");
  if (event && !/end|complete|finish|analy|post/i.test(event)) return Response.json({ ignored: event });

  let call;
  try {
    call = normaliseWebhook(body);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "bad payload" }, { status: 400 });
  }

  const { id, duplicate } = await insertCall({
    vaaniCallId: call.vaaniCallId,
    source: "vaani",
    direction: call.direction,
    callerPhone: call.callerPhone,
    transcript: call.transcript,
    summary: call.summary,
    durationSeconds: call.durationSeconds,
    startedAt: call.startedAt,
    escalationFlag: call.escalationFlag,
    recordingUrl: call.recordingUrl,
    rawPayload: body,
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
