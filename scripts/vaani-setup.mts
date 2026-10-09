/**
 * Creates (first run) or updates the Vaani agent from prompts/vaani-agent.md.
 *   npm run vaani:setup
 * Needs VAANI_API_KEY in .env.local. Saves VAANI_AGENT_ID there on first run.
 * If VAANI_PHONE_NUMBER is set, routes that number's inbound calls to the agent and dials out from it.
 */
import { appendFileSync, readFileSync } from "node:fs";
import { createAgent, updateDeployment, updatePersona } from "../src/lib/vaani";

if (!process.env.VAANI_API_KEY) {
  console.error("Add VAANI_API_KEY to .env.local first (Vaani dashboard → API Keys).");
  process.exit(1);
}

let agentId = process.env.VAANI_AGENT_ID;
if (!agentId) {
  agentId = await createAgent("aangan-studio-vaani");
  if (!readFileSync(".env.local", "utf8").endsWith("\n")) appendFileSync(".env.local", "\n");
  appendFileSync(".env.local", `VAANI_AGENT_ID=${agentId}\n`);
  console.log(`Created agent ${agentId} and saved VAANI_AGENT_ID to .env.local`);
} else {
  console.log(`Updating agent ${agentId}`);
}

await updatePersona(agentId);
console.log("✓ Uploaded prompt (prompts/vaani-agent.md), greeting and language auto-detect");

const number = process.env.VAANI_PHONE_NUMBER;
if (number) {
  await updateDeployment(agentId, number);
  console.log(`✓ ${number} now rings this agent, and callbacks dial out from it`);
} else {
  console.log("• No VAANI_PHONE_NUMBER set — link the studio number to the agent in Vaani (Telephony), or set it and re-run");
}

const app = (process.env.APP_URL && !process.env.APP_URL.includes("localhost") ? process.env.APP_URL : "https://aangan-studio-beta.vercel.app").replace(/\/$/, "");
console.log(`\nLast step, in the Vaani dashboard → Settings → Webhooks, add:\n  ${app}/api/vaani/webhook?secret=<VAANI_WEBHOOK_SECRET>`);
