import type { Classification } from "./classification";
import { softUncertainties } from "./classification";
import { formatIst } from "./hours";
import type { Email } from "./resend";

/** Email bodies. Plain, readable, and never a price. */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const or = (s: string | undefined | null, fallback = "Not mentioned") => (s && s.trim() ? s.trim() : fallback);

function layout(title: string, inner: string): string {
  return `<!doctype html><html><body style="margin:0;background:#FBFAF6;font-family:Helvetica,Arial,sans-serif;color:#111">
<div style="max-width:620px;margin:0 auto;padding:28px 20px">
<div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#666;margin-bottom:6px">Aangan Studio</div>
<h1 style="font-weight:400;font-size:24px;margin:0 0 18px">${esc(title)}</h1>
${inner}
</div></body></html>`;
}

function rows(pairs: [string, string][]): string {
  return `<table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #e7e4dc;border-radius:8px">${pairs
    .map(
      ([k, v]) =>
        `<tr><td style="padding:9px 12px;border-bottom:1px solid #f0ede6;color:#666;font-size:13px;width:38%;vertical-align:top">${esc(k)}</td><td style="padding:9px 12px;border-bottom:1px solid #f0ede6;font-size:14px">${esc(v).replace(/\n/g, "<br>")}</td></tr>`,
    )
    .join("")}</table>`;
}

const textRows = (pairs: [string, string][]) => pairs.map(([k, v]) => `${k}: ${v}`).join("\n");

