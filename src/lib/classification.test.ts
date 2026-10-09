import { describe, expect, it } from "vitest";
import { decide, type Criterion, type Verdict } from "./classification";

const crit = (p: Verdict, l: Verdict, t: Verdict, b: Verdict, d: Verdict): Criterion[] =>
  (["project", "location", "timeline", "budget", "decision_maker"] as const).map((id, i) => ({
    id,
    verdict: [p, l, t, b, d][i],
    evidence: "",
    note: "",
  }));
const run = (criteria: Criterion[], confidence = 0.95, category: "ENQUIRY" | "ESCALATED" | "INCOMPLETE" | "NOT_ENQUIRY" = "ENQUIRY") =>
  decide({ category, criteria, confidence, reason_code: "QUALIFIED" });

describe("decide", () => {
  it("step 0 categories win", () => {
    expect(run(crit("pass", "pass", "pass", "pass", "pass"), 1, "ESCALATED").outcome).toBe("ESCALATED");
    expect(run(crit("pass", "pass", "pass", "pass", "pass"), 1, "INCOMPLETE").outcome).toBe("INCOMPLETE");
    expect(run(crit("pass", "pass", "pass", "pass", "pass"), 1, "NOT_ENQUIRY").outcome).toBe("NOT_ENQUIRY");
  });
  it("any fail on 1–4 rejects with that reason", () => {
    expect(run(crit("pass", "fail", "pass", "pass", "pass"))).toEqual({ outcome: "REJECTED", reason_code: "LOCATION" });
    expect(run(crit("pass", "pass", "pass", "fail", "pass"))).toEqual({ outcome: "REJECTED", reason_code: "BUDGET" });
    expect(run(crit("fail", "fail", "pass", "pass", "pass")).reason_code).toBe("SCOPE");
  });
  it("decision-maker fail rejects only alongside another weak criterion", () => {
    expect(run(crit("pass", "pass", "unclear", "pass", "fail")).outcome).toBe("REJECTED");
    expect(run(crit("pass", "pass", "pass", "pass", "fail")).outcome).toBe("HUMAN_REVIEW");
  });
  it("unclear on 1–3 or low confidence goes to review, never rejection", () => {
    expect(run(crit("pass", "pass", "unclear", "pass", "unclear")).outcome).toBe("HUMAN_REVIEW");
    expect(run(crit("unclear", "unclear", "unclear", "pass", "pass")).outcome).toBe("HUMAN_REVIEW");
    expect(run(crit("pass", "pass", "pass", "pass", "pass"), 0.6).outcome).toBe("HUMAN_REVIEW");
  });
  it("unclear on 4/5 still qualifies", () => {
    expect(run(crit("pass", "pass", "pass", "unclear", "unclear")).outcome).toBe("QUALIFIED");
  });
});
