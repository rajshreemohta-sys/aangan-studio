"use server";

import { DispatchError } from "@/lib/dispatch";
import { handleWebEnquiry } from "@/lib/enquiry";

export type EnquiryState = { ok?: boolean; error?: string };

export async function submitEnquiry(_prev: EnquiryState, form: FormData): Promise<EnquiryState> {
  // Honeypot: real people never see or fill this field.
  if (String(form.get("website") ?? "")) return { ok: true };
  try {
    await handleWebEnquiry({
      name: String(form.get("name") ?? ""),
      phone: String(form.get("phone") ?? ""),
      email: String(form.get("email") ?? ""),
      locality: String(form.get("locality") ?? ""),
      message: String(form.get("message") ?? ""),
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof DispatchError && /already called/.test(e.message)) return { ok: true };
    return { error: e instanceof DispatchError ? "We couldn't place the call just now — the studio will call you back." : e instanceof Error ? e.message : "Something went wrong." };
  }
}