export function slotLabel(start: Date): string {
  return formatIst(start, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

export function designerHandoff(c: Classification, opts: { slotStart: Date; designerName: string; transcriptUrl: string; calendarUrl?: string | null; callStartedAt: Date }): Email {
  const h = c.handoff;
  const name = or(h.name, "Caller");
  const subject = `New consultation — ${name}, ${or(h.locality, "Pune")} ${or(h.bhk, h.property_type || "")} — ${slotLabel(opts.slotStart)}`.replace(/\s+/g, " ");
  const flags = [...c.flags, ...softUncertainties(c.criteria)];
  const sections: [string, [string, string][]][] = [
    ["Consultation", [["When", formatIst(opts.slotStart, { dateStyle: "full", timeStyle: "short" }) + " (60 min)"], ["Where", or(h.visit_type, "Not specified — confirm with client")], ["Designer", opts.designerName]]],
    ["Contact", [["Name", name], ["Phone", or(h.phone)], ["Email", or(h.email)], ["Language", or(c.language)]]],
    ["Property", [["Locality", or(h.locality)], ["Type", or(h.property_type)], ["BHK", or(h.bhk)], ["Carpet area", or(h.carpet_area)], ["Owned / rented", or(h.ownership)]]],
    ["Project", [["Scope", or(h.scope)], ["Execution or advice", or(h.execution_or_advice)], ["Completion needed", or(h.completion_date)], ["Decision-maker", or(h.decision_maker)], ["Budget (volunteered)", or(h.budget_volunteered, "Not volunteered")]]],
    ["Preferences", [["Consultation timing", or(h.consultation_preference)], ["Site visit or studio", or(h.visit_type)], ["How they heard of us", or(h.source)]]],
  ];

  const html = layout(
    `New consultation — ${name}`,
    `<p style="font-size:15px;line-height:1.5;margin:0 0 18px">${esc(c.summary).replace(/\n/g, "<br>")}</p>
${flags.length ? `<div style="background:#F4D4F0;border-radius:8px;padding:12px 14px;margin:0 0 18px;font-size:14px"><strong>Flags &amp; uncertainties</strong><ul style="margin:6px 0 0;padding-left:18px">${flags.map((f) => `<li>${esc(f)}</li>`).join("")}</ul></div>` : ""}
${sections.map(([title, pairs]) => `<h2 style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#666;font-weight:400;margin:22px 0 8px">${esc(title)}</h2>${rows(pairs)}`).join("")}
<p style="margin:24px 0 0"><a href="${esc(opts.transcriptUrl)}" style="background:#111;color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px;font-size:14px">Read the full call transcript</a>${opts.calendarUrl ? ` &nbsp; <a href="${esc(opts.calendarUrl)}" style="color:#3E8EDB;font-size:14px">Calendar event</a>` : ""}</p>
<p style="color:#888;font-size:12px;margin-top:22px">Call received ${esc(formatIst(opts.callStartedAt))} · answered by Vaani · qualified automatically. No prices were discussed on the call.</p>`,
  );

  const text = [
    `New consultation — ${name}`,
    "",
    c.summary,
    "",
    flags.length ? `FLAGS & UNCERTAINTIES\n- ${flags.join("\n- ")}\n` : "",
    ...sections.map(([title, pairs]) => `${title.toUpperCase()}\n${textRows(pairs)}\n`),
    `Transcript: ${opts.transcriptUrl}`,
  ].join("\n");

  return { to: [], subject, html, text };
}

export function clientConfirmation(c: Classification, opts: { slotStart: Date; designerName: string }): Email {
  const name = or(c.handoff.name, "there").split(" ")[0];
  const when = formatIst(opts.slotStart, { dateStyle: "full", timeStyle: "short" });
  const where = /site|visit|home|flat/i.test(c.handoff.visit_type) ? "at your site" : /studio/i.test(c.handoff.visit_type) ? "at our studio" : "— we'll confirm the place with you";
  const body = `Hi ${name},\n\nThank you for speaking with us. Your free consultation with ${opts.designerName}, one of our designers, is booked for ${when} (IST), ${where}.\n\nYou'll also receive a calendar invitation. If the time doesn't suit you, just reply to this email and we'll find another.\n\nYour designer already has the details you shared on the call, so you won't need to repeat them.\n\nWarmly,\nAangan Studio`;
  return {
    to: [],
    subject: `Your consultation with Aangan Studio — ${slotLabel(opts.slotStart)}`,
    text: body,
    html: layout("Your consultation is booked", body.split("\n\n").map((p) => `<p style="font-size:15px;line-height:1.55">${esc(p).replace(/\n/g, "<br>")}</p>`).join("")),
  };
}

export function clientRejection(c: Classification): Email {
  const name = or(c.handoff.name, "there").split(" ")[0];
  const reason = or(c.client_reason, "Based on what you shared, this doesn't look like a project we'd be the right fit for at the moment.");
  const body = `Hi ${name},\n\nThank you for calling Aangan Studio and telling us about your project.\n\n${reason}\n\nWe'd rather be honest now than take on something we can't do justice to. Please do reach out if your timeline or scope changes — we'd be glad to hear from you again.\n\nWarmly,\nAangan Studio`;
  return {
    to: [],
    subject: "Thank you for calling Aangan Studio",
    text: body,
    html: layout("Thank you for calling", body.split("\n\n").map((p) => `<p style="font-size:15px;line-height:1.55">${esc(p).replace(/\n/g, "<br>")}</p>`).join("")),
  };
}

export function escalationAlert(c: Classification, opts: { transcriptUrl: string; callerPhone: string | null; callStartedAt: Date }): Email {
  const h = c.handoff;
  const pairs: [string, string][] = [
    ["Caller", or(h.name)],
    ["Phone", or(h.phone || opts.callerPhone)],
    ["Reason", c.reason_detail || c.reason_code],
    ["Called at", formatIst(opts.callStartedAt)],
    ["Flags", c.flags.join("; ") || "—"],
  ];
  return {
    to: [],
    subject: `ESCALATION — ${or(h.name, "caller")} — ${c.reason_detail || "needs a senior callback"}`,
    text: `${c.summary}\n\n${textRows(pairs)}\n\nTranscript: ${opts.transcriptUrl}`,
    html: layout(
      "Escalation — call back now",
      `<div style="background:#D7F07A;border-radius:8px;padding:12px 14px;margin-bottom:16px;font-size:15px">${esc(c.summary).replace(/\n/g, "<br>")}</div>${rows(pairs)}<p style="margin-top:20px"><a href="${esc(opts.transcriptUrl)}" style="background:#111;color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px;font-size:14px">Read the transcript</a></p>`,
    ),
  };
}
