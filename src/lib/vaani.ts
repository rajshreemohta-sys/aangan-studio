import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { env, requireEnv } from "./env";

/**
 * Everything Vaani-specific lives here (docs: https://docs.vaanivoice.ai).
 * API: https://api.vaanivoice.ai/api/…, authenticated with the X-API-Key header.
 * Webhooks are registered in the Vaani dashboard (Settings → Webhooks) as a URL only,
 * so the shared secret travels as ?secret= on that URL.
 */

const BASE = () => (env("VAANI_API_BASE") ?? "https://api.vaanivoice.ai").replace(/\/$/, "");

// ---------- webhook verification ----------

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Accepts `?secret=` (what the Vaani dashboard supports), a secret header, or an HMAC signature. */
export function verifyWebhook(req: Request, rawBody: string): boolean {
  const secret = env("VAANI_WEBHOOK_SECRET");
  if (!secret) return false;
  const sig = req.headers.get("x-vaani-signature");
  if (sig) return safeEqual(sig.replace(/^sha256=/, "").toLowerCase(), createHmac("sha256", secret).update(rawBody).digest("hex"));
  const header = req.headers.get("x-webhook-secret") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (header) return safeEqual(header, secret);
  const query = new URL(req.url).searchParams.get("secret");
  return query ? safeEqual(query, secret) : false;
}

// ---------- webhook payloads ----------

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" && v ? v : typeof v === "number" ? String(v) : null);

export type VaaniEvent =
  | { kind: "completed"; callId: string; durationSeconds: number; transcript: string; summary: string | null; recordingUrl: string | null; finishedAt: Date }
  | { kind: "not_connected"; callId: string; status: "no_answer" | "rejected" | "failed"; error: string | null }
  | { kind: "ignored"; event: string };

/** "[13:33:14] AGENT: Hi…\n\n[13:33:19] USER: …" → "Agent: Hi…\nCaller: …" */
export function normaliseTranscript(raw: string): string {
  return raw
    .split(/\n+/)
    .map((line) => line.trim().replace(/^\[[\d:.\s]+\]\s*/, ""))
    .filter(Boolean)
    .map((line) => line.replace(/^(AGENT|ASSISTANT|BOT)\s*:\s*/i, "Agent: ").replace(/^(USER|CUSTOMER|CALLER)\s*:\s*/i, "Caller: "))
    .join("\n");
}

export function parseWebhook(body: unknown): VaaniEvent {
  if (!isObj(body)) throw new Error("Webhook body is not a JSON object");
  const event = String(body.event ?? "");
  const data = isObj(body.data) ? body.data : body;
  const callId = str(body.call_id) ?? str(data.call_id) ?? str(data.room_name) ?? str(body.room_name);

  if (event === "call_postprocessing") {
    if (!callId) throw new Error("call_postprocessing without a call id");
    const ms = Number(data.call_duration);
    return {
      kind: "completed",
      callId,
      // call_duration is milliseconds on this event (seconds on call_ended).
      durationSeconds: Number.isFinite(ms) ? Math.round(ms / 1000) : 0,
      transcript: normaliseTranscript(String(data.transcript ?? "")),
      summary: str(data.summary),
      recordingUrl: str(data.recording_url),
      finishedAt: str(body.timestamp) && !Number.isNaN(Date.parse(String(body.timestamp))) ? new Date(String(body.timestamp)) : new Date(),
    };
  }
  if (event === "call_no_answer" || event === "call_rejected" || event === "call_failed") {
    if (!callId) throw new Error(`${event} without a call id`);
    const status = event === "call_no_answer" ? "no_answer" : event === "call_rejected" ? "rejected" : "failed";
    return { kind: "not_connected", callId, status, error: str(data.error) };
  }
  return { kind: "ignored", event: event || "unknown" };
}

// ---------- REST API ----------

