import { env, numberEnv, requireEnv } from "./env";

export type Email = { to: string | string[]; subject: string; html: string; text: string; replyTo?: string };

export const resendCostPerEmail = () => numberEnv("RESEND_INR_PER_EMAIL", 0.08);

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/**
 * Demo mode: with DEMO_INBOX set, every email goes to that one inbox instead, with a banner
 * saying who it was meant for. Needed when sending from Resend's test address (onboarding@resend.dev),
 * which can only deliver to the account owner, and for demo designers who have no real inbox.
 */
function route(email: Email): Email {
  const inbox = env("DEMO_INBOX");
  if (!inbox) return email;
  const meant = (Array.isArray(email.to) ? email.to : [email.to]).join(", ");
  const note = `Demo — this email would go to: ${meant}`;
  return {
    ...email,
    to: inbox,
    subject: `[Demo → ${meant}] ${email.subject}`,
    text: `${note}\n\n${email.text}`,
    html: `<div style="background:#D7F07A;padding:10px 14px;font:13px Helvetica,Arial,sans-serif;color:#111">${esc(note)}</div>${email.html}`,
  };
}

export async function sendEmail(original: Email): Promise<{ id: string }> {
  const email = route(original);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${requireEnv("RESEND_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env("RESEND_FROM") ?? "Aangan Studio <onboarding@resend.dev>",
      to: Array.isArray(email.to) ? email.to : [email.to],
      subject: email.subject,
      html: email.html,
      text: email.text,
      reply_to: email.replyTo,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Resend failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as { id: string };
}
