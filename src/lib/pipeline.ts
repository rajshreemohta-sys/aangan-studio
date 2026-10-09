import { classifyTranscript, type ClassifierResult } from "./classifier";
import type { Classification, Outcome } from "./classification";
import { OUTCOME_LABELS, softUncertainties } from "./classification";
import { appUrl, env, has, NotConfiguredError, numberEnv } from "./env";
import { clientConfirmation, clientRejection, designerHandoff, escalationAlert } from "./emails";
import { createEvent, freeBusy } from "./google-calendar";
import { isAfterHours } from "./hours";
import { resendCostPerEmail, sendEmail, type Email } from "./resend";
import { findSlot, parsePreference, type Slot } from "./slots";
import { json, one, query } from "./db";
import type { CallRow, DesignerRow, DispatchRow, LeadRow } from "./database.types";
import { briefFromLead, dispatchCall, DispatchError } from "./dispatch";
import { telephonyEnabled } from "./vaani";

/**
 * After a call: classify → store → route by outcome → log every cost.
 * Each external step is independent: one failing (or not configured) is recorded on the
 * lead's `routing` log and the rest still run. Anything a person must act on lands in the
 * dashboard's follow-up queue.
 */

export type StepStatus = "ok" | "skipped" | "failed";
export type Step = { step: string; status: StepStatus; detail: string; at: string };

export type CallInput = {
  vaaniCallId?: string | null;
  source: "vaani" | "simulated" | "seed";
  direction?: "inbound" | "outbound";
  callerPhone?: string | null;
  transcript: string;
  summary?: string | null;
  durationSeconds: number;
  startedAt: Date;
  enquiryAt?: Date;
  escalationFlag?: boolean;
  recordingUrl?: string | null;
  rawPayload?: unknown;
  channel?: "phone" | "web";
};

export type PipelineOptions = {
  /** Skip calendar and email (used for seeding and demos). Costs for the call itself are still logged. */
  dryRun?: boolean;
  /** Reuse a classification already computed (seeding from eval results). */
  precomputed?: ClassifierResult;
  now?: Date;
};

export async function insertCall(input: CallInput): Promise<{ id: string; duplicate: boolean }> {
  if (input.vaaniCallId) {
    const existing = await one<{ id: string }>("select id from calls where vaani_call_id = $1", [input.vaaniCallId]);
    if (existing) return { id: existing.id, duplicate: true };
  }
  const row = await one<{ id: string }>(
    `insert into calls (vaani_call_id, source, direction, caller_phone, raw_transcript, summary, duration_seconds,
       started_at, enquiry_at, after_hours, escalation_flag, recording_url, raw_payload, created_at, channel)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$8,$14)
     on conflict (vaani_call_id) do nothing
     returning id`,
    [
      input.vaaniCallId ?? null,
      input.source,
      input.direction ?? "inbound",
      input.callerPhone ?? null,
      input.transcript,
      input.summary ?? null,
      input.durationSeconds,
      input.startedAt.toISOString(),
      (input.enquiryAt ?? input.startedAt).toISOString(),
      isAfterHours(input.startedAt),
      input.escalationFlag ?? false,
      input.recordingUrl ?? null,
      json(input.rawPayload ?? null),
      input.channel ?? "phone",
    ],
  );
  if (!row) {
    // Lost a race with a duplicate webhook delivery.
    const existing = await one<{ id: string }>("select id from calls where vaani_call_id = $1", [input.vaaniCallId]);
    return { id: existing!.id, duplicate: true };
  }
  return { id: row.id, duplicate: false };
}

async function logCost(callId: string, source: string, units: number, unitLabel: string, amountInr: number, at: Date, detail?: unknown) {
  await query("insert into costs (call_id, source, units, unit_label, amount_inr, detail, created_at) values ($1,$2,$3,$4,$5,$6::jsonb,$7)", [
    callId,
    source,
    units,
    unitLabel,
    amountInr,
    json(detail ?? null),
    at.toISOString(),
  ]);
}

