"use server";

import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { one, query } from "@/lib/db";
import { startWebSession, type WebSession } from "@/lib/vaani";

const PER_VISITOR_PER_HOUR = 5;
const TOTAL_PER_HOUR = 40;

export type StartResult = { ok: true; session: WebSession } | { ok: false; error: string };

/** Starts a browser voice session with Vaani. Limits keep the page from being used to burn call minutes. */
export async function startVoiceCall(language: "en" | "hi" | "mr"): Promise<StartResult> {
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? h.get("x-real-ip") ?? "unknown").split(",")[0].trim();
  const ipHash = createHash("sha256").update(`aangan:${ip}`).digest("hex").slice(0, 32);

  const [total, mine] = await Promise.all([
    one<{ n: string }>("select count(*) as n from voice_sessions where created_at > now() - interval '1 hour'"),
    one<{ n: string }>("select count(*) as n from voice_sessions where ip_hash = $1 and created_at > now() - interval '1 hour'", [ipHash]),
  ]);
  if (Number(mine?.n ?? 0) >= PER_VISITOR_PER_HOUR) return { ok: false, error: "You've started a few calls already — please try again in a little while." };
  if (Number(total?.n ?? 0) >= TOTAL_PER_HOUR) return { ok: false, error: "Vaani is very busy right now — please try again in a few minutes." };

  try {
    const lang = (["en", "hi", "mr"] as const).includes(language) ? language : "en";
    const session = await startWebSession(lang);
    await query("insert into voice_sessions (room_name, ip_hash) values ($1, $2) on conflict do nothing", [session.roomName, ipHash]);
    return { ok: true, session };
  } catch (e) {
    console.error("startWebSession failed", e);
    return { ok: false, error: "We couldn't connect to Vaani just now. Please try again." };
  }
}
