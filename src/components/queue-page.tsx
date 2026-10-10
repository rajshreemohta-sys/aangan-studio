import { openFollowUps, type Queue } from "@/lib/metrics";
import { FollowUpList } from "./follow-ups";
import { Window } from "./ui";

const COPY: Record<Queue, { label: string; heading: (n: number) => string; empty: string; intro: string; panel: string; window: string}> = {
  review: {
    label: "Desk review",
    heading: (n) => (n ? `${n} ${n === 1 ? "lead" : "leads"} to review.` : "All caught up."),
    intro: "New enquiries Vaani couldn't fully qualify or book — details were unclear, the call ended early, or no slot matched. The desk team calls each one back, then marks it done with a short note.",
    empty: "Nothing waiting. Every new enquiry has been handled.",
    panel: "bg-pink",
    window: "to review · oldest first",
  },
  care: {
    label: "Client care",
    heading: (n) => (n ? `${n} existing-client ${n === 1 ? "concern" : "concerns"}.` : "No open concerns."),
    intro: "Existing clients who called about an ongoing project — a complaint, a delay, or a request to speak to someone senior. Nikhil is emailed the moment one comes in; a senior person should call back the same day.",
    empty: "No open concerns from existing clients.",
    panel: "bg-lime",
    window: "existing-client concerns · oldest first",
  },
};

export async function QueuePage({ queue }: { queue: Queue }) {
  const c = COPY[queue];
  const open = await openFollowUps(queue);
  return (
    <>
      <section className="pt-6 pb-10 fade-up">
        <p className="label">{c.label}</p>
        <h1 className="display text-5xl md:text-7xl mt-3">{c.heading(open.length)}</h1>
        <p className="text-muted mt-4 max-w-2xl leading-relaxed">{c.intro}</p>
      </section>

      <section className={`panel ${c.panel} p-4 md:p-8 fade-up`} style={{ ["--i" as string]: 1 }}>
        <Window title={c.window}>
          <FollowUpList items={open} empty={c.empty} />
        </Window>
      </section>

    </>
  );
}
