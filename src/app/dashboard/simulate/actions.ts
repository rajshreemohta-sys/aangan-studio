"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isValidSession, SESSION_COOKIE } from "@/lib/auth";
import { insertCall, processCall } from "@/lib/pipeline";

export type SimulateState = { error?: string };

/** Runs a pasted transcript through the exact pipeline a real Vaani call takes. */
export async function simulateCall(_prev: SimulateState, form: FormData): Promise<SimulateState> {
  if (!(await isValidSession((await cookies()).get(SESSION_COOKIE)?.value))) return { error: "Your session expired — log in again." };

  const transcript = String(form.get("transcript") ?? "").replace(/\r\n?/g, "\n").trim();
  if (transcript.length < 40) return { error: "Paste a transcript of at least a few lines." };
  if (transcript.length > 30_000) return { error: "That transcript is too long (30,000 characters max)." };

  const when = String(form.get("started_at") ?? "");
  const startedAt = when ? new Date(`${when}:00+05:30`) : new Date();
  if (Number.isNaN(startedAt.getTime())) return { error: "That date and time didn't parse." };
  const minutes = Number(form.get("duration_minutes") ?? 4);
  const phone = String(form.get("caller_phone") ?? "").trim() || null;
  const dryRun = form.get("dry_run") === "on";

  let callId: string;
  try {
    ({ id: callId } = await insertCall({
      source: "simulated",
      transcript,
      durationSeconds: Math.max(0, Math.round((Number.isFinite(minutes) ? minutes : 4) * 60)),
      startedAt,
      callerPhone: phone,
    }));
    await processCall(callId, { dryRun });
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  redirect(`/dashboard/calls/${callId}`);
}
