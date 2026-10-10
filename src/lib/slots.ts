import { istDate, istParts } from "./hours";

/**
 * Picks a consultation slot: the earliest free 60-minute slot, 10am–7pm IST, within
 * the next 7 working days, that matches the client's stated preference. When several
 * designers are free at that slot, the one assigned least recently gets it.
 */

export type Interval = { start: Date; end: Date };
export type DesignerAvailability = { id: string; lastAssignedAt: Date | null; busy: Interval[] };
/** Days the client can do (null = any working day) and a window in minutes after midnight, IST. */
export type Preference = { days: Set<number> | null; from: number; to: number };
export type Slot = { designerId: string; start: Date; end: Date };

const DAY_START = 10;
const DAY_END = 19;
const SLOT_MINUTES = 60;
const STEP_MINUTES = 30;
const LEAD_TIME_MINUTES = 120;
export const WORKING_DAYS = new Set([1, 2, 3, 4, 5, 6]); // Mon–Sat

const DAY_WORDS: [RegExp, number][] = [
  [/\bsun(day)?s?\b|ravivar/i, 0],
  [/\bmon(day)?s?\b|somvar/i, 1],
  [/\btue(s|sday)?s?\b|mangalvar/i, 2],
  [/\bwed(nesday)?s?\b|budhvar/i, 3],
  [/\bthu(rs|rsday)?s?\b|guruvar/i, 4],
  [/\bfri(day)?s?\b|shukravar/i, 5],
  [/\bsat(urday)?s?\b|shanivar/i, 6],
];

/** "3 pm" / "3:30pm" / "at 3" / "15:00" / "3 baje" → minutes after midnight. Bare numbers 1–7 are afternoon. */
function clock(h: number, m: number, mer?: string): number | null {
  if (h > 23 || m > 59) return null;
  if (mer === "pm" && h < 12) h += 12;
  else if (mer === "am" && h === 12) h = 0;
  else if (!mer && h >= 1 && h <= 7) h += 12;
  return h * 60 + m;
}

/** Reads free-text preferences like "weekdays after 6pm or weekends", "Saturday morning", "Saturday at 3pm". */
export function parsePreference(text: string | null | undefined): Preference {
  const t = (text ?? "").toLowerCase();
  let days: Set<number> | null = null;
  const add = (...d: number[]) => {
    days ??= new Set();
    d.forEach((x) => days!.add(x));
  };
  if (/weekday/.test(t)) add(1, 2, 3, 4, 5);
  if (/weekend/.test(t)) add(6, 0);
  for (const [re, d] of DAY_WORDS) if (re.test(t)) add(d);

  let from = DAY_START * 60;
  let to = DAY_END * 60;
  if (/morning|subah|sakal/.test(t)) [from, to] = [10 * 60, 13 * 60];
  else if (/afternoon|dopahar|dupar/.test(t)) [from, to] = [12 * 60, 17 * 60];
  else if (/evening|shaam|sandhyakal/.test(t)) [from, to] = [16 * 60, 19 * 60];

  const after = t.match(/after\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  const before = t.match(/before\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (after) from = clock(+after[1], +(after[2] ?? 0), after[3]) ?? from;
  if (before) to = clock(+before[1], +(before[2] ?? 0), before[3]) ?? to;

  // A specific time ("3pm", "at 3:30", "15:00", "3 baje") → exactly that hour-long slot.
  if (!after && !before) {
    const at =
      t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)/) ??
      t.match(/\b(?:at|around|by|@)\s*(\d{1,2})(?::(\d{2}))?\b(?!\s*(?:bhk|sq|lakh|days?|weeks?|months?))/) ??
      t.match(/\b(\d{1,2}):(\d{2})\b/) ??
      t.match(/\b(\d{1,2})(?::(\d{2}))?\s*baje/);
    if (at) {
      const mer = at[3]?.replace(/\./g, "") as "am" | "pm" | undefined;
      const start = clock(+at[1], +(at[2] ?? 0), mer);
      if (start !== null) [from, to] = [start, start + SLOT_MINUTES];
    }
  }
  from = Math.max(DAY_START * 60, Math.min(from, DAY_END * 60 - SLOT_MINUTES));
  to = Math.min(DAY_END * 60, Math.max(to, from + SLOT_MINUTES));
  return { days, from, to };
}

const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;

export function findSlot(designers: DesignerAvailability[], pref: Preference, now: Date, workingDays = WORKING_DAYS): Slot | null {
  if (!designers.length) return null;
  const earliest = new Date(now.getTime() + LEAD_TIME_MINUTES * 60_000);
  const today = istParts(now);
  let workingDaysSeen = 0;

  for (let offset = 0; workingDaysSeen < 7 && offset < 21; offset++) {
    const dayStart = istDate(today.year, today.month, today.day + offset);
    const { weekday, year, month, day } = istParts(new Date(dayStart.getTime() + 12 * 3600_000));
    if (!workingDays.has(weekday)) continue;
    workingDaysSeen++;
    if (pref.days && !pref.days.has(weekday)) continue;

    for (let m = pref.from; m + SLOT_MINUTES <= pref.to; m += STEP_MINUTES) {
      const start = istDate(year, month, day, Math.floor(m / 60), m % 60);
      if (start < earliest) continue;
      const slot = { start, end: new Date(start.getTime() + SLOT_MINUTES * 60_000) };
      const free = designers.filter((d) => !d.busy.some((b) => overlaps(b, slot)));
      if (!free.length) continue;
      free.sort((a, b) => (a.lastAssignedAt?.getTime() ?? 0) - (b.lastAssignedAt?.getTime() ?? 0));
      return { designerId: free[0].id, ...slot };
    }
  }
  return null;
}
