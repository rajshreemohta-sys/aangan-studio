/**
 * Seeds the dashboard with the September phone transcripts (T01–T20), using the
 * classifier results from `npm run eval` (data/eval-results.json). Runs the real
 * pipeline in dry-run mode: calls, leads, costs, follow-ups and simulated bookings are
 * written to the database; no calendar invites or emails are sent.
 *
 *   npm run seed            → replaces earlier seed rows
 */
import { readFileSync } from "node:fs";
import type { ClassifierResult } from "../src/lib/classifier";
import { query } from "../src/lib/db";
import { insertCall, processCall } from "../src/lib/pipeline";

type Fixture = { id: string; started_at: string; duration_seconds: number; missed: boolean; transcript: string };
type EvalRow = ClassifierResult & Fixture;

const DESIGNERS = [
  { name: "Aryan Kulkarni", email: "aryan@designers.example" },
  { name: "Meghna Iyer", email: "meghna@designers.example" },
  { name: "Rohan Shah", email: "rohan@designers.example" },
];

const results: EvalRow[] = JSON.parse(readFileSync("data/eval-results.json", "utf8"));
const fixtures: Fixture[] = JSON.parse(readFileSync("data/phone-transcripts.json", "utf8"));

// Replace any earlier seed run (cascades to leads, bookings and costs).
await query("delete from calls where source = 'seed'");

const [{ n }] = await query<{ n: string }>("select count(*) as n from designers");
if (Number(n) === 0) {
  for (const d of DESIGNERS) await query("insert into designers (name, email, calendar_id) values ($1, $2, $2)", [d.name, d.email]);
  console.log(`Added ${DESIGNERS.length} placeholder designers — replace with real names, emails and calendar ids.`);
}
await query("update designers set last_assigned_at = null");

for (const f of fixtures.sort((a, b) => a.started_at.localeCompare(b.started_at))) {
  const startedAt = new Date(f.started_at);
  if (f.missed) {
    // T08: a missed call under the old setup. Kept as a call with no conversation so the feed shows it.
    const { id } = await insertCall({ source: "seed", transcript: "", durationSeconds: 0, startedAt });
    await query("update calls set status = 'done', summary = 'Missed call before Vaani — no voicemail.' where id = $1", [id]);
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
