/**
 * Dashboard session + signed transcript links. Web Crypto only, so it runs in proxy and route handlers alike.
 */

export const SESSION_COOKIE = "aangan_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 14;

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error("SESSION_SECRET must be set (at least 16 characters)");
  return s;
}

async function hmac(message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Buffer.from(sig).toString("base64url");
}

function equal(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The cookie value is tied to the current password, so changing DASHBOARD_PASSWORD logs everyone out. */
export async function sessionToken(): Promise<string> {
  return hmac(`dashboard:${process.env.DASHBOARD_PASSWORD ?? ""}`);
}

export async function isValidSession(token: string | undefined): Promise<boolean> {
  if (!token || !process.env.DASHBOARD_PASSWORD) return false;
  return equal(token, await sessionToken());
}

export async function checkPassword(password: string): Promise<boolean> {
  const expected = process.env.DASHBOARD_PASSWORD;
  if (!expected) return false;
  return equal(await hmac(`pw:${password}`), await hmac(`pw:${expected}`));
}

/** Designers open the transcript from their email without the dashboard password. */
export async function transcriptSignature(callId: string): Promise<string> {
  return hmac(`transcript:${callId}`);
}

export async function verifyTranscriptSignature(callId: string, sig: string | undefined): Promise<boolean> {
  return !!sig && equal(sig, await transcriptSignature(callId));
}
