import { readFileSync } from "node:fs";
import path from "node:path";
import { GoogleGenAI } from "@google/genai";
import { classificationSchema, decide, RESPONSE_JSON_SCHEMA, type Classification, type Decision } from "./classification";
import { requireEnv, env, numberEnv, STUDIO_TZ } from "./env";

/**
 * Gemini reads the transcript and scores the rubric; `decide()` then applies
 * the decision order in code. The model's own outcome is kept for audit.
 */

const DEFAULT_MODEL = "gemini-3.6-flash";
const TIMEOUT_MS = 60_000;

export class ClassifierError extends Error {}

let instructions: string | undefined;
function systemInstruction(): string {
  if (!instructions) {
    // Files are shipped via outputFileTracingIncludes in next.config.ts.
    const read = (p: string) => readFileSync(path.join(/*turbopackIgnore: true*/ process.cwd(), p), "utf8");
    // pricing.md is deliberately not given to the model: the only pricing it needs is the internal budget yardstick in the prompt.
    instructions = [read("prompts/classifier.md"), "\n\n---\n# services.md\n", read("context/services.md"), "\n\n---\n# qualified.md\n", read("context/qualified.md")].join("");
  }
  return instructions;
}

let client: GoogleGenAI | undefined;
const gemini = () => (client ??= new GoogleGenAI({ apiKey: requireEnv("GEMINI_API_KEY") }));

export type ClassifierUsage = { model: string; inputTokens: number; outputTokens: number; costInr: number };
export type ClassifierResult = { classification: Classification; decision: Decision; modelOutcome: string; usage: ClassifierUsage };

export function geminiCostInr(inputTokens: number, outputTokens: number): number {
  const inPer1M = numberEnv("GEMINI_INR_PER_1M_INPUT", 25);
  const outPer1M = numberEnv("GEMINI_INR_PER_1M_OUTPUT", 210);
  return (inputTokens * inPer1M + outputTokens * outPer1M) / 1_000_000;
}

export async function classifyTranscript(transcript: string, callStartedAt: Date): Promise<ClassifierResult> {
  const model = env("GEMINI_MODEL") ?? DEFAULT_MODEL;
  const callDate = callStartedAt.toLocaleString("en-IN", { timeZone: STUDIO_TZ, dateStyle: "full", timeStyle: "short" });
  const userText = `Call date: ${callDate} (IST)\n\n<transcript>\n${transcript}\n</transcript>`;

  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await gemini().models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text: userText }] }],
        config: {
          systemInstruction: systemInstruction(),
          responseMimeType: "application/json",
          responseJsonSchema: RESPONSE_JSON_SCHEMA,
          temperature: 0,
          abortSignal: AbortSignal.timeout(TIMEOUT_MS),
        },
      });
      const parsed = classificationSchema.safeParse(JSON.parse(res.text ?? ""));
      if (!parsed.success) throw new ClassifierError(`Classifier returned an unexpected shape: ${parsed.error.message.slice(0, 300)}`);
      const classification = parsed.data;
      const decision = decide(classification);
      const inputTokens = res.usageMetadata?.promptTokenCount ?? 0;
      const outputTokens = (res.usageMetadata?.candidatesTokenCount ?? 0) + (res.usageMetadata?.thoughtsTokenCount ?? 0);
      return {
        classification: { ...classification, outcome: decision.outcome, reason_code: decision.reason_code },
        decision,
        modelOutcome: classification.outcome,
        usage: { model, inputTokens, outputTokens, costInr: geminiCostInr(inputTokens, outputTokens) },
      };
    } catch (e) {
      lastError = e;
      if (e instanceof Error && /API key|PERMISSION_DENIED|Missing environment/i.test(e.message)) break;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new ClassifierError(String(lastError));
}
