import { numberEnv, requireEnv } from "./env";

export type Email = { to: string | string[]; subject: string; html: string; text: string; replyTo?: string };

export const resendCostPerEmail = () => numberEnv("RESEND_INR_PER_EMAIL", 0.08);

export async function sendEmail(email: Email): Promise<{ id: string }> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${requireEnv("RESEND_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: requireEnv("RESEND_FROM"),
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
