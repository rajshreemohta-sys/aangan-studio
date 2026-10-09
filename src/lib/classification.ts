import { z } from "zod";

/** Shape of the classifier's answer, and the deterministic rules that turn criteria into an outcome. */

export const OUTCOMES = ["QUALIFIED", "HUMAN_REVIEW", "REJECTED", "ESCALATED", "INCOMPLETE", "NOT_ENQUIRY"] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const CATEGORIES = ["ENQUIRY", "ESCALATED", "INCOMPLETE", "NOT_ENQUIRY"] as const;
export const VERDICTS = ["pass", "fail", "unclear"] as const;
export type Verdict = (typeof VERDICTS)[number];

export const CRITERIA = ["project", "location", "timeline", "budget", "decision_maker"] as const;
export type CriterionId = (typeof CRITERIA)[number];

export const CRITERION_LABELS: Record<CriterionId, string> = {
  project: "Real project in scope",
  location: "Pune / PCMC",
  timeline: "Timeline > 8 weeks",
  budget: "Budget (if volunteered)",
  decision_maker: "Decision-maker",
};

export const REASON_CODES = [
  "QUALIFIED",
  "SCOPE",
  "LOCATION",
  "TIMELINE",
  "BUDGET",
  "DECISION_MAKER",
  "NEEDS_REVIEW",
  "EXISTING_CLIENT",
  "HUMAN_REQUESTED",
  "CALL_DROPPED",
  "MISSING_INFO",
  "NOT_ENQUIRY",
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

const REJECT_REASON: Record<CriterionId, ReasonCode> = {
  project: "SCOPE",
  location: "LOCATION",
  timeline: "TIMELINE",
  budget: "BUDGET",
  decision_maker: "DECISION_MAKER",
};

export const HANDOFF_FIELDS = [
  "name",
  "phone",
  "email",
  "locality",
  "property_type",
  "bhk",
  "carpet_area",
  "scope",
  "execution_or_advice",
  "completion_date",
  "ownership",
  "decision_maker",
  "budget_volunteered",
  "consultation_preference",
  "visit_type",
  "source",
] as const;
export type HandoffField = (typeof HANDOFF_FIELDS)[number];

export const criterionSchema = z.object({
  id: z.enum(CRITERIA),
  verdict: z.enum(VERDICTS),
  evidence: z.string(),
  note: z.string(),
});
export type Criterion = z.infer<typeof criterionSchema>;

export const classificationSchema = z.object({
  category: z.enum(CATEGORIES),
  outcome: z.enum(OUTCOMES),
  reason_code: z.enum(REASON_CODES),
  reason_detail: z.string(),
  criteria: z.array(criterionSchema),
  confidence: z.number().min(0).max(1),
  handoff: z.object(Object.fromEntries(HANDOFF_FIELDS.map((f) => [f, z.string()])) as Record<HandoffField, z.ZodString>),
  flags: z.array(z.string()),
  missing_fields: z.array(z.string()),
  clarifying_question: z.string(),
  client_reason: z.string(),
  summary: z.string(),
  language: z.string(),
});
export type Classification = z.infer<typeof classificationSchema>;

/** JSON Schema handed to Gemini so it must answer in exactly this shape. */
export const RESPONSE_JSON_SCHEMA = {
  type: "object",
  properties: {
    category: { type: "string", enum: [...CATEGORIES] },
    outcome: { type: "string", enum: [...OUTCOMES] },
    reason_code: { type: "string", enum: [...REASON_CODES] },
    reason_detail: { type: "string" },
    criteria: {
      type: "array",
      minItems: 5,
      maxItems: 5,
      items: {
        type: "object",
        properties: {
          id: { type: "string", enum: [...CRITERIA] },
          verdict: { type: "string", enum: [...VERDICTS] },
          evidence: { type: "string", description: "Short quote of the caller's words, or 'not mentioned'" },
          note: { type: "string" },
        },
        required: ["id", "verdict", "evidence", "note"],
      },
    },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    handoff: {
      type: "object",
      properties: Object.fromEntries(HANDOFF_FIELDS.map((f) => [f, { type: "string" }])),
      required: [...HANDOFF_FIELDS],
    },
    flags: { type: "array", items: { type: "string" } },
    missing_fields: { type: "array", items: { type: "string" } },
    clarifying_question: { type: "string" },
    client_reason: { type: "string" },
    summary: { type: "string", description: "Exactly 3 lines separated by \\n" },
    language: { type: "string" },
  },
  required: [
    "category",
    "outcome",
    "reason_code",
    "reason_detail",
    "criteria",
    "confidence",
    "handoff",
    "flags",
    "missing_fields",
    "clarifying_question",
    "client_reason",
    "summary",
    "language",
  ],
};

export const REVIEW_CONFIDENCE = 0.7;

export type Decision = { outcome: Outcome; reason_code: ReasonCode };

/**
 * The rubric, applied in code so the model can't talk its way past it.
 * Unclear on 4 or 5 never blocks (qualified.md: "do not push, treat as qualified"),
 * and unclear on its own never rejects — only a fail does.
 */
export function decide(c: Pick<Classification, "category" | "criteria" | "confidence" | "reason_code">): Decision {
  if (c.category === "ESCALATED") {
    return { outcome: "ESCALATED", reason_code: c.reason_code === "HUMAN_REQUESTED" ? "HUMAN_REQUESTED" : "EXISTING_CLIENT" };
  }
  if (c.category === "INCOMPLETE") {
    return { outcome: "INCOMPLETE", reason_code: c.reason_code === "MISSING_INFO" ? "MISSING_INFO" : "CALL_DROPPED" };
  }
  if (c.category === "NOT_ENQUIRY") return { outcome: "NOT_ENQUIRY", reason_code: "NOT_ENQUIRY" };

  const verdict = (id: CriterionId): Verdict => c.criteria.find((x) => x.id === id)?.verdict ?? "unclear";

  const failing = (["project", "location", "timeline", "budget"] as const).find((id) => verdict(id) === "fail");
  if (failing) return { outcome: "REJECTED", reason_code: REJECT_REASON[failing] };

  if (verdict("decision_maker") === "fail") {
    const othersShaky = (["project", "location", "timeline", "budget"] as const).some((id) => verdict(id) !== "pass");
    return othersShaky
      ? { outcome: "REJECTED", reason_code: "DECISION_MAKER" }
      : { outcome: "HUMAN_REVIEW", reason_code: "DECISION_MAKER" };
  }

  const coreUnclear = (["project", "location", "timeline"] as const).some((id) => verdict(id) === "unclear");
  if (coreUnclear || c.confidence < REVIEW_CONFIDENCE) return { outcome: "HUMAN_REVIEW", reason_code: "NEEDS_REVIEW" };

  return { outcome: "QUALIFIED", reason_code: "QUALIFIED" };
}

/** Notes on criteria 4/5 that a qualified lead still carries into the handoff. */
export function softUncertainties(criteria: Criterion[]): string[] {
  return criteria
    .filter((c) => (c.id === "budget" || c.id === "decision_maker") && c.verdict !== "pass")
    .map((c) => `${CRITERION_LABELS[c.id]}: ${c.verdict} — ${c.note}`);
}

export const OUTCOME_LABELS: Record<Outcome, string> = {
  QUALIFIED: "Qualified",
  HUMAN_REVIEW: "Needs review",
  REJECTED: "Not a fit",
  ESCALATED: "Escalated",
  INCOMPLETE: "Incomplete",
  NOT_ENQUIRY: "Not an enquiry",
};

export const REASON_LABELS: Record<ReasonCode, string> = {
  QUALIFIED: "Qualified",
  SCOPE: "Out of scope",
  LOCATION: "Outside Pune/PCMC",
  TIMELINE: "Timeline too short",
  BUDGET: "Budget below scope",
  DECISION_MAKER: "Not the decision-maker",
  NEEDS_REVIEW: "Needs review",
  EXISTING_CLIENT: "Existing client",
  HUMAN_REQUESTED: "Asked for a human",
  CALL_DROPPED: "Call dropped",
  MISSING_INFO: "Missing details",
  NOT_ENQUIRY: "Not an enquiry",
};
