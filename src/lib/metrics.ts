import type { Outcome, ReasonCode } from "./classification";
import { OUTCOMES } from "./classification";
import type { BookingRow, CallRow, CostRow, LeadRow } from "./database.types";
import { one, query } from "./db";
import { numberEnv } from "./env";
import { istDate, istParts } from "./hours";

/** Everything the dashboard shows, computed from the database. No numbers are typed in by hand. */

export const RANGES = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  month: "This month",
  last_month: "Last month",
  all: "All time",
} as const;
export type RangeKey = keyof typeof RANGES;

export const PIPELINE_VALUE_PER_QUALIFIED = 1_100_000;

export function rangeBounds(key: RangeKey, now = new Date()): { from: Date | null; to: Date | null } {
  const { year, month } = istParts(now);
  switch (key) {
    case "7d":
      return { from: new Date(now.getTime() - 7 * 86_400_000), to: null };
    case "30d":
      return { from: new Date(now.getTime() - 30 * 86_400_000), to: null };
    case "month":
      return { from: istDate(year, month, 1), to: null };
    case "last_month":
      return { from: istDate(month === 1 ? year - 1 : year, month === 1 ? 12 : month - 1, 1), to: istDate(year, month, 1) };
    default:
      return { from: null, to: null };
  }
}

export type FeedItem = {
  id: string;
  startedAt: string;
  durationSeconds: number;
  afterHours: boolean;
  direction: string;
  source: string;
  status: string;
  channel: string;
  name: string | null;
  locality: string | null;
  bhk: string | null;
  outcome: Outcome | null;
  reasonCode: ReasonCode | null;
  reasonDetail: string | null;
  booked: boolean;
};

type CallWithLead = {
  id: string;
  started_at: string;
  enquiry_at: string;
  duration_seconds: number;
  after_hours: boolean;
  direction: string;
  source: string;
  status: string;
  channel: string;
  name: string | null;
  locality: string | null;
  bhk: string | null;
  outcome: Outcome | null;
  reason_code: ReasonCode | null;
  reason_detail: string | null;
  booked: boolean;
};

const CALLS_WITH_LEADS = `
  select c.id, c.started_at, c.enquiry_at, c.duration_seconds, c.after_hours, c.direction, c.source, c.status, c.channel,
         l.name, l.locality, l.bhk, l.outcome, l.reason_code, l.reason_detail, (b.id is not null) as booked
  from calls c
  left join leads l on l.call_id = c.id
  left join bookings b on b.lead_id = l.id and b.status <> 'cancelled'`;

const toFeed = (c: CallWithLead): FeedItem => ({
  id: c.id,
  startedAt: new Date(c.started_at).toISOString(),
  durationSeconds: c.duration_seconds,
  afterHours: c.after_hours,
  direction: c.direction,
  source: c.source,
  status: c.status,
  channel: c.channel,
  name: c.name || null,
  locality: c.locality || null,
  bhk: c.bhk || null,
  outcome: c.outcome,
  reasonCode: c.reason_code,
  reasonDetail: c.reason_detail,
  booked: c.booked,
});

