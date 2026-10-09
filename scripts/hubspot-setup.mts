/**
 * Creates (or finds) the "Vaani enquiries" deal pipeline with one stage per outcome
 * and prints the env vars to paste into .env.local / Vercel.
 *   npm run hubspot:setup
 */
import { ensurePipeline } from "../src/lib/hubspot";

const { pipelineId, stages } = await ensurePipeline();
console.log(`HUBSPOT_PIPELINE_ID=${pipelineId}`);
for (const [label, id] of Object.entries(stages)) console.log(`HUBSPOT_STAGE_${label}=${id}`);
