import Link from "next/link";
import { completeFollowUp, reopenFollowUp } from "@/app/dashboard/leads/actions";
import type { Outcome } from "@/lib/classification";
import { formatIst } from "@/lib/hours";
import type { LeadListItem } from "@/lib/metrics";
import { CallButton } from "./call-button";
import { OutcomeChip } from "./ui";

function since(d: string): string {
  const h = (Date.now() - new Date(d).getTime()) / 3_600_000;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${Math.round(h)} h`;
  return `${Math.round(h / 24)} days`;
}

/** The front desk's to-do list: every call a person still has to act on. */
export function FollowUpList({ items, empty = "Nothing waiting. Every call has been handled." }: { items: LeadListItem[]; empty?: string }) {
  if (!items.length) return <p className="p-6 text-muted text-sm">{empty}</p>;
  return (
    <ul className="divide-y divide-line">
      {items.map((l) => (
        <li key={l.id} className="p-5 flex flex-col md:flex-row md:items-start gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/dashboard/calls/${l.call_id}`} className="text-lg hover:underline underline-offset-4">
                {l.name || "Unknown caller"}
              </Link>
              <OutcomeChip outcome={l.outcome as Outcome} />
              <span className="text-xs text-muted">waiting {since(l.started_at)}</span>
            </div>
            <p className="text-sm text-muted mt-1">
              {[l.locality, l.bhk || l.property_type].filter(Boolean).join(" · ") || "Details not collected"}
              {l.phone ? (
                <>
                  {" · "}
                  <a href={`tel:${l.phone}`} className="text-ink underline underline-offset-4">
                    {l.phone}
                  </a>
                </>
              ) : (
                " · no phone on file — check the transcript"
              )}
            </p>
            {l.follow_up_reason && <p className="text-sm mt-2 leading-relaxed">{l.follow_up_reason}</p>}
          </div>
          <div className="flex flex-col sm:flex-row gap-3 md:w-[480px] flex-none">
            <CallButton leadId={l.id} hasPhone={!!l.phone} lastStatus={l.dispatch_status} lastAt={l.dispatch_at ? new Date(l.dispatch_at).toISOString() : null} />
            <form action={completeFollowUp} className="flex gap-2 flex-1">
              <input type="hidden" name="lead_id" value={l.id} />
              <input name="note" className="input !py-2 text-sm" placeholder="What happened? (optional)" aria-label={`Note for ${l.name || "caller"}`} />
              <button className="btn !py-2 whitespace-nowrap" type="submit">
                Done
              </button>
            </form>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function DoneBadge({ lead }: { lead: LeadListItem }) {
  return (
    <form action={reopenFollowUp} className="flex items-center gap-2">
      <input type="hidden" name="lead_id" value={lead.id} />
      <span className="text-xs text-muted">
        done {lead.follow_up_done_at ? formatIst(lead.follow_up_done_at, { day: "numeric", month: "short" }) : ""}
        {lead.follow_up_note ? ` — ${lead.follow_up_note}` : ""}
      </span>
      <button type="submit" className="text-xs underline underline-offset-4 cursor-pointer">
        reopen
      </button>
    </form>
  );
}