export async function recentFeed(limit = 12): Promise<FeedItem[]> {
  return (await query<CallWithLead>(`${CALLS_WITH_LEADS} order by c.started_at desc limit $1`, [limit])).map(toFeed);
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export async function dashboardMetrics(range: RangeKey, now = new Date()) {
  const { from, to } = rangeBounds(range, now);
  const fromIso = from?.toISOString() ?? null;
  const toIso = to?.toISOString() ?? null;
  const monthStart = rangeBounds("month", now).from!;

  const [calls, costs, monthCost, queues] = await Promise.all([
    query<CallWithLead>(
      `${CALLS_WITH_LEADS}
       where ($1::timestamptz is null or c.started_at >= $1) and ($2::timestamptz is null or c.started_at < $2)
       order by c.started_at desc`,
      [fromIso, toIso],
    ),
    query<{ source: string; amount: string; units: string }>(
      `select source, sum(amount_inr) as amount, sum(units) as units from costs
       where ($1::timestamptz is null or created_at >= $1) and ($2::timestamptz is null or created_at < $2)
       group by source`,
      [fromIso, toIso],
    ),
    one<{ amount: string | null }>("select sum(amount_inr) as amount from costs where created_at >= $1", [monthStart.toISOString()]),
    one<{ review: string; care: string }>(
      `select count(*) filter (where outcome <> 'ESCALATED') as review, count(*) filter (where outcome = 'ESCALATED') as care
       from leads where follow_up_status = 'open'`,
    ),
  ]);

  const outcomes = Object.fromEntries(OUTCOMES.map((o) => [o, 0])) as Record<Outcome, number>;
  const rejections: Partial<Record<ReasonCode, number>> = {};
  for (const c of calls) {
    if (!c.outcome) continue;
    outcomes[c.outcome]++;
    if (c.outcome === "REJECTED" && c.reason_code) rejections[c.reason_code] = (rejections[c.reason_code] ?? 0) + 1;
  }
  const qualified = outcomes.QUALIFIED;
  const booked = calls.filter((c) => c.booked).length;

  const costBySource: Record<string, { amount: number; units: number }> = {};
  for (const c of costs) costBySource[c.source] = { amount: Number(c.amount), units: Number(c.units) };
  const costInRange = costs.reduce((a, c) => a + Number(c.amount), 0);

  return {
    range,
    rangeLabel: RANGES[range],
    callsAnswered: calls.filter((c) => c.duration_seconds > 0).length,
    totalCalls: calls.length,
    afterHoursPct: calls.length ? (calls.filter((c) => c.after_hours).length / calls.length) * 100 : 0,
    medianFirstResponseSeconds: median(calls.map((c) => Math.max(0, (Date.parse(c.started_at) - Date.parse(c.enquiry_at)) / 1000))),
    qualified,
    booked,
    costInRange,
    costThisMonth: Number(monthCost?.amount ?? 0),
    costPerQualified: qualified ? costInRange / qualified : null,
    pipelineEstimate: qualified * PIPELINE_VALUE_PER_QUALIFIED,
    outcomes,
    rejections,
    costBySource,
    openReview: Number(queues?.review ?? 0),
    openCare: Number(queues?.care ?? 0),
    vaaniRatePerMin: numberEnv("VAANI_RATE_PER_MIN", 6),
    feed: calls.slice(0, 12).map(toFeed),
  };
}
export type DashboardMetrics = Awaited<ReturnType<typeof dashboardMetrics>>;

// ---------- leads & follow-ups ----------

export type LeadListItem = Pick<
  LeadRow,
  "id" | "call_id" | "outcome" | "reason_code" | "reason_detail" | "name" | "phone" | "email" | "locality" | "bhk" | "property_type" | "scope" | "follow_up_status" | "follow_up_reason" | "follow_up_note" | "follow_up_done_at" | "created_at"
> & {
  started_at: string;
  after_hours: boolean;
  booking_starts_at: string | null;
  designer_name: string | null;
  dispatch_status: string | null;
  dispatch_at: string | null;
  dispatch_error: string | null;
};

const LEAD_LIST = `
  select l.id, l.call_id, l.outcome, l.reason_code, l.reason_detail, l.name, l.phone, l.email, l.locality, l.bhk,
         l.property_type, l.scope, l.follow_up_status, l.follow_up_reason, l.follow_up_note, l.follow_up_done_at, l.created_at,
         c.started_at, c.after_hours, b.starts_at as booking_starts_at, d.name as designer_name,
         x.status as dispatch_status, x.created_at as dispatch_at, x.error as dispatch_error
  from leads l
  join calls c on c.id = l.call_id
  left join bookings b on b.lead_id = l.id and b.status <> 'cancelled'
  left join designers d on d.id = b.designer_id
  left join lateral (select status, created_at, error from dispatches where lead_id = l.id order by created_at desc limit 1) x on true`;

/**
 * Two queues: "review" — new enquiries the desk team must call back (unclear, incomplete, not booked);
 * "care" — existing clients who called with a problem (escalations). Oldest first, so nothing waits behind newer calls.
 */
export type Queue = "review" | "care";
const QUEUE_FILTER: Record<Queue, string> = { review: "l.outcome <> 'ESCALATED'", care: "l.outcome = 'ESCALATED'" };

export async function openFollowUps(queue: Queue, limit = 100): Promise<LeadListItem[]> {
  return query<LeadListItem>(`${LEAD_LIST} where l.follow_up_status = 'open' and ${QUEUE_FILTER[queue]} order by c.started_at asc limit $1`, [limit]);
}

export async function listLeads(filter: { outcome?: Outcome | null; followUp?: "open" | "done" | null; search?: string | null }): Promise<LeadListItem[]> {
  return query<LeadListItem>(
    `${LEAD_LIST}
     where ($1::text is null or l.outcome = $1)
       and ($2::text is null or l.follow_up_status = $2)
       and ($3::text is null or concat_ws(' ', l.name, l.phone, l.email, l.locality, l.scope) ilike '%' || $3 || '%')
     order by c.started_at desc limit 500`,
    [filter.outcome ?? null, filter.followUp ?? null, filter.search?.trim() || null],
  );
}

export async function callDetail(callId: string) {
  const call = await one<CallRow>("select * from calls where id = $1", [callId]);
  if (!call) return null;
  const lead = await one<LeadRow>("select * from leads where call_id = $1", [callId]);
  const booking = lead
    ? await one<BookingRow & { designer_name: string | null }>(
        "select b.*, d.name as designer_name from bookings b left join designers d on d.id = b.designer_id where b.lead_id = $1",
        [lead.id],
      )
    : null;
  const costs = await query<Pick<CostRow, "source" | "units" | "unit_label" | "amount_inr">>("select source, units, unit_label, amount_inr from costs where call_id = $1", [callId]);
  return { call, lead, booking, costs };
}
export type CallDetail = NonNullable<Awaited<ReturnType<typeof callDetail>>>;
