import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { Recording, Transcript } from "@/components/transcript";
import { Nav, OutcomeChip } from "@/components/ui";
import { formatIst } from "@/lib/hours";
import { listCalls } from "@/lib/metrics";

export const metadata = { title: "Calls · Aangan Studio" };

const SOURCE: Record<string, string> = { vaani: "", simulated: "Simulated", seed: "Sample · Sept front desk" };
const minutes = (s: number) => (s < 60 ? `${s} sec` : `${Math.floor(s / 60)} min ${s % 60 ? `${s % 60} sec` : ""}`.trim());

async function Calls({ searchParams }: { searchParams: PageProps<"/dashboard/calls">["searchParams"] }) {
  const sp = await searchParams;
  await connection();
  const which = sp.show === "all" ? "all" : "real";
  const calls = await listCalls(which);
  return (
    <>
      <section className="pt-6 pb-8 flex flex-wrap items-end justify-between gap-4 fade-up">
        <div>
          <p className="label">Recordings &amp; transcripts</p>
          <h1 className="display text-5xl md:text-7xl mt-3">Calls</h1>
          <p className="text-muted mt-3 max-w-xl">Every conversation Vaani has had: listen to the recording or read the transcript.</p>
        </div>
        <div className="flex gap-1.5" role="group" aria-label="Which calls">
          <Link href="/dashboard/calls" className={`chip ${which === "real" ? "!bg-ink !text-white !border-ink" : "hover:border-ink"}`}>
            Vaani calls
          </Link>
          <Link href="/dashboard/calls?show=all" className={`chip ${which === "all" ? "!bg-ink !text-white !border-ink" : "hover:border-ink"}`}>
            All, incl. sample data
          </Link>
        </div>
      </section>

      <ul className="flex flex-col gap-4">
        {calls.map((c, i) => (
          <li key={c.id} className="card p-5 md:p-6 fade-up" style={{ ["--i" as string]: Math.min(i, 8) }}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <Link href={`/dashboard/calls/${c.id}`} className="text-xl hover:underline underline-offset-4">
                {c.name || "Unknown caller"}
              </Link>
              <OutcomeChip outcome={c.outcome} />
              {c.channel === "web" && <span className="chip">Web call</span>}
              {SOURCE[c.source] && <span className="chip text-muted">{SOURCE[c.source]}</span>}
              <span className="flex-1" />
              <span className="text-sm text-muted num">
                {formatIst(c.started_at, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })} · {minutes(c.duration_seconds)}
                {c.after_hours ? " · after hours" : ""}
              </span>
            </div>
            {(c.locality || c.bhk) && <p className="text-sm text-muted mt-1">{[c.locality, c.bhk].filter(Boolean).join(" · ")}</p>}
            {c.summary && <p className="mt-3 leading-relaxed whitespace-pre-line">{c.summary}</p>}

            <div className="mt-4">
              {c.has_recording ? <Recording callId={c.id} /> : <p className="text-xs text-muted">No recording — {c.source === "vaani" ? "Vaani didn't send one" : "this call didn't go through Vaani"}.</p>}
            </div>

            <details className="mt-4 group">
              <summary className="cursor-pointer text-sm underline underline-offset-4 select-none">Read transcript</summary>
              <div className="mt-4 p-4 rounded-[10px] bg-[#faf8f3] border border-line text-[15px] leading-relaxed max-h-[60vh] overflow-auto">
                <Transcript text={c.raw_transcript} />
              </div>
            </details>
          </li>
        ))}
        {!calls.length && <li className="card p-6 text-muted">No calls yet.</li>}
      </ul>
    </>
  );
}

export default function CallsPage(props: PageProps<"/dashboard/calls">) {
  return (
    <main className="max-w-[1000px] mx-auto px-4 md:px-8 pb-24">
      <Nav active="calls" />
      <Suspense fallback={<p className="label py-24">Loading calls…</p>}>
        <Calls searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}
