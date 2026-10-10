import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { DesignerConsultations } from "@/components/consultations";
import { CountUp, Donut, LiveFeed } from "@/components/motion";
import { inr, Nav, OUTCOME_COLORS, SectionHead, Window } from "@/components/ui";
import { OUTCOME_LABELS, OUTCOMES, REASON_LABELS, type ReasonCode } from "@/lib/classification";
import { dashboardMetrics, RANGES, type DashboardMetrics, type RangeKey } from "@/lib/metrics";

export const metadata = { title: "Dashboard · Aangan Studio" };

function formatDuration(seconds: number | null): { value: number; unit: string } {
  if (seconds === null) return { value: 0, unit: "—" };
  if (seconds < 90) return { value: Math.round(seconds), unit: "sec" };
  if (seconds < 5400) return { value: Math.round(seconds / 60), unit: "min" };
  return { value: Math.round(seconds / 3600), unit: "hrs" };
}

function Kpi({ i, label, children, note, tone = "card" }: { i: number; label: string; children: React.ReactNode; note?: React.ReactNode; tone?: "card" | "ink" }) {
  return (
    <div className={`fade-up p-5 flex flex-col justify-between min-h-[136px] ${tone === "ink" ? "rounded-[14px] bg-ink text-white" : "card"}`} style={{ ["--i" as string]: i }}>
      <p className={`label ${tone === "ink" ? "!text-[#a9a9a9]" : ""}`}>{label}</p>
      <div>
        <p className="display text-4xl md:text-[44px] mt-3">{children}</p>
        {note && <p className={`text-xs mt-1.5 ${tone === "ink" ? "text-[#a9a9a9]" : "text-muted"}`}>{note}</p>}
      </div>
    </div>
  );
}

function RangeFilter({ current }: { current: RangeKey }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Date range">
      {(Object.keys(RANGES) as RangeKey[]).map((k) => (
        <Link
          key={k}
          href={k === "all" ? "/dashboard" : `/dashboard?range=${k}`}
          className={`chip transition-colors ${k === current ? "!bg-ink !text-white !border-ink" : "hover:border-ink"}`}
          aria-current={k === current ? "true" : undefined}
        >
          {RANGES[k]}
        </Link>
      ))}
    </div>
  );
}

function Funnel({ m }: { m: DashboardMetrics }) {
  const steps = [
    { label: "Calls answered", value: m.callsAnswered, color: "#141414" },
    { label: "Qualified", value: m.qualified, color: "#3E8EDB" },
    { label: "Booked", value: m.booked, color: "#D7F07A" },
  ];
  const max = Math.max(1, steps[0].value);
  return (
    <ol className="flex flex-col gap-5">
      {steps.map((s, i) => (
        <li key={s.label}>
          <div className="flex items-baseline justify-between mb-2">
            <span className="flex items-center gap-3">
              <span className="w-6 h-6 rounded-full border border-line bg-white text-xs flex items-center justify-center">{i + 1}</span>
              {s.label}
            </span>
            <span className="num text-2xl">
              <CountUp value={s.value} />
              {i > 0 && steps[i - 1].value > 0 && <span className="text-xs text-muted ml-2">{Math.round((s.value / steps[i - 1].value) * 100)}%</span>}
            </span>
          </div>
          <div className="h-3 rounded-full bg-[#f1eee7] overflow-hidden">
            <div className="grow h-full rounded-full" style={{ width: `${(s.value / max) * 100}%`, background: s.color, ["--i" as string]: i }} />
          </div>
        </li>
      ))}
    </ol>
  );
}

