import { STUDIO_TZ } from "./env";

/** Studio-time helpers. Front desk hours are 10am–7pm IST, Monday–Saturday. */

const OPEN_HOUR = 10;
const CLOSE_HOUR = 19;

export function istParts(d: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: STUDIO_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { year: +get("year"), month: +get("month"), day: +get("day"), hour: +get("hour"), minute: +get("minute"), weekday };
}

export function isAfterHours(d: Date): boolean {
  const { hour, weekday } = istParts(d);
  return weekday === 0 || hour < OPEN_HOUR || hour >= CLOSE_HOUR;
}

/** A Date for the given IST wall-clock time. */
export function istDate(year: number, month: number, day: number, hour = 0, minute = 0): Date {
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - 330 * 60_000);
}

export function formatIst(d: Date | string, opts: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" }): string {
  return new Date(d).toLocaleString("en-IN", { timeZone: STUDIO_TZ, ...opts });
}
