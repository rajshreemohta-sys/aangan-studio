import { recentContacts } from "./hubspot";
import { db } from "./supabase";
import { startOutboundCall } from "./vaani";

/**
 * New HubSpot contact → Vaani calls them back. Runs every minute (Supabase pg_cron),
 * looks back 10 minutes, and never dials the same contact twice.
 */

const LOOKBACK_MINUTES = 10;

export type PollResult = { checked: number; dialled: string[]; skipped: { id: string; why: string }[]; failed: { id: string; error: string }[] };

export async function pollNewContacts(now = new Date()): Promise<PollResult> {
  const contacts = await recentContacts(new Date(now.getTime() - LOOKBACK_MINUTES * 60_000));
  const result: PollResult = { checked: contacts.length, dialled: [], skipped: [], failed: [] };
  if (!contacts.length) return result;

  const seen = await db().from("callbacks").select("hubspot_contact_id").in("hubspot_contact_id", contacts.map((c) => c.id));
  const already = new Set((seen.data ?? []).map((r) => r.hubspot_contact_id as string));

  for (const contact of contacts) {
    if (already.has(contact.id)) continue;
    const p = contact.properties;
    const phone = (p.phone || p.mobilephone || "").replace(/[^\d+]/g, "");
    const name = [p.firstname, p.lastname].filter(Boolean).join(" ");

    // Claim the contact first; the primary key makes concurrent poll runs safe.
    const claim = await db().from("callbacks").insert({ hubspot_contact_id: contact.id, phone, contact_created_at: p.createdate, status: "queued" });
    if (claim.error) continue;

    if (!phone) {
      await db().from("callbacks").update({ status: "skipped", detail: "no phone number" }).eq("hubspot_contact_id", contact.id);
      result.skipped.push({ id: contact.id, why: "no phone number" });
      continue;
    }
    // Someone who just called us gets a contact created by our own pipeline — don't ring them back.
    const recentCall = await db().from("calls").select("id").eq("caller_phone", phone).gte("started_at", new Date(now.getTime() - 60 * 60_000).toISOString()).limit(1);
    if (recentCall.data?.length) {
      await db().from("callbacks").update({ status: "skipped", detail: "spoke to Vaani in the last hour" }).eq("hubspot_contact_id", contact.id);
      result.skipped.push({ id: contact.id, why: "recent call" });
      continue;
    }

    try {
      const { callId } = await startOutboundCall(phone, { caller_name: name || "there", hubspot_contact_id: contact.id, enquiry_at: p.createdate ?? now.toISOString() });
      await db().from("callbacks").update({ status: "dialled", vaani_call_id: callId }).eq("hubspot_contact_id", contact.id);
      result.dialled.push(contact.id);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      await db().from("callbacks").update({ status: "failed", detail: error.slice(0, 500) }).eq("hubspot_contact_id", contact.id);
      result.failed.push({ id: contact.id, error });
    }
  }
  return result;
}

/** For outbound calls, the enquiry time is when the contact landed in HubSpot. */
export async function enquiryTimeFor(hubspotContactId: string | null): Promise<Date | null> {
  if (!hubspotContactId) return null;
  const r = await db().from("callbacks").select("contact_created_at").eq("hubspot_contact_id", hubspotContactId).maybeSingle();
  return r.data?.contact_created_at ? new Date(r.data.contact_created_at) : null;
}
