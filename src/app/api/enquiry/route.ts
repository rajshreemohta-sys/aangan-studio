import { timingSafeEqual } from "node:crypto";
import { DispatchError } from "@/lib/dispatch";
import { env } from "@/lib/env";
import { handleWebEnquiry } from "@/lib/enquiry";

/**
 * For the studio website's own form (or a form tool's webhook): POST JSON or form data
 * with name, phone, and optionally email, locality, message. Authenticated with
 * ENQUIRY_SECRET as `?secret=` or the `x-enquiry-secret` header, because it makes phone calls.
 */
export async function POST(req: Request) {
  const secret = env("ENQUIRY_SECRET");
  const given = req.headers.get("x-enquiry-secret") ?? new URL(req.url).searchParams.get("secret") ?? "";
  if (!secret || given.length !== secret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) {
    return Response.json({ error: "unauthorised" }, { status: 401 });
  }

  let fields: Record<string, string> = {};
  try {
    fields = req.headers.get("content-type")?.includes("json")
      ? ((await req.json()) as Record<string, string>)
      : (Object.fromEntries(await req.formData()) as Record<string, string>);
  } catch {
    return Response.json({ error: "send JSON or form data" }, { status: 400 });
  }
  const pick = (...keys: string[]) => keys.map((k) => fields[k]).find((v) => typeof v === "string" && v.trim()) ?? "";

  try {
    const d = await handleWebEnquiry({
      name: pick("name", "full_name", "Name"),
      phone: pick("phone", "mobile", "phone_number", "Phone"),
      email: pick("email", "Email"),
      locality: pick("locality", "location", "area"),
      message: pick("message", "notes", "details", "Message"),
    });
    return Response.json({ ok: true, dispatch: d.id, status: d.status });
  } catch (e) {
    const status = e instanceof DispatchError ? 409 : 400;
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status });
  }
}
