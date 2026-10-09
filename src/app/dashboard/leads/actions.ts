"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { isValidSession, SESSION_COOKIE } from "@/lib/auth";
import { query } from "@/lib/db";

async function requireSession() {
  if (!(await isValidSession((await cookies()).get(SESSION_COOKIE)?.value))) throw new Error("Your session expired — log in again.");
}

/** Front desk closes a follow-up, with an optional note on what happened. */
export async function completeFollowUp(form: FormData) {
  await requireSession();
  const leadId = String(form.get("lead_id") ?? "");
  const note = String(form.get("note") ?? "").trim().slice(0, 2000) || null;
  if (!/^[0-9a-f-]{36}$/i.test(leadId)) return;
  await query("update leads set follow_up_status = 'done', follow_up_note = $2, follow_up_done_at = now() where id = $1", [leadId, note]);
  revalidatePath("/dashboard", "layout");
}

export async function reopenFollowUp(form: FormData) {
  await requireSession();
  const leadId = String(form.get("lead_id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(leadId)) return;
  await query("update leads set follow_up_status = 'open', follow_up_done_at = null where id = $1", [leadId]);
  revalidatePath("/dashboard", "layout");
}
