import { classifyTranscript, type ClassifierResult } from "./classifier";
import type { Classification, Outcome } from "./classification";
import { softUncertainties, OUTCOME_LABELS } from "./classification";
import { appUrl, env, has, NotConfiguredError, numberEnv } from "./env";
import { clientConfirmation, clientRejection, designerHandoff, escalationAlert } from "./emails";
import { createEvent, freeBusy } from "./google-calendar";
import { isAfterHours } from "./hours";
import { createTask, upsertContact, upsertDeal } from "./hubspot";
import { resendCostPerEmail, sendEmail, type Email } from "./resend";
import { findSlot, parsePreference, type Slot } from "./slots";
import { db, must } from "./supabase";
import { transcriptSignature } from "./auth";
import type { CallRow, DesignerRow, Json } from "./database.types";

/**
 * After a call: classify → store → route by outcome → sync HubSpot → log every cost.
 * Each external step is independent: one failing (or not configured) is recorded on the
 * lead's `routing` log and the rest still run.
 */

export type StepStatus = "ok" | "skipped" | "failed";
export type Step = { step: string; status: StepStatus; detail: string; at: string };

export type CallInput = {
  vaaniCallId?: string | null;
  source: "vaani" | "simulated" | "seed";
  direction?: "inbound" | "outbound";
  callerPhone?: string | null;
  hubspotContactId?: string | null;
  transcript: string;
  summary?: string | null;
  durationSeconds: number;
  startedAt: Date;
  enquiryAt?: Date;
  escalationFlag?: boolean;
  recordingUrl?: string | null;
  rawPayload?: unknown;
};

export type PipelineOptions = {
  /** Skip calendar, email and HubSpot (used for seeding). Costs for the call itself are still logged. */
  dryRun?: boolean;
  /** Reuse a classification already computed (seeding from eval results). */
  precomputed?: ClassifierResult;
  now?: Date;
};

export async function insertCall(input: CallInput): Promise<{ id: string; duplicate: boolean }> {
  const row = {
    vaani_call_id: input.vaaniCallId ?? null,
    source: input.source,
    direction: input.direction ?? "inbound",
    caller_phone: input.callerPhone ?? null,
    hubspot_contact_id: input.hubspotContactId ?? null,
    raw_transcript: input.transcript,
    summary: input.summary ?? null,
    duration_seconds: input.durationSeconds,
    started_at: input.startedAt.toISOString(),
    enquiry_at: (input.enquiryAt ?? input.startedAt).toISOString(),
    after_hours: isAfterHours(input.startedAt),
    escalation_flag: input.escalationFlag ?? false,
    recording_url: input.recordingUrl ?? null,
    raw_payload: (input.rawPayload ?? null) as Json,
    created_at: input.startedAt.toISOString(),
  };
  if (input.vaaniCallId) {
    const existing = await db().from("calls").select("id").eq("vaani_call_id", input.vaaniCallId).maybeSingle();
    if (existing.data) return { id: existing.data.id, duplicate: true };
  }
  const inserted = must(await db().from("calls").insert(row).select("id").single(), "insert call");
  return { id: inserted.id, duplicate: false };
}

async function logCost(callId: string, source: string, units: number, unitLabel: string, amountInr: number, at: Date, detail?: unknown) {
  await db().from("costs").insert({ call_id: callId, source, units, unit_label: unitLabel, amount_inr: amountInr, detail: detail ?? null, created_at: at.toISOString() });
}

