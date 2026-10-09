import { dispatchCall, normalisePhone } from "./dispatch";

export type WebEnquiry = { name: string; phone: string; email?: string; locality?: string; message?: string };

/** Website form → Vaani rings the person back straight away. */
export async function handleWebEnquiry(e: WebEnquiry) {
  const name = e.name.trim().slice(0, 120);
  const phone = normalisePhone(e.phone);
  if (!name) throw new Error("Name is required.");
  if (!phone) throw new Error("Please enter a valid mobile number.");
  const known = [
    `- Name: ${name}`,
    e.email?.trim() ? `- Email: ${e.email.trim()}` : "",
    e.locality?.trim() ? `- Locality: ${e.locality.trim()}` : "",
    e.message?.trim() ? `- What they wrote on the form: "${e.message.trim().slice(0, 1000)}"` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return dispatchCall({
    reason: "web_enquiry",
    phone,
    name,
    email: e.email?.trim() || null,
    notes: e.message?.trim().slice(0, 2000) || null,
    brief: { known, ask: null },
    automatic: true,
  });
}
