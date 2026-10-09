import { readFile } from "node:fs/promises";
import path from "node:path";
import { Nav, Window } from "@/components/ui";
import { SimulateForm } from "./simulate-form";

export const metadata = { title: "Simulate call · Aangan Studio" };
export const maxDuration = 60;

async function samples() {
  "use cache";
  const all = JSON.parse(await readFile(path.join(process.cwd(), "data", "phone-transcripts.json"), "utf8")) as { id: string; started_at: string; duration_seconds: number; missed: boolean; transcript: string }[];
  return all.filter((s) => !s.missed).map(({ id, started_at, duration_seconds, transcript }) => ({ id, started_at, duration_seconds, transcript }));
}

export default async function SimulatePage() {
  return (
    <main className="max-w-[1180px] mx-auto px-4 md:px-8 pb-24">
      <Nav active="simulate" />
      <section className="grid lg:grid-cols-[1fr_1.6fr] gap-10 pt-6">
        <div className="fade-up">
          <p className="label">Admin</p>
          <h1 className="display text-5xl md:text-6xl mt-3">Simulate a call.</h1>
          <p className="text-muted mt-5 leading-relaxed max-w-md">
            Paste a transcript and it goes through exactly what a real Vaani call does: Gemini classifies it, qualified leads get a designer slot and handoff email, everything else is routed — and every rupee is logged.
          </p>
          <div className="panel bg-pink p-6 mt-8">
            <p className="label">Format</p>
            <p className="mt-2 text-sm leading-relaxed">
              One turn per line, starting <code>Agent:</code> or <code>Caller:</code>. Hindi and Marathi are fine.
            </p>
          </div>
        </div>
        <Window title="admin · simulate call" className="fade-up" >
          <div className="p-5 md:p-6">
            <SimulateForm samples={await samples()} />
          </div>
        </Window>
      </section>
    </main>
  );
}
