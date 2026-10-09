/**
 * Runs the classifier on phone transcripts T01–T20 (T08 is a missed call — skipped)
 * and checks each outcome against the expected results.
 *   npm run eval            → prints a table, exits 1 on any mismatch
 * Results are written to data/eval-results.json for `npm run seed`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { classifyTranscript } from "../src/lib/classifier";

type Fixture = { id: string; started_at: string; duration_seconds: number; missed: boolean; transcript: string };

const EXPECTED: Record<string, string[]> = {
  T01: ["QUALIFIED"], T05: ["QUALIFIED"], T06: ["QUALIFIED"], T12: ["QUALIFIED"], T15: ["QUALIFIED"], T17: ["QUALIFIED"], T20: ["QUALIFIED"],
  T03: ["REJECTED:LOCATION"], T04: ["REJECTED:SCOPE"], T07: ["REJECTED:TIMELINE"], T10: ["REJECTED:BUDGET"], T19: ["REJECTED:SCOPE"],
  T09: ["ESCALATED"], T18: ["HUMAN_REVIEW"],
  T02: ["QUALIFIED", "HUMAN_REVIEW"], T11: ["QUALIFIED", "HUMAN_REVIEW"], T13: ["QUALIFIED", "HUMAN_REVIEW"], T14: ["QUALIFIED", "HUMAN_REVIEW"], T16: ["QUALIFIED", "HUMAN_REVIEW"],
};

const fixtures: Fixture[] = JSON.parse(readFileSync("data/phone-transcripts.json", "utf8"));
const only = process.argv.slice(2);
const todo = fixtures.filter((f) => f.id !== "T08" && (!only.length || only.includes(f.id)));

const results = await Promise.all(
  todo.map(async (f) => {
    const r = await classifyTranscript(f.transcript, new Date(f.started_at));
    const got = r.decision.outcome;
    const ok = EXPECTED[f.id].some((e) => {
      const [outcome, reason] = e.split(":");
      return outcome === got && (!reason || reason === r.decision.reason_code);
    });
    return { fixture: f, result: r, ok };
  }),
);

let failures = 0;
let cost = 0;
for (const { fixture, result, ok } of results.sort((a, b) => a.fixture.id.localeCompare(b.fixture.id))) {
  cost += result.usage.costInr;
  if (!ok) failures++;
  const crit = result.classification.criteria.map((c) => `${c.id[0]}${c.id === "decision_maker" ? "m" : ""}:${c.verdict[0]}`).join(" ");
  console.log(
    `${ok ? "✓" : "✗"} ${fixture.id}  ${(result.decision.outcome + ":" + result.decision.reason_code).padEnd(26)} expected ${EXPECTED[fixture.id].join(" | ").padEnd(26)} conf ${result.classification.confidence.toFixed(2)}  [${crit}]  ${result.classification.reason_detail}`,
  );
}
console.log(`\n${results.length - failures}/${results.length} match · Gemini cost ₹${cost.toFixed(3)}`);

if (!only.length) {
  writeFileSync(
    "data/eval-results.json",
    JSON.stringify(results.map(({ fixture, result }) => ({ ...fixture, ...result })), null, 2) + "\n",
  );
  console.log("Wrote data/eval-results.json");
}
process.exit(failures ? 1 : 0);
