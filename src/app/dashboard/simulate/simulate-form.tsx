"use client";

import { useActionState, useState } from "react";
import { simulateCall, type SimulateState } from "./actions";

type Sample = { id: string; started_at: string; duration_seconds: number; transcript: string };

const toLocalInput = (iso: string) => new Date(new Date(iso).getTime() + 330 * 60_000).toISOString().slice(0, 16);

export function SimulateForm({ samples }: { samples: Sample[] }) {
  const [state, action, pending] = useActionState<SimulateState, FormData>(simulateCall, {});
  const [transcript, setTranscript] = useState("");
  const [startedAt, setStartedAt] = useState("");
  const [minutes, setMinutes] = useState("4");

  const load = (id: string) => {
    const s = samples.find((x) => x.id === id);
    if (!s) return;
    setTranscript(s.transcript);
    setStartedAt(toLocalInput(s.started_at));
    setMinutes((s.duration_seconds / 60).toFixed(1));
  };

  return (
    <form action={action} className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="label">Load a sample (Sept 2026)</span>
          <select className="input !w-auto" defaultValue="" onChange={(e) => load(e.target.value)}>
            <option value="" disabled>
              Choose T01–T20…
            </option>
            {samples.map((s) => (
              <option key={s.id} value={s.id}>
                {s.id} — {s.transcript.split("\n").find((l) => l.startsWith("Caller:"))?.slice(8, 60) ?? ""}…
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="label">Transcript</span>
        <textarea
          name="transcript"
          className="input font-[inherit] min-h-[320px] leading-relaxed"
          placeholder={"Agent: Hello, you've reached Aangan Studio, this is Vaani…\nCaller: Hi, I have a 3BHK in Baner…"}
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
          required
        />
      </label>

      <div className="grid sm:grid-cols-3 gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="label">Call time (IST)</span>
          <input className="input" type="datetime-local" name="started_at" value={startedAt} onChange={(e) => setStartedAt(e.target.value)} />
          <span className="text-xs text-muted">Blank = now. Timeline is judged from this date.</span>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="label">Duration (minutes)</span>
          <input className="input" type="number" name="duration_minutes" min="0" step="0.1" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="label">Caller phone (optional)</span>
          <input className="input" type="tel" name="caller_phone" placeholder="+91…" />
        </label>
      </div>

      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" name="dry_run" className="mt-1" />
        <span>
          Dry run — classify and store, but don&apos;t book calendars or send emails.
          <span className="block text-muted">Leave unticked to run the full pipeline: the client email in the transcript will really receive mail.</span>
        </span>
      </label>

      {state.error && <p className="text-sm text-[#b4232c]">{state.error}</p>}
      <div>
        <button className="btn" type="submit" disabled={pending}>
          {pending ? "Running the pipeline…" : "Run as a real call"}
        </button>
      </div>
    </form>
  );
}