export async function processCall(callId: string, opts: PipelineOptions = {}): Promise<{ leadId: string; outcome: Outcome; steps: Step[] }> {
  const now = opts.now ?? new Date();
  const call = must(await db().from("calls").select("*").eq("id", callId).single(), "load call") as CallRow;
  await db().from("calls").update({ status: "processing", error: null }).eq("id", callId);
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
    // ---- costs of the call itself
    const minutes = call.duration_seconds / 60;
    await logCost(callId, "vaani", Number(minutes.toFixed(2)), "minutes", minutes * numberEnv("VAANI_RATE_PER_MIN", 6), costAt);

    // ---- classify
    const result = opts.precomputed ?? (await classifyTranscript(call.raw_transcript, startedAt));
    const c = result.classification;
    await logCost(callId, "gemini", result.usage.inputTokens + result.usage.outputTokens, "tokens", result.usage.costInr, costAt, result.usage);
    if (call.escalation_flag && c.outcome !== "ESCALATED") c.flags.push("Vaani flagged this call during the conversation (caller upset or asked for a person).");

    const phone = c.handoff.phone || call.caller_phone || "";
    const lead = must(
      await db()
        .from("leads")
        .upsert(
          {
            call_id: callId,
            outcome: c.outcome,
            reason_code: c.reason_code,
            reason_detail: c.reason_detail,
            model_outcome: result.modelOutcome,
            confidence: c.confidence,
            criteria: c.criteria,
            flags: c.flags,
            missing_fields: c.missing_fields,
            clarifying_question: c.clarifying_question,
            client_reason: c.client_reason,
            summary: c.summary,
            language: c.language,
            name: c.handoff.name,
            phone,
            email: c.handoff.email,
            locality: c.handoff.locality,
            property_type: c.handoff.property_type,
            bhk: c.handoff.bhk,
            carpet_area: c.handoff.carpet_area,
            scope: c.handoff.scope,
            execution_or_advice: c.handoff.execution_or_advice,
            completion_date: c.handoff.completion_date,
            ownership: c.handoff.ownership,
            decision_maker: c.handoff.decision_maker,
            budget_volunteered: c.handoff.budget_volunteered,
            consultation_preference: c.handoff.consultation_preference,
            visit_type: c.handoff.visit_type,
            lead_source: c.handoff.source,
            hubspot_contact_id: call.hubspot_contact_id,
            created_at: call.source === "seed" ? startedAt.toISOString() : now.toISOString(),
          },
          { onConflict: "call_id" },
        )
        .select("id, hubspot_deal_id")
        .single(),
      "save lead",
    );

    const transcriptUrl = `${appUrl()}/t/${callId}?sig=${await transcriptSignature(callId)}`;
    const emailsSent: string[] = [];
    const send = async (email: Email, to: string, label: string) => {
      await sendEmail({ ...email, to });
      emailsSent.push(label);
      await logCost(callId, "resend", 1, "emails", resendCostPerEmail(), costAt, { label });
      return `${label} → ${to}`;
    };

    // ---- route by outcome
    let booking = null as Slot | null;
    let hubspotContactId: string | null = call.hubspot_contact_id;

    if (c.outcome === "QUALIFIED") {
      if (opts.dryRun) {
        booking = await simulateBooking(lead.id, c, startedAt);
        record("calendar", "skipped", booking ? "dry run — slot reserved in Supabase only" : "dry run — no designers configured");
      } else {
        await attempt("calendar", async () => {
          booking = await bookConsultation(lead.id, c, now, transcriptUrl);
          if (!booking) throw new Error("No free slot matching the client's preference in the next 7 working days — front-desk task created instead");
          return `Booked ${booking.start.toISOString()} with designer ${booking.designerId}`;
        });
        if (booking) {
          const b: Slot = booking;
          const designer = must(await db().from("designers").select("name, email").eq("id", b.designerId).single(), "load designer");
          const event = await db().from("bookings").select("calendar_event_url").eq("lead_id", lead.id).maybeSingle();
          await attempt("email:designer", () =>
            send({ ...designerHandoff(c, { slotStart: b.start, designerName: designer.name, transcriptUrl, calendarUrl: event.data?.calendar_event_url, callStartedAt: startedAt }) }, designer.email, "designer handoff"),
          );
          if (c.handoff.email) await attempt("email:client", () => send(clientConfirmation(c, { slotStart: b.start, designerName: designer.name }), c.handoff.email, "client confirmation"));
          else record("email:client", "skipped", "no client email collected");
        }
      }
    }

    if (c.outcome === "REJECTED") {
      if (c.handoff.email) await attempt("email:client", () => send(clientRejection(c), c.handoff.email, "warm decline"));
      else record("email:client", "skipped", "no client email collected — decline goes via HubSpot task");
    }

    if (c.outcome === "ESCALATED") {
      await attempt("email:escalation", async () => {
        const to = env("ESCALATION_EMAIL");
        if (!to) throw new NotConfiguredError("Missing environment variable: ESCALATION_EMAIL");
        return send(escalationAlert(c, { transcriptUrl, callerPhone: call.caller_phone, callStartedAt: startedAt }), to, "escalation alert");
      });
    }

    // ---- HubSpot: always upsert contact + deal; tasks where a human must act
    await attempt("hubspot:contact", async () => {
      const r = await upsertContact({ name: c.handoff.name || "Unknown caller", email: c.handoff.email, phone, locality: c.handoff.locality, source: c.handoff.source });
      hubspotContactId = r.id;
      // Our own contacts must never trigger the 5-minute callback poller.
      await db().from("callbacks").upsert({ hubspot_contact_id: r.id, phone, status: "skipped", detail: "created from a Vaani call" }, { onConflict: "hubspot_contact_id", ignoreDuplicates: true });
      return `${r.created ? "created" : "updated"} contact ${r.id}`;
    });
    if (hubspotContactId) {
      const contactId = hubspotContactId;
      await attempt("hubspot:deal", async () => {
        const dealId = await upsertDeal({
          dealId: lead.hubspot_deal_id,
          contactId,
          name: `${c.handoff.name || "Caller"} — ${[c.handoff.locality, c.handoff.bhk || c.handoff.property_type].filter(Boolean).join(" ") || "enquiry"}`,
          outcome: c.outcome,
          description: `${OUTCOME_LABELS[c.outcome]} (${c.reason_code}) — ${c.reason_detail}\n\n${c.summary}\n\nTranscript: ${transcriptUrl}`,
        });
        await db().from("leads").update({ hubspot_deal_id: dealId, hubspot_contact_id: contactId }).eq("id", lead.id);
        return `deal ${dealId} → ${c.outcome}`;
      });
      const needsTask = c.outcome === "HUMAN_REVIEW" || c.outcome === "INCOMPLETE" || (c.outcome === "QUALIFIED" && !booking);
      if (needsTask) {
        await attempt("hubspot:task", async () => {
          const unclear = c.criteria.filter((x) => x.verdict !== "pass").map((x) => `• ${x.id}: ${x.verdict} — ${x.note}`);
          const body = [
            c.outcome === "QUALIFIED" ? "Qualified, but no designer slot matched the client's preference. Call to agree a time." : `Call back: ${c.reason_detail}`,
            c.clarifying_question ? `Ask: ${c.clarifying_question}` : "",
            unclear.length ? `What's unclear:\n${unclear.join("\n")}` : "",
            c.missing_fields.length ? `Not collected: ${c.missing_fields.join(", ")}` : "",
            `\n${c.summary}\n\nTranscript: ${transcriptUrl}`,
          ]
            .filter(Boolean)
            .join("\n\n");
          const id = await createTask({ contactId, subject: `Call back ${c.handoff.name || phone || "caller"} — ${OUTCOME_LABELS[c.outcome].toLowerCase()}`, body, dueInMinutes: 30 });
          return `task ${id}`;
        });
      }
    }

    const finalSteps = [...steps];
    await db().from("leads").update({ routing: { steps: finalSteps, emails: emailsSent, soft_uncertainties: softUncertainties(c.criteria) } }).eq("id", lead.id);
    await db().from("calls").update({ status: "done", summary: c.summary }).eq("id", callId);
    return { leadId: lead.id, outcome: c.outcome, steps: finalSteps };
  } catch (e) {
    await db().from("calls").update({ status: "failed", error: e instanceof Error ? e.message : String(e) }).eq("id", callId);
    throw e;
  }
}

