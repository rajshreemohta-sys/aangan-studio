import Link from "next/link";
import { Suspense } from "react";
import { DoneBadge } from "@/components/follow-ups";
import { Nav, OutcomeChip } from "@/components/ui";
import { OUTCOME_LABELS, OUTCOMES, REASON_LABELS, type Outcome, type ReasonCode } from "@/lib/classification";
import { formatIst } from "@/lib/hours";
import { listLeads } from "@/lib/metrics";

export const metadata = { title: "Leads · Aangan Studio" };

function href(params: Record<string, string | null>) {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString();
  return `/dashboard/leads${q ? `?${q}` : ""}`;
}

async function Leads({ searchParams }: { searchParams: PageProps<"/dashboard/leads">["searchParams"] }) {
  const sp = await searchParams;
  const outcome = typeof sp.outcome === "string" && (OUTCOMES as readonly string[]).includes(sp.outcome) ? (sp.outcome as Outcome) : null;
  const search = typeof sp.q === "string" ? sp.q : null;
  const leads = await listLeads({ outcome, search });

  return (
    <>
      <section className="pt-6">
        <div className="flex flex-wrap items-end justify-between gap-4 mb-8 fade-up">
          <div>
            <p className="label">Every enquiry</p>
            <h1 className="display text-5xl md:text-7xl mt-3">All leads</h1>
          </div>
          <form action="/dashboard/leads" className="flex gap-2">
            {outcome && <input type="hidden" name="outcome" value={outcome} />}
            <input name="q" defaultValue={search ?? ""} className="input !py-2 text-sm w-56" placeholder="Search name, phone, area…" aria-label="Search leads" />
            <button className="btn btn-ghost !py-2" type="submit">
              Search
            </button>
          </form>
        </div>
        <div className="flex flex-wrap gap-1.5 mb-4" role="group" aria-label="Filter by outcome">
          <Link href={href({ q: search })} className={`chip ${!outcome ? "!bg-ink !text-white !border-ink" : "hover:border-ink"}`}>
            All
          </Link>
          {OUTCOMES.map((o) => (
            <Link key={o} href={href({ outcome: o, q: search })} className={`chip ${outcome === o ? "!bg-ink !text-white !border-ink" : "hover:border-ink"}`}>
              {OUTCOME_LABELS[o]}
            </Link>
          ))}
        </div>

        <div className="card overflow-x-auto fade-up">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b border-line">
                {["Caller", "Property", "Outcome", "Consultation", "Called", "Team status"].map((h) => (
                  <th key={h} className="label font-normal px-4 py-3 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {leads.map((l) => (
                <tr key={l.id} className="align-top hover:bg-[#faf8f3]">
                  <td className="px-4 py-3">
                    <Link href={`/dashboard/calls/${l.call_id}`} className="hover:underline underline-offset-4">
                      {l.name || "Unknown caller"}
                    </Link>
                    <div className="text-xs text-muted">{[l.phone, l.email].filter(Boolean).join(" · ") || "—"}</div>
                  </td>
                  <td className="px-4 py-3">
                    {[l.locality, l.bhk || l.property_type].filter(Boolean).join(" · ") || "—"}
                    {l.scope && <div className="text-xs text-muted max-w-[260px] truncate">{l.scope}</div>}
                  </td>
                  <td className="px-4 py-3">
                    <OutcomeChip outcome={l.outcome as Outcome} />
                    {l.outcome !== "QUALIFIED" && <div className="text-xs text-muted mt-1">{REASON_LABELS[l.reason_code as ReasonCode] ?? l.reason_code}</div>}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {l.booking_starts_at ? (
                      <>
                        {formatIst(l.booking_starts_at, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
                        <div className="text-xs text-muted">{l.designer_name}</div>
                      </>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {formatIst(l.started_at, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
                    {l.after_hours && <div className="text-xs text-muted">after hours</div>}
                  </td>
                  <td className="px-4 py-3">
                    {l.follow_up_status === "open" ? <Link href={l.outcome === "ESCALATED" ? "/dashboard/client-care" : "/dashboard/review"} className="chip !bg-pink !border-pink hover:underline">{l.outcome === "ESCALATED" ? "In client care" : "In desk review"}</Link> : l.follow_up_status === "done" ? <DoneBadge lead={l} /> : <span className="text-muted">—</span>}
                  </td>
                </tr>
              ))}
              {!leads.length && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted">
                    No leads match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

export default function LeadsPage(props: PageProps<"/dashboard/leads">) {
  return (
    <main className="max-w-[1180px] mx-auto px-4 md:px-8 pb-24">
      <Nav active="leads" />
      <Suspense fallback={<p className="label py-24">Loading leads…</p>}>
        <Leads searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}
