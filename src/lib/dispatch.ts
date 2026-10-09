import type { DispatchReason, DispatchRow, LeadRow } from "./database.types";
import { one, query } from "./db";
import { has } from "./env";
import { telephonyEnabled, triggerCall, type CallbackBrief } from "./vaani";

/**
 * Outbound calls Vaani makes for us. Guards keep a bug or a spammed form from
 * running up a phone bill: one automatic call per number per day, and a cap per hour.
 */

const MAX_DISPATCHES_PER_HOUR = 20;
const AUTO_COOLDOWN_HOURS = 24;

export class DispatchError extends Error {}

/** Indian numbers to E.164; anything else must already carry a country code. */
export function normalisePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^\d+]/g, "");
  if (/^\+\d{10,15}$/.test(digits)) return digits;
  const d = digits.replace(/^\+/, "");
  if (/^[6-9]\d{9}$/.test(d)) return `+91${d}`;
  if (/^0[6-9]\d{9}$/.test(d)) return `+91${d.slice(1)}`;
  if (/^91[6-9]\d{9}$/.test(d)) return `+${d}`;
  return null;
}

export type DispatchInput = {
  reason: DispatchReason;
  phone: string;
  name?: string | null;
  email?: string | null;
  notes?: string | null;
  leadId?: string | null;
  sourceCallId?: string | null;
  enquiryAt?: Date;
  brief: Omit<CallbackBrief, "reason" | "name">;
  /** Automatic triggers respect the per-number cooldown; a person pressing the button doesn't. */
  automatic: boolean;
};

export async function dispatchCall(input: DispatchInput): Promise<DispatchRow> {
  if (!has("VAANI_API_KEY", "VAANI_AGENT_ID")) throw new DispatchError("Vaani isn't connected yet (VAANI_API_KEY / VAANI_AGENT_ID missing).");
  if (!telephonyEnabled()) throw new DispatchError("Phone calls are off — Vaani has no phone number yet (set VAANI_TELEPHONY=on once it does).");
  const phone = normalisePhone(input.phone);
  if (!phone) throw new DispatchError(`"${input.phone}" isn't a phone number Vaani can dial.`);

  const lastHour = await one<{ n: string }>("select count(*) as n from dispatches where created_at > now() - interval '1 hour'");
  if (Number(lastHour?.n ?? 0) >= MAX_DISPATCHES_PER_HOUR) throw new DispatchError("Hourly call limit reached — try again shortly.");

  if (input.automatic) {
    const recent = await one<{ id: string }>(
      `select id from dispatches where phone = $1 and created_at > now() - make_interval(hours => $2) and status <> 'failed' limit 1`,
      [phone, AUTO_COOLDOWN_HOURS],
    );
    if (recent) throw new DispatchError("Vaani already called this number in the last 24 hours.");
  } else {
    const inFlight = await one<{ id: string }>("select id from dispatches where phone = $1 and status in ('queued','dialling') and created_at > now() - interval '15 minutes' limit 1", [phone]);
    if (inFlight) throw new DispatchError("Vaani is already calling this number.");
  }

  const row = await one<DispatchRow>(
    `insert into dispatches (reason, phone, name, email, notes, lead_id, source_call_id, enquiry_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8)
     on conflict (source_call_id) do nothing
     returning *`,
    [input.reason, phone, input.name ?? null, input.email ?? null, input.notes ?? null, input.leadId ?? null, input.sourceCallId ?? null, (input.enquiryAt ?? new Date()).toISOString()],
  );
  if (!row) throw new DispatchError("A callback for this call was already placed.");

  try {
    const { callId } = await triggerCall({ phone, name: input.name ?? "", brief: { ...input.brief, reason: input.reason, name: input.name ?? null } });
    return (await one<DispatchRow>("update dispatches set status = 'dialling', vaani_call_id = $2 where id = $1 returning *", [row.id, callId]))!;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await query("update dispatches set status = 'failed', error = $2 where id = $1", [row.id, msg.slice(0, 1000)]);
    throw new DispatchError(msg);
  }
}

/** What Vaani should already know when calling back about an existing lead. */
export function briefFromLead(lead: LeadRow): { known: string; ask: string | null } {
  const facts: [string, string | null][] = [
    ["Name", lead.name],
    ["Email", lead.email],
    ["Locality", lead.locality],
    ["Property", [lead.property_type, lead.bhk].filter(Boolean).join(", ")],
    ["Carpet area", lead.carpet_area],
    ["Scope", lead.scope],
    ["Execution or advice", lead.execution_or_advice],
    ["Completion needed by", lead.completion_date],
    ["Owned or rented", lead.ownership],
    ["Decision-maker", lead.decision_maker],
    ["Consultation preference", lead.consultation_preference],
    ["Site visit or studio", lead.visit_type],
  ];
  const known = facts.filter(([, v]) => v && v.trim()).map(([k, v]) => `- ${k}: ${v}`).join("\n");
  return { known: [lead.summary ? `Last call summary: ${lead.summary}` : "", known].filter(Boolean).join("\n"), ask: lead.clarifying_question || null };
}
