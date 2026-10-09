import { CRITERION_LABELS, REASON_LABELS, type Criterion, type CriterionId, type Outcome, type ReasonCode } from "@/lib/classification";
import { formatIst } from "@/lib/hours";
import type { CallDetail } from "@/lib/metrics";
import { inr, OutcomeChip, Window } from "./ui";

const VERDICT_STYLE: Record<string, string> = { pass: "bg-blue text-white", fail: "bg-ink text-white", unclear: "bg-pink text-ink" };

type Step = { step: string; status: string; detail: string };

export function CallView({ detail, internal }: { detail: CallDetail; internal: boolean }) {
  const { call, lead, costs } = detail;
  const criteria = (lead?.criteria ?? []) as Criterion[];
  const flags = (lead?.flags ?? []) as string[];
  const booking = Array.isArray(lead?.bookings) ? lead.bookings[0] : lead?.bookings;
  const steps = ((lead?.routing as { steps?: Step[] })?.steps ?? []) as Step[];
  const fields: [string, string | null | undefined][] = lead
    ? [
        ["Name", lead.name],
        ["Phone", lead.phone || call.caller_phone],
        ["Email", lead.email],
        ["Locality", lead.locality],
        ["Property", [lead.property_type, lead.bhk].filter(Boolean).join(" · ")],
        ["Carpet area", lead.carpet_area],
        ["Scope", lead.scope],
        ["Execution or advice", lead.execution_or_advice],
        ["Completion needed", lead.completion_date],
        ["Owned / rented", lead.ownership],
        ["Decision-maker", lead.decision_maker],
        ["Budget (volunteered)", lead.budget_volunteered],
        ["Consultation preference", lead.consultation_preference],
        ["Site visit or studio", lead.visit_type],
        ["Heard of us via", lead.lead_source],
      ]
    : [];

  return (
    <div className="grid lg:grid-cols-[1.1fr_1fr] gap-6 items-start">
      <div className="flex flex-col gap-6">
        <div className="card p-6 fade-up">
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <OutcomeChip outcome={(lead?.outcome as Outcome) ?? null} />
            {lead && lead.outcome !== "QUALIFIED" && <span className="chip">{REASON_LABELS[lead.reason_code as ReasonCode] ?? lead.reason_code}</span>}
            {call.after_hours && <span className="chip">After hours</span>}
            {lead?.confidence != null && <span className="chip num">Confidence {Number(lead.confidence).toFixed(2)}</span>}
          </div>
          {lead?.summary ? (
            <p className="text-lg leading-relaxed whitespace-pre-line">{lead.summary}</p>
          ) : (
            <p className="text-muted">{call.status === "failed" ? `Processing failed: ${call.error}` : "Still being classified…"}</p>
          )}
          {lead?.reason_detail && lead.outcome !== "QUALIFIED" && <p className="text-sm text-muted mt-3">Reason: {lead.reason_detail}</p>}
          {lead?.clarifying_question && (
            <p className="text-sm mt-3">
              <span className="label mr-2">Ask on callback</span>
              {lead.clarifying_question}
            </p>
          )}
        </div>

        {booking && (
          <div className="panel bg-lime p-6 fade-up" style={{ ["--i" as string]: 1 }}>
            <p className="label">Consultation {booking.status === "simulated" ? "(simulated — seed data)" : "booked"}</p>
            <p className="display text-3xl mt-2">{formatIst(booking.starts_at, { weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" })}</p>
            <p className="mt-1">with {booking.designers?.name ?? "a designer"} · {booking.visit_type || "place to confirm"}</p>
          </div>
        )}

        {flags.length > 0 && (
          <div className="card p-6 fade-up" style={{ ["--i" as string]: 2 }}>
            <p className="label mb-3">Flags for the designer</p>
            <ul className="list-disc pl-5 space-y-1.5">
              {flags.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
        )}

        {lead && (
          <div className="card p-6 fade-up" style={{ ["--i" as string]: 3 }}>
            <p className="label mb-4">What we know</p>
            <dl className="grid grid-cols-[minmax(120px,38%)_1fr] gap-x-4 gap-y-2.5 text-sm">
              {fields.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted">{k}</dt>
                  <dd>{v && v.trim() ? v : <span className="text-[#b3b0a8]">not collected</span>}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        {criteria.length > 0 && (
          <div className="card p-6 fade-up" style={{ ["--i" as string]: 4 }}>
            <p className="label mb-4">Qualification criteria</p>
            <ul className="flex flex-col gap-4">
              {criteria.map((c) => (
                <li key={c.id} className="flex gap-3">
                  <span className={`chip !border-0 h-fit ${VERDICT_STYLE[c.verdict]}`}>{c.verdict}</span>
                  <div className="min-w-0">
                    <p>{CRITERION_LABELS[c.id as CriterionId] ?? c.id}</p>
                    <p className="text-sm text-muted mt-0.5">{c.note}</p>
                    {c.evidence && c.evidence !== "not mentioned" && <p className="text-sm italic mt-1">“{c.evidence}”</p>}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {internal && (steps.length > 0 || costs.length > 0) && (
          <div className="card p-6 fade-up" style={{ ["--i" as string]: 5 }}>
            <p className="label mb-4">What the system did</p>
            <ul className="text-sm flex flex-col gap-2">
              {steps.map((s, i) => (
                <li key={i} className="flex gap-3">
                  <span className={`dot mt-1.5 ${s.status === "ok" ? "bg-blue" : s.status === "failed" ? "bg-[#d0342c]" : "bg-[#c9c5bb]"}`} />
                  <span className="w-36 flex-none">{s.step}</span>
                  <span className="text-muted break-words min-w-0">{s.detail}</span>
                </li>
              ))}
            </ul>
            {costs.length > 0 && (
              <p className="text-xs text-muted mt-4">
                Cost of this call:{" "}
                {costs.map((c) => `${c.source} ${inr(Number(c.amount_inr), 2)}`).join(" · ")} = {inr(costs.reduce((a, c) => a + Number(c.amount_inr), 0), 2)}
              </p>
            )}
          </div>
        )}
      </div>

      <Window title={`transcript · ${formatIst(call.started_at)} · ${Math.round(call.duration_seconds / 60)} min`} className="fade-up lg:sticky lg:top-6">
        <div className="p-5 max-h-[78vh] overflow-auto text-[15px] leading-relaxed space-y-2.5">
          {call.raw_transcript ? (
            call.raw_transcript.split("\n").map((line: string, i: number) => {
              const m = line.match(/^(Agent|Vaani|Front Desk|Caller):\s*(.*)$/);
              if (!m) return <p key={i} className="label pt-2">{line}</p>;
              const agent = m[1] !== "Caller";
              return (
                <p key={i} className={agent ? "text-muted" : ""}>
                  <span className={`label mr-2 ${agent ? "" : "!text-ink"}`}>{agent ? "Vaani" : "Caller"}</span>
                  {m[2]}
                </p>
              );
            })
          ) : (
            <p className="text-muted">No transcript — the call was missed or dropped.</p>
          )}
        </div>
      </Window>
    </div>
  );
}