async function vaani<T>(pathname: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE()}${pathname}`, {
    ...init,
    headers: { "X-API-Key": requireEnv("VAANI_API_KEY"), "Content-Type": "application/json", ...init.headers },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Vaani ${pathname} failed: ${res.status} ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

export type HistoryCall = {
  call_id: string;
  direction?: string;
  call_type?: string;
  from_number?: string;
  to_number?: string;
  Start_time?: string;
  duration_ms?: number;
  call_cost?: number;
};

/** The webhook doesn't carry the caller's number; call history does. Looks through the most recent calls. */
export async function findHistoryCall(callId: string): Promise<HistoryCall | null> {
  for (let page = 1; page <= 2; page++) {
    const r = await vaani<{ data?: HistoryCall[]; pagination?: { has_next?: boolean } }>(`/api/call-history?page=${page}&page_size=50`);
    const hit = r.data?.find((c) => c.call_id === callId);
    if (hit) return hit;
    if (!r.pagination?.has_next) break;
  }
  return null;
}

/** Vaani's timestamps come without a zone; they are UTC. */
export function parseVaaniTime(s: string | undefined): Date | null {
  if (!s) return null;
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ---------- prompts ----------

let basePrompt: string | undefined;
export function agentPrompt(): string {
  basePrompt ??= readFileSync(path.join(/*turbopackIgnore: true*/ process.cwd(), "prompts", "vaani-agent.md"), "utf8");
  return basePrompt;
}

export const INBOUND_GREETING = "Hello, you've reached Aangan Studio, this is Vaani. How can I help you today?";

export type CallbackBrief = { reason: "follow_up" | "dropped_call" | "web_enquiry"; name: string | null; known: string; ask: string | null };

/** The system prompt for a callback: the normal rules plus who we're calling and why. */
export function callbackPrompt(b: CallbackBrief): { system_prompt: string; greeting: string } {
  const who = b.name?.trim() || "the caller";
  const why = {
    follow_up: "they spoke to us recently and a few details are still missing",
    dropped_call: "their call to the studio dropped a moment ago",
    web_enquiry: "they filled in the enquiry form on our website a few minutes ago",
  }[b.reason];
  const greeting = b.name?.trim()
    ? `Hi, is this ${b.name.trim()}? This is Vaani from Aangan Studio — I'm calling because ${why}. Is this a good time for two minutes?`
    : `Hi, this is Vaani from Aangan Studio — I'm calling because ${why}. Is this a good time for two minutes?`;
  const section = [
    "## This call is a callback — read this first",
    "",
    `You are calling ${who} back because ${why}. Your greeting has already been spoken: "${greeting}"`,
    "If it is not a good time, ask when to call back, note it, and close with the standard line.",
    "Do not ask again for anything listed under 'Already known' — confirm it briefly instead, then collect what's missing.",
    "",
    "### Already known",
    b.known.trim() || "Nothing yet — collect everything as on a normal enquiry call.",
    ...(b.ask ? ["", "### The one thing the team most needs", b.ask] : []),
    "",
    "---",
    "",
  ].join("\n");
  return { system_prompt: section + agentPrompt().replace(/^On an inbound call your greeting.*$/m, ""), greeting };
}

export async function triggerCall(input: { phone: string; name: string; brief: CallbackBrief }): Promise<{ callId: string }> {
  const { system_prompt, greeting } = callbackPrompt(input.brief);
  const r = await vaani<{ success?: boolean; output?: { call_id?: string }; error?: string | null; message?: string }>("/api/trigger-call/", {
    method: "POST",
    body: JSON.stringify({
      agent_id: requireEnv("VAANI_AGENT_ID"),
      medium: "telephony",
      contact_number: input.phone,
      name: input.name || "Customer",
      metadata: {},
      ...(env("VAANI_OUTBOUND_NUMBER") ? { outbound_number: env("VAANI_OUTBOUND_NUMBER") } : {}),
      modify_agent: {
        persona: {
          identity: {
            system_prompt,
            greeting_message: { agent_message: greeting, agent_speech_delay: 1, interruptible: true, let_user_speak_first: false },
          },
        },
      },
    }),
  });
  if (r.success === false || !r.output?.call_id) throw new Error(`Vaani didn't start the call: ${r.error ?? r.message ?? "no call id returned"}`);
  return { callId: r.output.call_id };
}

// ---------- agent setup (npm run vaani:setup) ----------

export async function createAgent(name: string): Promise<string> {
  const r = await vaani<{ agent_id: string }>("/api/create-agent", { method: "POST", body: JSON.stringify({ agent_display_name: name, config: {} }) });
  return r.agent_id;
}

export async function updatePersona(agentId: string): Promise<void> {
  await vaani(`/api/agent/${agentId}/persona`, {
    method: "PATCH",
    body: JSON.stringify({
      identity: {
        system_prompt: agentPrompt(),
        greeting_message: { agent_message: INBOUND_GREETING, agent_speech_delay: 1, interruptible: true, let_user_speak_first: false },
      },
      // English, Hindi and Marathi callers: let Vaani detect the language.
      senses_capabilities: { language: "en", auto_detect: true },
    }),
  });
}

export async function updateDeployment(agentId: string, number: string): Promise<void> {
  await vaani(`/api/agent/${agentId}/deployment`, {
    method: "PATCH",
    body: JSON.stringify({ deployment: { phone: { call_type: { Inbound: number, Outbound: [number] } } } }),
  });
}