// ---------- booking ----------

async function designersWithHistory() {
  return must(await db().from("designers").select("*").eq("active", true), "load designers") as DesignerRow[];
}

async function bookConsultation(leadId: string, c: Classification, now: Date, transcriptUrl: string): Promise<Slot | null> {
  if (!has("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN")) throw new NotConfiguredError("Google Calendar is not configured");
  const designers = await designersWithHistory();
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

  await db().from("bookings").upsert(
    {
      lead_id: leadId,
      designer_id: designer.id,
      starts_at: slot.start.toISOString(),
      ends_at: slot.end.toISOString(),
      visit_type: h.visit_type,
      calendar_event_id: event.id,
      calendar_event_url: event.htmlLink,
      status: "booked",
    },
    { onConflict: "lead_id" },
  );
  await db().from("designers").update({ last_assigned_at: now.toISOString() }).eq("id", designer.id);
  return slot;
}

/** Seed mode: picks a slot against existing bookings in Supabase instead of Google Calendar. */
async function simulateBooking(leadId: string, c: Classification, startedAt: Date): Promise<Slot | null> {
  const designers = await designersWithHistory();
  if (!designers.length) return null;
  const existing = must(await db().from("bookings").select("designer_id, starts_at, ends_at"), "load bookings") as { designer_id: string; starts_at: string; ends_at: string }[];
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
  await db().from("bookings").upsert(
    { lead_id: leadId, designer_id: slot.designerId, starts_at: slot.start.toISOString(), ends_at: slot.end.toISOString(), visit_type: c.handoff.visit_type, status: "simulated", created_at: startedAt.toISOString() },
    { onConflict: "lead_id" },
  );
  await db().from("designers").update({ last_assigned_at: startedAt.toISOString() }).eq("id", slot.designerId);
  return slot;
}
