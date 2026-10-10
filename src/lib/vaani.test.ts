import { describe, expect, it } from "vitest";
import { normalisePhone } from "./dispatch";
import { normaliseTranscript, parseVaaniTime, parseWebhook } from "./vaani";

describe("parseWebhook", () => {
  it("reads call_postprocessing (duration in ms, timestamped transcript)", () => {
    const e = parseWebhook({
      event: "call_postprocessing",
      call_id: "outbound-1784899978-36cec598",
      timestamp: "2026-07-24T13:34:22.278854+00:00",
      data: {
        call_id: "outbound-1784899978-36cec598",
        call_duration: 55150.02,
        summary: "Name collected.",
        recording_url: "https://example/rec",
        transcript: "[13:33:14] AGENT: Hi! How can I help?\n\n[13:33:19] USER: Take down my name.",
      },
    });
    expect(e).toMatchObject({ kind: "completed", callId: "outbound-1784899978-36cec598", durationSeconds: 55, summary: "Name collected." });
    if (e.kind === "completed") expect(e.transcript).toBe("Agent: Hi! How can I help?\nCaller: Take down my name.");
  });

  it("accepts call_duration in seconds as browser calls send it", () => {
    const e = parseWebhook({ event: "call_postprocessing", call_id: "webrtc-1", data: { call_duration: 259.64, transcript: "AGENT: Hi" } });
    expect(e).toMatchObject({ kind: "completed", durationSeconds: 260 });
  });

  it("maps outbound failures", () => {
    expect(parseWebhook({ event: "call_no_answer", room_name: "r1" })).toEqual({ kind: "not_connected", callId: "r1", status: "no_answer", error: null });
    expect(parseWebhook({ event: "call_failed", room_name: "r2", error: "SIP_404" })).toMatchObject({ status: "failed", error: "SIP_404" });
  });

  it("ignores lifecycle events", () => {
    expect(parseWebhook({ event: "call_ringing", room_name: "r1" })).toEqual({ kind: "ignored", event: "call_ringing" });
  });
});

describe("helpers", () => {
  it("normalises transcripts from call details too", () => {
    expect(normaliseTranscript("AGENT: Namaste\n\n USER: Hello")).toBe("Agent: Namaste\nCaller: Hello");
  });
  it("treats zone-less Vaani times as UTC", () => {
    expect(parseVaaniTime("2026-04-21T12:27:23.335803")?.toISOString()).toBe("2026-04-21T12:27:23.335Z");
  });
  it("normalises Indian phone numbers", () => {
    expect(normalisePhone("98765 43210")).toBe("+919876543210");
    expect(normalisePhone("09876543210")).toBe("+919876543210");
    expect(normalisePhone("+91-98765-43210")).toBe("+919876543210");
    expect(normalisePhone("12345")).toBeNull();
  });
});
