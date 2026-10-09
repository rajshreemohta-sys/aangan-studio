"use server";

import { revalidatePath } from "next/cache";
import type { LeadRow } from "@/lib/database.types";
import { one, query } from "@/lib/db";
import { briefFromLead, dispatchCall } from "@/lib/dispatch";

/** Front desk closes a follow-up, with an optional note on what happened. */
export async function completeFollowUp(form: FormData) {
  const leadId = String(form.get("lead_id") ?? "");
  const note = String(form.get("note") ?? "").trim().slice(0, 2000) || null;
  if (!/^[0-9a-f-]{36}$/i.test(leadId)) return;
  await query("update leads set follow_up_status = 'done', follow_up_note = $2, follow_up_done_at = now() where id = $1", [leadId, note]);
  revalidatePath("/dashboard", "layout");
}

export async function reopenFollowUp(form: FormData) {
  const leadId = String(form.get("lead_id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(leadId)) return;
  await query("update leads set follow_up_status = 'open', follow_up_done_at = null where id = $1", [leadId]);
  revalidatePath("/dashboard", "layout");
}

export type CallState = { message?: string; error?: string };

/** "Call with Vaani": Vaani rings the caller to collect what's still missing. */
export async function callWithVaani(_prev: CallState, form: FormData): Promise<CallState> {
  const leadId = String(form.get("lead_id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(leadId)) return { error: "Unknown lead." };
  const lead = await one<LeadRow>("select * from leads where id = $1", [leadId]);
  if (!lead?.phone) return { error: "No phone number on file for this caller." };
  try {
    await dispatchCall({ reason: "follow_up", phone: lead.phone, name: lead.name, email: lead.email, leadId, brief: briefFromLead(lead), automatic: false });
    revalidatePath("/dashboard", "layout");
    return { message: "Vaani is calling now." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
