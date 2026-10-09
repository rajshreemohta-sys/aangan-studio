/**
 * Seeds the dashboard with the September phone transcripts (T01–T20), using the
 * classifier results from `npm run eval` (data/eval-results.json). Runs the real
 * pipeline in dry-run mode: rows, costs and simulated bookings are written to
 * Supabase; no calendar invites, emails or HubSpot records are created.
 *
 *   npm run seed            → adds seed rows (replaces earlier seed rows)
 */
import { readFileSync } from "node:fs";
import type { ClassifierResult } from "../src/lib/classifier";
import { insertCall, processCall } from "../src/lib/pipeline";
import { db } from "../src/lib/supabase";

type EvalRow = ClassifierResult & { id: string; started_at: string; duration_seconds: number; missed: boolean; transcript: string };
type Fixture = { id: string; started_at: string; duration_seconds: number; missed: boolean; transcript: string };

const DESIGNERS = [
  { name: "Aryan Kulkarni", email: "aryan@designers.example", calendar_id: "aryan@designers.example" },
  { name: "Meghna Iyer", email: "meghna@designers.example", calendar_id: "meghna@designers.example" },
  { name: "Rohan Shah", email: "rohan@designers.example", calendar_id: "rohan@designers.example" },
];

const results: EvalRow[] = JSON.parse(readFileSync("data/eval-results.json", "utf8"));
const fixtures: Fixture[] = JSON.parse(readFileSync("data/phone-transcripts.json", "utf8"));

// Replace any earlier seed run (cascades to leads, bookings; costs keep call_id null → delete those too).
const old = await db().from("calls").select("id").eq("source", "seed");
const oldIds = (old.data ?? []).map((r) => r.id as string);
if (oldIds.length) {
  await db().from("costs").delete().in("call_id", oldIds);
  await db().from("calls").delete().in("id", oldIds);
}

const designers = await db().from("designers").select("id");
if (!designers.data?.length) {
  const r = await db().from("designers").insert(DESIGNERS);
  if (r.error) throw new Error(r.error.message);
  console.log(`Added ${DESIGNERS.length} placeholder designers — replace with real names, emails and calendar ids.`);
}
await db().from("designers").update({ last_assigned_at: null }).neq("id", "00000000-0000-0000-0000-000000000000");

for (const f of fixtures.sort((a, b) => a.started_at.localeCompare(b.started_at))) {
  const startedAt = new Date(f.started_at);
  if (f.missed) {
    // T08: a missed call under the old setup. Kept as a call with no conversation so the feed shows it.
    const { id } = await insertCall({ source: "seed", transcript: "", durationSeconds: 0, startedAt });
    await db().from("calls").update({ status: "done", summary: "Missed call before Vaani — no voicemail." }).eq("id", id);
    console.log(`${f.id}  missed call (no transcript)`);
    continue;
  }
  const r = results.find((x) => x.id === f.id);
  if (!r) throw new Error(`No eval result for ${f.id} — run npm run eval first`);
  const { id } = await insertCall({ source: "seed", transcript: f.transcript, durationSeconds: f.duration_seconds, startedAt });
  const out = await processCall(id, { dryRun: true, precomputed: structuredClone(r), now: startedAt });
  console.log(`${f.id}  ${out.outcome}`);
}
console.log("Seeded.");
