import { requireEnv, STUDIO_TZ } from "./env";
import type { Interval } from "./slots";

/**
 * Google Calendar over plain REST, authorised as one studio Google account
 * (OAuth refresh token) that has "Make changes to events" on every designer calendar.
 */

let cached: { token: string; expires: number } | undefined;

async function accessToken(): Promise<string> {
  if (cached && cached.expires > Date.now() + 60_000) return cached.token;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: requireEnv("GOOGLE_CLIENT_ID"),
      client_secret: requireEnv("GOOGLE_CLIENT_SECRET"),
      refresh_token: requireEnv("GOOGLE_REFRESH_TOKEN"),
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Google token refresh failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: data.access_token, expires: Date.now() + data.expires_in * 1000 };
  return cached.token;
}

async function call<T>(path: string, init: RequestInit & { query?: Record<string, string> } = {}): Promise<T> {
  const url = new URL(`https://www.googleapis.com/calendar/v3${path}`);
  for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json", ...init.headers },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Google Calendar ${path} failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as T;
}

export async function freeBusy(calendarIds: string[], from: Date, to: Date): Promise<Record<string, Interval[]>> {
  const data = await call<{ calendars: Record<string, { busy?: { start: string; end: string }[]; errors?: unknown[] }> }>("/freeBusy", {
    method: "POST",
    body: JSON.stringify({ timeMin: from.toISOString(), timeMax: to.toISOString(), timeZone: STUDIO_TZ, items: calendarIds.map((id) => ({ id })) }),
  });
  const out: Record<string, Interval[]> = {};
  for (const id of calendarIds) {
    const cal = data.calendars[id];
    // A calendar we can't read is treated as fully busy rather than silently double-booked.
    out[id] = cal?.errors?.length ? [{ start: from, end: to }] : (cal?.busy ?? []).map((b) => ({ start: new Date(b.start), end: new Date(b.end) }));
  }
  return out;
}

export async function createEvent(input: {
  calendarId: string;
  summary: string;
  description: string;
  location: string;
  start: Date;
  end: Date;
  attendees: { email: string; displayName?: string }[];
}): Promise<{ id: string; htmlLink: string }> {
  return call<{ id: string; htmlLink: string }>(`/calendars/${encodeURIComponent(input.calendarId)}/events`, {
    method: "POST",
    query: { sendUpdates: "all" },
    body: JSON.stringify({
      summary: input.summary,
      description: input.description,
      location: input.location,
      start: { dateTime: input.start.toISOString(), timeZone: STUDIO_TZ },
      end: { dateTime: input.end.toISOString(), timeZone: STUDIO_TZ },
      attendees: input.attendees,
      reminders: { useDefault: true },
    }),
  });
}