function Bars({ rows, empty }: { rows: { label: string; value: number; sub?: string }[]; empty: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <ul className="flex flex-col gap-3.5">
      {rows.map((r, i) => (
        <li key={r.label}>
          <div className="flex justify-between text-sm mb-1.5">
            <span>{r.label}</span>
            <span className="num">{r.sub ?? r.value}</span>
          </div>
          <div className="h-2 rounded-full bg-[#f1eee7] overflow-hidden">
            <div className="grow h-full rounded-full bg-ink" style={{ width: `${(r.value / max) * 100}%`, ["--i" as string]: i }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

const SOURCE_LABELS: Record<string, string> = { vaani: "Vaani voice minutes", gemini: "Gemini classification", resend: "Resend emails", calendar: "Google Calendar" };

async function Dashboard({ searchParams }: { searchParams: PageProps<"/dashboard">["searchParams"] }) {
  const sp = await searchParams;
  await connection();
  const range = (typeof sp.range === "string" && sp.range in RANGES ? sp.range : "all") as RangeKey;
  const m = await dashboardMetrics(range);
  const resp = formatDuration(m.medianFirstResponseSeconds);
  const outcomeTotal = OUTCOMES.reduce((a, o) => a + m.outcomes[o], 0);
  const rejections = (Object.entries(m.rejections) as [ReasonCode, number][]).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: REASON_LABELS[k], value: v }));
  const costRows = Object.entries(m.costBySource)
    .sort((a, b) => b[1].amount - a[1].amount)
    .map(([k, v]) => ({ label: SOURCE_LABELS[k] ?? k, value: v.amount, sub: `${inr(v.amount, 2)}${k === "vaani" ? ` · ${Math.round(v.units)} min` : k === "resend" ? ` · ${v.units} sent` : ""}` }));

  return (
    <>
      <section className="pt-6 pb-10 flex flex-wrap items-end justify-between gap-6">
        <div className="fade-up">
          <p className="label">Founder dashboard · {m.rangeLabel}</p>
          <h1 className="display text-5xl md:text-7xl mt-3 max-w-3xl">
            {m.callsAnswered} calls answered.
            <br />
            <span className="text-muted">{m.booked} with a designer.</span>
          </h1>
        </div>
        <RangeFilter current={range} />
      </section>

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <Kpi i={1} label="Calls answered" note={`${m.totalCalls} received`}>
          <CountUp value={m.callsAnswered} />
        </Kpi>
        <Kpi i={2} label="After hours" note="outside 10am–7pm, or Sunday">
          <CountUp value={m.afterHoursPct} format="pct" />
        </Kpi>
        <Kpi i={3} label="Median first response" note="enquiry → Vaani on the line">
          <CountUp value={resp.value} /> <span className="text-xl text-muted">{resp.unit}</span>
        </Kpi>
        <Kpi i={4} label="Qualified" note={`${m.booked} booked with a designer`}>
          <CountUp value={m.qualified} />
        </Kpi>
        <Kpi i={5} label="Booked consultations">
          <CountUp value={m.booked} />
        </Kpi>
        <Kpi i={6} label="Cost this month" note={range === "month" ? "Vaani + Gemini + email" : `${inr(m.costInRange, 2)} in ${m.rangeLabel.toLowerCase()}`}>
          <CountUp value={m.costThisMonth} format="inr2" />
        </Kpi>
        <Kpi i={7} label="Cost per qualified lead" note={m.rangeLabel}>
          {m.costPerQualified === null ? "—" : <CountUp value={m.costPerQualified} format="inr2" />}
        </Kpi>
        <Kpi i={8} label="Estimated pipeline" tone="ink" note={`Estimate · ${m.qualified} qualified × ₹11L average`}>
          <CountUp value={m.pipelineEstimate} format="lakh" />
        </Kpi>
      </section>

      <section className="mt-12 grid md:grid-cols-2 gap-4">
        <Link href="/dashboard/review" className="panel bg-pink p-6 md:p-8 flex items-end justify-between gap-4 hover:opacity-90 transition-opacity fade-up" style={{ ["--i" as string]: 9 }}>
          <div>
            <p className="label">Desk review</p>
            <p className="display text-3xl md:text-4xl mt-2">
              {m.openReview ? `${m.openReview} ${m.openReview === 1 ? "lead" : "leads"} to review` : "Nothing to review"}
            </p>
            <p className="text-sm text-muted mt-2">New enquiries the desk team needs to call back</p>
          </div>
          <span className="btn whitespace-nowrap">Open →</span>
        </Link>
        <Link href="/dashboard/client-care" className="panel bg-lime p-6 md:p-8 flex items-end justify-between gap-4 hover:opacity-90 transition-opacity fade-up" style={{ ["--i" as string]: 10 }}>
          <div>
            <p className="label">Client care</p>
            <p className="display text-3xl md:text-4xl mt-2">
              {m.openCare ? `${m.openCare} existing-client ${m.openCare === 1 ? "concern" : "concerns"}` : "No open concerns"}
            </p>
            <p className="text-sm text-muted mt-2">Existing clients who called with a problem</p>
          </div>
          <span className="btn whitespace-nowrap">Open →</span>
        </Link>
      </section>

      {/* Outcomes — blue colour block with overlapping white cards */}
      <section className="mt-20 relative">
        <div className="panel bg-blue/90 pt-10 pb-28 px-6 md:px-10 text-white fade-up" style={{ ["--i" as string]: 3 }}>
          <p className="label !text-white/80">Outcomes</p>
          <h2 className="display text-4xl md:text-5xl mt-2 max-w-2xl">Where every call ended up.</h2>
        </div>
        <div className="grid md:grid-cols-[1fr_1.2fr] gap-4 -mt-20 px-3 md:px-8">
          <div className="card p-6 fade-up flex flex-col sm:flex-row items-center gap-8" style={{ ["--i" as string]: 4 }}>
            <Donut
              segments={OUTCOMES.map((o) => ({ label: OUTCOME_LABELS[o], value: m.outcomes[o], color: OUTCOME_COLORS[o] }))}
              center={
                <>
                  <span className="display text-5xl">
                    <CountUp value={outcomeTotal} />
                  </span>
                  <span className="label mt-1">calls classified</span>
                </>
              }
            />
            <ul className="flex flex-col gap-2.5 text-sm w-full">
              {OUTCOMES.filter((o) => m.outcomes[o] > 0 || ["QUALIFIED", "HUMAN_REVIEW", "REJECTED", "ESCALATED"].includes(o)).map((o) => (
                <li key={o} className="flex items-center gap-2.5">
                  <span className="dot !w-3 !h-3" style={{ background: OUTCOME_COLORS[o], boxShadow: "inset 0 0 0 1px rgba(0,0,0,.08)" }} />
                  <span className="flex-1">{OUTCOME_LABELS[o]}</span>
                  <span className="num">{m.outcomes[o]}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="card p-6 fade-up" style={{ ["--i" as string]: 5 }}>
            <p className="label mb-5">Call → Qualified → Booked</p>
            <Funnel m={m} />
          </div>
        </div>
      </section>

      <section className="mt-20">
        <SectionHead label="Booked by Vaani" title="Designer consultations" />
        <DesignerConsultations />
      </section>

      <section className="mt-20 grid lg:grid-cols-[1.25fr_1fr] gap-6 items-start">
        <div>
          <SectionHead label="Live" title="Call feed">
            <span className="chip">
              <span className="dot bg-lime animate-pulse" /> updates every few seconds
            </span>
          </SectionHead>
          <Window title="vaani · recent calls" className="fade-up">
            <LiveFeed initial={m.feed} />
          </Window>
        </div>

        <div className="flex flex-col gap-6">
          <div className="panel bg-pink p-6 md:p-8">
            <p className="label">Why we said no</p>
            <h2 className="display text-3xl mt-2 mb-6">Rejection reasons</h2>
            <div className="card p-5">
              <Bars rows={rejections} empty="No rejections in this range." />
            </div>
          </div>
          <div className="panel bg-lime p-6 md:p-8">
            <p className="label">What it costs to run</p>
            <h2 className="display text-3xl mt-2 mb-6">
              <CountUp value={m.costInRange} format="inr2" /> <span className="text-lg text-muted">{m.rangeLabel.toLowerCase()}</span>
            </h2>
            <div className="card p-5">
              <Bars rows={costRows} empty="No costs logged in this range." />
              <p className="text-xs text-muted mt-5 leading-relaxed">
                Vaani at {inr(m.vaaniRatePerMin, 2)}/min · Gemini from token counts on every call · Resend per email. Google Calendar is free.
              </p>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

export default function DashboardPage(props: PageProps<"/dashboard">) {
  return (
    <main className="max-w-[1180px] mx-auto px-4 md:px-8 pb-24">
      <Nav active="dashboard" />
      <Suspense fallback={<p className="label py-24">Loading the numbers…</p>}>
        <Dashboard searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}
