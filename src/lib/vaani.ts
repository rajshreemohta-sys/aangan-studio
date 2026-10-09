import { createHmac, timingSafeEqual } from "node:crypto";
import { env, requireEnv } from "./env";

/**
 * Everything Vaani-specific lives here, so a change in their API touches one file.
 * Field names follow the public Vaani quickstart (POST /calls/outbound_call) and are
 * read defensively from the webhook, because the post-call payload isn't documented
 * publicly. Confirm against the Vaani docs and adjust `normaliseWebhook` if needed.
 */

export type NormalisedCall = {
  vaaniCallId: string;
  direction: "inbound" | "outbound";
  callerPhone: string | null;
  transcript: string;
  summary: string | null;
  durationSeconds: number;
  startedAt: Date;
  recordingUrl: string | null;
  escalationFlag: boolean;
  hubspotContactId: string | null;
};

// ---------- webhook verification ----------

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Accepts, in order of preference: an HMAC-SHA256 signature of the raw body
 * (`x-vaani-signature`, hex, optional `sha256=` prefix), a shared secret header
 * (`x-webhook-secret` / `Authorization: Bearer`), or `?secret=` for dashboards
 * that only let you paste a URL.
 */
export function verifyWebhook(req: Request, rawBody: string): boolean {
  const secret = env("VAANI_WEBHOOK_SECRET");
  if (!secret) return false;
  const sig = req.headers.get("x-vaani-signature");
  if (sig) {
    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
    return safeEqual(sig.replace(/^sha256=/, "").toLowerCase(), expected);
  }
  const header = req.headers.get("x-webhook-secret") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (header) return safeEqual(header, secret);
  const query = new URL(req.url).searchParams.get("secret");
  return query ? safeEqual(query, secret) : false;
}

// ---------- payload normalisation ----------

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

function pick(obj: Json, ...paths: string[]): unknown {
  for (const p of paths) {
    let cur: unknown = obj;
    for (const k of p.split(".")) cur = isObj(cur) ? cur[k] : undefined;
    if (cur !== undefined && cur !== null && cur !== "") return cur;
  }
  return undefined;
}
const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : null);

function transcriptText(t: unknown): string {
  if (typeof t === "string") return t.trim();
  if (!Array.isArray(t)) return "";
  return t
    .map((turn) => {
      if (!isObj(turn)) return "";
      const role = String(pick(turn, "role", "speaker", "from") ?? "").toLowerCase();
      const text = String(pick(turn, "content", "text", "message", "transcript") ?? "").trim();
      if (!text) return "";
      const who = /agent|assistant|bot|ai|vaani/.test(role) ? "Agent" : /system|tool|function/.test(role) ? "" : "Caller";
      return who ? `${who}: ${text}` : "";
    })
    .filter(Boolean)
    .join("\n");
}

export function normaliseWebhook(body: unknown): NormalisedCall {
  if (!isObj(body)) throw new Error("Webhook body is not a JSON object");
  const root = isObj(body.data) ? { ...body, ...body.data } : isObj(body.call) ? { ...body, ...body.call } : body;

  const vaaniCallId = str(pick(root, "call_id", "callId", "id", "call_sid", "session_id"));
  if (!vaaniCallId) throw new Error("Webhook has no call id");

  const transcript = transcriptText(pick(root, "transcript", "transcription", "conversation", "messages", "call_log.transcript"));
  const rawDuration = Number(pick(root, "duration_seconds", "duration", "call_duration", "billable_duration", "call_log.duration"));
  const durationSeconds = Number.isFinite(rawDuration) ? Math.round(rawDuration > 36_000 ? rawDuration / 1000 : rawDuration) : 0;
  const started = str(pick(root, "started_at", "start_time", "startedAt", "created_at", "timestamp"));
  const directionRaw = String(pick(root, "direction", "call_type", "type") ?? "inbound").toLowerCase();
  const direction = directionRaw.includes("out") ? "outbound" : "inbound";
  const vars = pick(root, "dynamic_variables", "variables", "metadata");
  const fnCalls = JSON.stringify(pick(root, "function_calls", "tool_calls", "functions") ?? "");

  return {
    vaaniCallId,
    direction,
    callerPhone: str(direction === "outbound" ? pick(root, "to_number", "to", "customer_number") : pick(root, "from_number", "from", "caller_number", "customer_number")),
    transcript,
    summary: str(pick(root, "summary", "analysis.summary", "call_summary", "ai_analysis.summary")),
    durationSeconds,
    startedAt: started && !Number.isNaN(Date.parse(started)) ? new Date(started) : new Date(),
    recordingUrl: str(pick(root, "recording_url", "recordingUrl", "recording")),
    escalationFlag: fnCalls.includes("flag_escalation") || transcript.includes("[ESCALATE]"),
    hubspotContactId: isObj(vars) ? str(vars.hubspot_contact_id) : null,
  };
}

// ---------- outbound callbacks ----------

export async function startOutboundCall(toNumber: string, variables: Record<string, string>): Promise<{ callId: string | null }> {
  const base = (env("VAANI_API_BASE") ?? "https://api.vaani.ai").replace(/\/$/, "");
  const token = requireEnv("VAANI_API_KEY");
  const res = await fetch(`${base}/calls/outbound_call`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      // The quickstart authenticates with a JWT cookie; sending both keeps either scheme working.
      Cookie: `access_token=${token}`,
    },
    body: JSON.stringify({
      agent_number: requireEnv("VAANI_AGENT_NUMBER"),
      to_number: toNumber,
      dynamic_variables: { call_direction: "outbound", ...variables },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Vaani outbound_call failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json().catch(() => ({}))) as Json;
  return { callId: str(pick(data, "call_id", "id", "data.call_id", "data.id")) };
}