/** What the front desk needs to do, if anything. */
function followUpFor(c: Classification, booked: boolean): string | null {
  const unclear = c.criteria.filter((x) => x.verdict !== "pass").map((x) => `${x.id}: ${x.verdict} — ${x.note}`);
  const ask = c.clarifying_question ? ` Ask: ${c.clarifying_question}` : "";
  switch (c.outcome) {
    case "ESCALATED":
      return `Senior callback needed now — ${c.reason_detail}`;
    case "HUMAN_REVIEW":
      return `Call back to clarify.${ask}${unclear.length ? ` Unclear: ${unclear.join("; ")}` : ""}`;
    case "INCOMPLETE":
      return `Call back — the call ended before we had the details.${ask}`;
    case "QUALIFIED":
      return booked ? null : "Qualified, but not booked — call to agree a consultation time.";
    case "REJECTED":
      return c.handoff.email ? null : "Not a fit, and no email collected — call to close politely.";
    default:
      return null;
  }
}

export async function processCall(callId: string, opts: PipelineOptions = {}): Promise<{ leadId: string; outcome: Outcome; steps: Step[] }> {
  const now = opts.now ?? new Date();
  const call = await one<CallRow>("select * from calls where id = $1", [callId]);
  if (!call) throw new Error(`Call ${callId} not found`);
  await query("update calls set status = 'processing', error = null where id = $1", [callId]);
  const startedAt = new Date(call.started_at);
  const costAt = call.source === "seed" ? startedAt : now;

  const steps: Step[] = [];
  const record = (step: string, status: StepStatus, detail: string) => steps.push({ step, status, detail, at: new Date().toISOString() });
  const attempt = async (step: string, fn: () => Promise<string>) => {
    if (opts.dryRun) return record(step, "skipped", "dry run — nothing sent");
    try {
      record(step, "ok", await fn());
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      record(step, e instanceof NotConfiguredError ? "skipped" : "failed", msg);
    }
  };

  try {
    // ---- cost of the call itself
    const minutes = call.duration_seconds / 60;
    await logCost(callId, "vaani", Number(minutes.toFixed(2)), "minutes", minutes * numberEnv("VAANI_RATE_PER_MIN", 6), costAt);

    // ---- classify
    const result = opts.precomputed ?? (await classifyTranscript(call.raw_transcript, startedAt));
    const c = result.classification;
    await logCost(callId, "gemini", result.usage.inputTokens + result.usage.outputTokens, "tokens", result.usage.costInr, costAt, result.usage);
    if (call.escalation_flag && c.outcome !== "ESCALATED") c.flags.push("Vaani flagged this call during the conversation (caller upset or asked for a person).");

    const h = c.handoff;
    const phone = h.phone || call.caller_phone || "";
    const lead = await one<{ id: string }>(
      `insert into leads (call_id, outcome, reason_code, reason_detail, model_outcome, confidence, criteria, flags, missing_fields,
         clarifying_question, client_reason, summary, language, name, phone, email, locality, property_type, bhk, carpet_area,
         scope, execution_or_advice, completion_date, ownership, decision_maker, budget_volunteered, consultation_preference,
         visit_type, lead_source, created_at)
       values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30)
       on conflict (call_id) do update set
         outcome = excluded.outcome, reason_code = excluded.reason_code, reason_detail = excluded.reason_detail,
         model_outcome = excluded.model_outcome, confidence = excluded.confidence, criteria = excluded.criteria,
         flags = excluded.flags, missing_fields = excluded.missing_fields, clarifying_question = excluded.clarifying_question,
         client_reason = excluded.client_reason, summary = excluded.summary, language = excluded.language, name = excluded.name,
         phone = excluded.phone, email = excluded.email, locality = excluded.locality, property_type = excluded.property_type,
         bhk = excluded.bhk, carpet_area = excluded.carpet_area, scope = excluded.scope,
         execution_or_advice = excluded.execution_or_advice, completion_date = excluded.completion_date,
         ownership = excluded.ownership, decision_maker = excluded.decision_maker,
         budget_volunteered = excluded.budget_volunteered, consultation_preference = excluded.consultation_preference,
         visit_type = excluded.visit_type, lead_source = excluded.lead_source
       returning id`,
      [
        callId, c.outcome, c.reason_code, c.reason_detail, result.modelOutcome, c.confidence,
        json(c.criteria), json(c.flags), json(c.missing_fields), c.clarifying_question, c.client_reason, c.summary, c.language,
        h.name, phone, h.email, h.locality, h.property_type, h.bhk, h.carpet_area, h.scope, h.execution_or_advice,
        h.completion_date, h.ownership, h.decision_maker, h.budget_volunteered, h.consultation_preference, h.visit_type, h.source,
        (call.source === "seed" ? startedAt : now).toISOString(),
      ],
    );
    const leadId = lead!.id;

    const transcriptUrl = `${appUrl()}/dashboard/calls/${callId}`;
    const emailsSent: string[] = [];
    const send = async (email: Email, to: string, label: string) => {
      await sendEmail({ ...email, to });
      emailsSent.push(label);
      await logCost(callId, "resend", 1, "emails", resendCostPerEmail(), costAt, { label });
      return `${label} → ${to}`;
    };

    // ---- route by outcome
    let booking = null as Slot | null;

    if (c.outcome === "QUALIFIED") {
      if (opts.dryRun) {
        booking = await simulateBooking(leadId, c, startedAt);
        record("calendar", "skipped", booking ? "dry run — slot reserved in the database only" : "dry run — no designers configured");
      } else {
        await attempt("calendar", async () => {
          booking = await bookConsultation(leadId, c, now, transcriptUrl);
          if (!booking) throw new Error("No free slot matching the client's preference in the next 7 working days — added to follow-ups");
          return `Booked ${booking.start.toISOString()} with designer ${booking.designerId}`;
        });
        if (booking) {
          const b: Slot = booking;
          const designer = (await one<DesignerRow>("select * from designers where id = $1", [b.designerId]))!;
          const event = await one<{ calendar_event_url: string | null }>("select calendar_event_url from bookings where lead_id = $1", [leadId]);
          await attempt("email:designer", () =>
            send(designerHandoff(c, { slotStart: b.start, designerName: designer.name, transcriptUrl, calendarUrl: event?.calendar_event_url, callStartedAt: startedAt }), designer.email, "designer handoff"),
          );
          if (h.email) await attempt("email:client", () => send(clientConfirmation(c, { slotStart: b.start, designerName: designer.name }), h.email, "client confirmation"));
          else record("email:client", "skipped", "no client email collected");
        }
      }
    }

    if (c.outcome === "REJECTED") {
      if (h.email) await attempt("email:client", () => send(clientRejection(c), h.email, "warm decline"));
      else record("email:client", "skipped", "no client email collected — added to follow-ups");
    }

    if (c.outcome === "ESCALATED") {
      await attempt("email:escalation", async () => {
        const to = env("ESCALATION_EMAIL");
        if (!to) throw new NotConfiguredError("Missing environment variable: ESCALATION_EMAIL");
        return send(escalationAlert(c, { transcriptUrl, callerPhone: call.caller_phone, callStartedAt: startedAt }), to, "escalation alert");
      });
    }

    // ---- Vaani callbacks
    if (!opts.dryRun) {
      // A callback we placed about an earlier lead resolves that lead's follow-up.
      const origin = call.vaani_call_id ? await one<DispatchRow>("select * from dispatches where vaani_call_id = $1", [call.vaani_call_id]) : null;
      if (origin) await query("update dispatches set status = 'completed' where id = $1", [origin.id]);
      if (origin?.lead_id && origin.lead_id !== leadId && c.outcome !== "INCOMPLETE") {
        await query(
          "update leads set follow_up_status = 'done', follow_up_note = $2, follow_up_done_at = now() where id = $1 and follow_up_status = 'open'",
          [origin.lead_id, `Vaani called back — ${OUTCOME_LABELS[c.outcome].toLowerCase()} (see the newer call)`],
        );
        record("follow-up", "ok", "closed the earlier follow-up this callback was for");
      }
      // A dropped inbound call gets an automatic callback.
      if (c.outcome === "INCOMPLETE" && call.direction === "inbound" && phone && telephonyEnabled()) {
        try {
          const saved = (await one<LeadRow>("select * from leads where id = $1", [leadId]))!;
          const d = await dispatchCall({ reason: "dropped_call", phone, name: h.name || null, leadId, sourceCallId: callId, brief: briefFromLead(saved), automatic: true });
          record("auto-callback", "ok", `Vaani is calling ${d.phone} back`);
        } catch (e) {
          record("auto-callback", e instanceof DispatchError ? "skipped" : "failed", e instanceof Error ? e.message : String(e));
        }
      }
    }

    // ---- follow-up queue on the dashboard
    const followUp = followUpFor(c, !!booking);
    if (followUp) record("follow-up", "ok", followUp);
    await query(
      `update leads set routing = $2::jsonb, follow_up_status = $3, follow_up_reason = $4,
         follow_up_done_at = case when $3 = 'open' then null else follow_up_done_at end
       where id = $1`,
      [leadId, json({ steps, emails: emailsSent, soft_uncertainties: softUncertainties(c.criteria) }), followUp ? "open" : "none", followUp],
    );
    await query("update calls set status = 'done', summary = $2 where id = $1", [callId, c.summary]);
    return { leadId, outcome: c.outcome, steps };
  } catch (e) {
    await query("update calls set status = 'failed', error = $2 where id = $1", [callId, e instanceof Error ? e.message : String(e)]);
    throw e;
  }
}

