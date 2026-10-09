/**
 * Demo setup: creates one Google calendar per designer in the connected Google account
 * (e.g. "Aryan Kulkarni · Aangan") and points the designers table at them.
 *   npm run google:demo-calendars
 * Needs GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REFRESH_TOKEN (npm run google:token).
 * Safe to re-run: existing calendars with the same name are reused.
 */
import { query } from "../src/lib/db";

const DESIGNERS = ["Aryan Kulkarni", "Meghna Iyer", "Rohan Shah"];

const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN ?? "",
    grant_type: "refresh_token",
  }),
});
const { access_token } = (await tokenRes.json()) as { access_token?: string };
if (!access_token) {
  console.error("Couldn't sign in to Google — run `npm run google:token` first.");
  process.exit(1);
}
const google = async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
  const r = await fetch(`https://www.googleapis.com/calendar/v3${path}`, { ...init, headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" } });
  if (!r.ok) throw new Error(`Google ${path}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return (await r.json()) as T;
};

const list = await google<{ items: { id: string; summary: string }[] }>("/users/me/calendarList");
for (const name of DESIGNERS) {
  const summary = `${name} · Aangan`;
  let cal = list.items.find((c) => c.summary === summary);
  if (!cal) {
    cal = await google<{ id: string; summary: string }>("/calendars", {
      method: "POST",
      body: JSON.stringify({ summary, description: `Demo consultation calendar for ${name} (Aangan Studio)`, timeZone: "Asia/Kolkata" }),
    });
    console.log(`Created calendar "${summary}"`);
  } else {
    console.log(`Reusing calendar "${summary}"`);
  }
  // The demo designer's "email" is their calendar id: invites land on that calendar, nothing is mailed.
  const updated = await query("update designers set calendar_id = $2, email = $2, active = true where name = $1 returning id", [name, cal.id]);
  if (!updated.length) await query("insert into designers (name, email, calendar_id) values ($1, $2, $2)", [name, cal.id]);
}
const others = await query<{ name: string }>("update designers set active = false where name <> all($1) returning name", [DESIGNERS]);
if (others.length) console.log(`Deactivated other designers: ${others.map((o) => o.name).join(", ")}`);
console.log("\nDone — the three designer calendars now show in your Google Calendar (left sidebar, under 'My calendars').");
