import type { Outcome, ReasonCode } from "./classification";
import { OUTCOMES } from "./classification";
import { numberEnv } from "./env";
import { istDate, istParts } from "./hours";
import { db, must } from "./supabase";

/** Everything the dashboard shows, computed from Supabase. No numbers are typed in by hand. */

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
  name: string | null;
  locality: string | null;
  bhk: string | null;
  outcome: Outcome | null;
  reasonCode: ReasonCode | null;
  reasonDetail: string | null;
  booked: boolean;
};

type CallJoin = {
  id: string;
  started_at: string;
  enquiry_at: string;
  duration_seconds: number;
  after_hours: boolean;
  direction: string;
  source: string;
  status: string;
  leads: { name: string | null; locality: string | null; bhk: string | null; outcome: Outcome; reason_code: ReasonCode; reason_detail: string | null; bookings: { id: string } | { id: string }[] | null }[] | { name: string | null; locality: string | null; bhk: string | null; outcome: Outcome; reason_code: ReasonCode; reason_detail: string | null; bookings: { id: string } | { id: string }[] | null } | null;
};

const one = <T,>(x: T | T[] | null | undefined): T | null => (Array.isArray(x) ? (x[0] ?? null) : (x ?? null));

function toFeed(c: CallJoin): FeedItem {
  const lead = one(c.leads);
  return {
    id: c.id,
    startedAt: c.started_at,
    durationSeconds: c.duration_seconds,
    afterHours: c.after_hours,
    direction: c.direction,
    source: c.source,
    status: c.status,
    name: lead?.name || null,
    locality: lead?.locality || null,
    bhk: lead?.bhk || null,
    outcome: lead?.outcome ?? null,
    reasonCode: lead?.reason_code ?? null,
    reasonDetail: lead?.reason_detail ?? null,
    booked: !!one(lead?.bookings),
  };
}

const CALL_SELECT = "id, started_at, enquiry_at, duration_seconds, after_hours, direction, source, status, leads(name, locality, bhk, outcome, reason_code, reason_detail, bookings(id))";

export async function recentFeed(limit = 12): Promise<FeedItem[]> {
  const rows = must<CallJoin[]>(await db().from("calls").select(CALL_SELECT).order("started_at", { ascending: false }).limit(limit), "load feed");
  return rows.map(toFeed);
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export async function dashboardMetrics(range: RangeKey, now = new Date()) {
  const { from, to } = rangeBounds(range, now);
  let callsQ = db().from("calls").select(CALL_SELECT).order("started_at", { ascending: false });
  let costsQ = db().from("costs").select("source, amount_inr, units, created_at");
  if (from) {
    callsQ = callsQ.gte("started_at", from.toISOString());
    costsQ = costsQ.gte("created_at", from.toISOString());
  }
  if (to) {
    callsQ = callsQ.lt("started_at", to.toISOString());
    costsQ = costsQ.lt("created_at", to.toISOString());
  }
  const monthStart = rangeBounds("month", now).from!;
  const [callsRes, costsRes, monthCostsRes] = await Promise.all([
    callsQ,
    costsQ,
    db().from("costs").select("amount_inr").gte("created_at", monthStart.toISOString()),
  ]);
  const calls = must<CallJoin[]>(callsRes, "load calls").map((c) => ({ raw: c, feed: toFeed(c) }));
  const costs = must<{ source: string; amount_inr: number; units: number }[]>(costsRes, "load costs");
  const monthCosts = must<{ amount_inr: number }[]>(monthCostsRes, "load month costs");

  const answered = calls.filter((c) => c.raw.duration_seconds > 0);
  const outcomes = Object.fromEntries(OUTCOMES.map((o) => [o, 0])) as Record<Outcome, number>;
  const rejections: Partial<Record<ReasonCode, number>> = {};
  for (const { feed } of calls) {
    if (!feed.outcome) continue;
    outcomes[feed.outcome]++;
    if (feed.outcome === "REJECTED" && feed.reasonCode) rejections[feed.reasonCode] = (rejections[feed.reasonCode] ?? 0) + 1;
  }
  const qualified = outcomes.QUALIFIED;
  const booked = calls.filter((c) => c.feed.booked).length;

  const costBySource: Record<string, { amount: number; units: number }> = {};
  for (const c of costs) {
    costBySource[c.source] ??= { amount: 0, units: 0 };
    costBySource[c.source].amount += Number(c.amount_inr);
    costBySource[c.source].units += Number(c.units);
  }
  const costInRange = costs.reduce((a, c) => a + Number(c.amount_inr), 0);
  const costThisMonth = monthCosts.reduce((a, c) => a + Number(c.amount_inr), 0);

  const responseSeconds = calls.map((c) => Math.max(0, (Date.parse(c.raw.started_at) - Date.parse(c.raw.enquiry_at)) / 1000));

  return {
    range,
    rangeLabel: RANGES[range],
    callsAnswered: answered.length,
    totalCalls: calls.length,
    afterHoursPct: calls.length ? (calls.filter((c) => c.raw.after_hours).length / calls.length) * 100 : 0,
    medianFirstResponseSeconds: median(responseSeconds),
    qualified,
    booked,
    costInRange,
    costThisMonth,
    costPerQualified: qualified ? costInRange / qualified : null,
    pipelineEstimate: qualified * PIPELINE_VALUE_PER_QUALIFIED,
    outcomes,
    rejections,
    costBySource,
    vaaniRatePerMin: numberEnv("VAANI_RATE_PER_MIN", 6),
    feed: calls.slice(0, 12).map((c) => c.feed),
  };
}
export type DashboardMetrics = Awaited<ReturnType<typeof dashboardMetrics>>;

export async function callDetail(callId: string) {
  const call = await db().from("calls").select("*").eq("id", callId).maybeSingle();
  if (!call.data) return null;
  const lead = await db().from("leads").select("*, bookings(*, designers(name, email))").eq("call_id", callId).maybeSingle();
  const costs = await db().from("costs").select("source, units, unit_label, amount_inr").eq("call_id", callId);
  return { call: call.data, lead: lead.data, costs: costs.data ?? [] };
}
export type CallDetail = NonNullable<Awaited<ReturnType<typeof callDetail>>>;