// ---------- booking ----------

const activeDesigners = () => query<DesignerRow>("select * from designers where active");

async function saveBooking(leadId: string, slot: Slot, visitType: string, status: "booked" | "simulated", event?: { id: string; htmlLink: string }, createdAt?: Date) {
  await query(
    `insert into bookings (lead_id, designer_id, starts_at, ends_at, visit_type, calendar_event_id, calendar_event_url, status, created_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     on conflict (lead_id) do update set designer_id = excluded.designer_id, starts_at = excluded.starts_at, ends_at = excluded.ends_at,
       visit_type = excluded.visit_type, calendar_event_id = excluded.calendar_event_id, calendar_event_url = excluded.calendar_event_url,
       status = excluded.status`,
    [leadId, slot.designerId, slot.start.toISOString(), slot.end.toISOString(), visitType, event?.id ?? null, event?.htmlLink ?? null, status, (createdAt ?? new Date()).toISOString()],
  );
  await query("update designers set last_assigned_at = $2 where id = $1", [slot.designerId, (createdAt ?? new Date()).toISOString()]);
}

async function bookConsultation(leadId: string, c: Classification, now: Date, transcriptUrl: string): Promise<Slot | null> {
  if (!has("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN")) throw new NotConfiguredError("Google Calendar is not configured");
  const designers = await activeDesigners();
  if (!designers.length) throw new Error("No active designers in the designers table");

  const horizon = new Date(now.getTime() + 14 * 86_400_000);
  const busy = await freeBusy(designers.map((d) => d.calendar_id), now, horizon);
  const slot = findSlot(
    designers.map((d) => ({ id: d.id, lastAssignedAt: d.last_assigned_at ? new Date(d.last_assigned_at) : null, busy: busy[d.calendar_id] ?? [] })),
    parsePreference(c.handoff.consultation_preference),
    now,
  );
  if (!slot) return null;

  const designer = designers.find((d) => d.id === slot.designerId)!;
  const h = c.handoff;
  const attendees = [{ email: designer.email, displayName: designer.name }];
  if (h.email) attendees.push({ email: h.email, displayName: h.name || "Client" });
  const event = await createEvent({
    calendarId: designer.calendar_id,
    summary: `Aangan consultation — ${h.name || "Client"}, ${h.locality || "Pune"} ${h.bhk || ""}`.trim(),
    description: `${c.summary}\n\nPhone: ${h.phone || "—"}\nScope: ${h.scope || "—"}\nVisit: ${h.visit_type || "—"}\n\nTranscript: ${transcriptUrl}`,
    location: /studio/i.test(h.visit_type) ? "Aangan Studio" : h.locality ? `${h.locality}, Pune` : "",
    start: slot.start,
    end: slot.end,
    attendees,
  });
  await saveBooking(leadId, slot, h.visit_type, "booked", event, now);
  return slot;
}

/** Dry run: picks a slot against bookings already in the database instead of Google Calendar. */
async function simulateBooking(leadId: string, c: Classification, startedAt: Date): Promise<Slot | null> {
  const designers = await activeDesigners();
  if (!designers.length) return null;
  const existing = await query<{ designer_id: string; starts_at: string; ends_at: string }>("select designer_id, starts_at, ends_at from bookings where status <> 'cancelled'");
  const slot = findSlot(
    designers.map((d) => ({
      id: d.id,
      lastAssignedAt: d.last_assigned_at ? new Date(d.last_assigned_at) : null,
      busy: existing.filter((b) => b.designer_id === d.id).map((b) => ({ start: new Date(b.starts_at), end: new Date(b.ends_at) })),
    })),
    parsePreference(c.handoff.consultation_preference),
    startedAt,
  );
  if (!slot) return null;
  await saveBooking(leadId, slot, c.handoff.visit_type, "simulated", undefined, startedAt);
  return slot;
}
