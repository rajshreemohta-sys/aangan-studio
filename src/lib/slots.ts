import { istDate, istParts } from "./hours";

/**
 * Picks a consultation slot: the earliest free 60-minute slot, 10am–7pm IST, within
 * the next 7 working days, that matches the client's stated preference. When several
 * designers are free at that slot, the one assigned least recently gets it.
 */

export type Interval = { start: Date; end: Date };
export type DesignerAvailability = { id: string; lastAssignedAt: Date | null; busy: Interval[] };
export type Preference = { days: Set<number> | null; fromHour: number; toHour: number };
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

/** Reads free-text preferences like "weekdays after 6pm or weekends", "Saturday morning". */
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

  let fromHour = DAY_START;
  let toHour = DAY_END;
  if (/morning|subah|sakal/.test(t)) [fromHour, toHour] = [10, 13];
  else if (/afternoon|dopahar|dupar/.test(t)) [fromHour, toHour] = [12, 17];
  else if (/evening|shaam|sandhyakal/.test(t)) [fromHour, toHour] = [16, 19];
  const after = t.match(/after\s+(\d{1,2})\s*(am|pm)?/);
  if (after) {
    let h = +after[1];
    if ((after[2] === "pm" || (!after[2] && h < 8)) && h < 12) h += 12;
    fromHour = Math.max(DAY_START, Math.min(h, DAY_END - 1));
  }
  const before = t.match(/before\s+(\d{1,2})\s*(am|pm)?/);
  if (before) {
    let h = +before[1];
    if ((before[2] === "pm" || (!before[2] && h < 8)) && h < 12) h += 12;
    toHour = Math.min(DAY_END, Math.max(h, DAY_START + 1));
  }
  return { days, fromHour, toHour };
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

    for (let m = pref.fromHour * 60; m + SLOT_MINUTES <= pref.toHour * 60; m += STEP_MINUTES) {
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
