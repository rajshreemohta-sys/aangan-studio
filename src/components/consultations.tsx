import Link from "next/link";
import { formatIst } from "@/lib/hours";
import { designerConsultations, type Consultation } from "@/lib/metrics";
import { Window } from "./ui";

const when = (c: Consultation) => formatIst(c.starts_at, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const place = (c: Consultation) => (/studio/i.test(c.visit_type ?? "") ? "At the studio" : /site|visit|home|flat/i.test(c.visit_type ?? "") ? "Site visit" : "Place to confirm");

function Meeting({ c, past }: { c: Consultation; past?: boolean }) {
  return (
    <li className={`p-4 rounded-[10px] border border-line bg-white ${past ? "opacity-60" : ""}`}>
      <p className="num text-[15px]">{when(c)}</p>
      <Link href={`/dashboard/calls/${c.call_id}`} className="block mt-1 hover:underline underline-offset-4">
        {c.client_name || "Client"}
      </Link>
      <p className="text-xs text-muted mt-0.5">
        {[c.locality, c.bhk || c.property_type].filter(Boolean).join(" · ") || "—"} · {place(c)}
      </p>
      {c.calendar_event_url && (
        <a href={c.calendar_event_url} target="_blank" rel="noreferrer" className="inline-block text-xs mt-2 text-blue underline underline-offset-4">
          Open in Google Calendar ↗
        </a>
      )}
    </li>
  );
}

/** Each designer's real calendar bookings — the proof that qualified calls become meetings. */
export async function DesignerConsultations() {
  const { designers, upcoming, past, simulatedCount } = await designerConsultations();
  return (
    <Window title={`designer calendars · ${upcoming.length} upcoming · google calendar`} className="fade-up">
      <div className="grid md:grid-cols-3 gap-4 p-4 md:p-5">
        {designers.map((d) => {
          const mine = upcoming.filter((c) => c.designer_id === d.id);
          const done = past.filter((c) => c.designer_id === d.id).slice(0, 2);
          return (
            <div key={d.id} className="rounded-[14px] bg-[#f6f4ee] p-3">
              <div className="flex items-baseline justify-between px-1 pb-3">
                <p>{d.name}</p>
                <span className="text-xs text-muted">{mine.length} upcoming</span>
              </div>
              <ul className="flex flex-col gap-2">
                {mine.map((c) => (
                  <Meeting key={c.booking_id} c={c} />
                ))}
                {!mine.length && <li className="text-sm text-muted px-1 pb-2">Free — no consultations booked.</li>}
                {done.map((c) => (
                  <Meeting key={c.booking_id} c={c} past />
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      {simulatedCount > 0 && (
        <p className="px-5 pb-4 text-xs text-muted">
          Plus {simulatedCount} slots reserved for the September case calls, which were loaded as sample data and aren&apos;t on the real calendars.
        </p>
      )}
    </Window>
  );
}
