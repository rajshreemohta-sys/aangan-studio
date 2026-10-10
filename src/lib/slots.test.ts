import { describe, expect, it } from "vitest";
import { findSlot, parsePreference } from "./slots";
import { istDate, istParts } from "./hours";

// Thursday 8 Oct 2026, 9:00 IST
const now = istDate(2026, 10, 8, 9, 0);
const designer = (id: string, last: Date | null = null, busy: { start: Date; end: Date }[] = []) => ({ id, lastAssignedAt: last, busy });

describe("parsePreference", () => {
  it("reads weekdays after 6pm or weekends", () => {
    const p = parsePreference("Weekdays after 6pm or weekends only");
    expect([...p.days!].sort()).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(p.from).toBe(18 * 60);
  });
  it("reads Saturday morning", () => {
    const p = parsePreference("Any Saturday morning");
    expect([...p.days!]).toEqual([6]);
    expect([p.from, p.to]).toEqual([600, 780]);
  });
  it("defaults to any working day 10–7", () => {
    expect(parsePreference("")).toEqual({ days: null, from: 600, to: 1140 });
  });
  it("reads a specific time", () => {
    for (const text of ["Saturday at 3pm", "saturday 3 pm", "Sat 15:00", "Saturday at 3", "shanivar 3 baje"]) {
      const p = parsePreference(text);
      expect([...p.days!], text).toEqual([6]);
      expect([p.from, p.to], text).toEqual([900, 960]);
    }
    expect(parsePreference("Tuesday 11:30 am")).toMatchObject({ from: 690, to: 750 });
  });
  it("doesn't mistake flat sizes for times", () => {
    expect(parsePreference("weekends, it's a 3 bhk")).toMatchObject({ from: 600, to: 1140 });
  });
});

describe("findSlot", () => {
  it("books exactly the time asked for", () => {
    const s = findSlot([designer("a")], parsePreference("Saturday at 3pm"), now)!;
    expect(istParts(s.start)).toMatchObject({ day: 10, weekday: 6, hour: 15, minute: 0 });
  });
  it("gives 3pm to whichever designer is free then", () => {
    const busy = [{ start: istDate(2026, 10, 10, 15), end: istDate(2026, 10, 10, 16) }];
    const s = findSlot([designer("a", null, busy), designer("b", istDate(2026, 10, 1))], parsePreference("Saturday at 3pm"), now)!;
    expect(s.designerId).toBe("b");
    expect(istParts(s.start)).toMatchObject({ day: 10, hour: 15 });
  });
  it("books nothing if nobody is free at that time in the next 7 working days", () => {
    const busy = [{ start: istDate(2026, 10, 10, 15), end: istDate(2026, 10, 10, 16) }];
    expect(findSlot([designer("a", null, busy)], parsePreference("Saturday at 3pm"), now)).toBeNull();
  });

  it("takes the first slot after the lead time", () => {
    const s = findSlot([designer("a")], parsePreference(""), now)!;
    expect(istParts(s.start)).toMatchObject({ day: 8, hour: 11, minute: 0 });
  });

  it("skips busy time and breaks ties by least recently assigned", () => {
    const busyA = [{ start: istDate(2026, 10, 8, 11), end: istDate(2026, 10, 8, 12) }];
    const s = findSlot(
      [designer("a", null, busyA), designer("b", istDate(2026, 10, 1)), designer("c", istDate(2026, 9, 1))],
      parsePreference(""),
      now,
    )!;
    expect(s.designerId).toBe("c");
    expect(istParts(s.start).hour).toBe(11);
  });

  it("respects preferred days and skips Sundays", () => {
    const s = findSlot([designer("a")], parsePreference("weekends"), now)!;
    expect(istParts(s.start)).toMatchObject({ day: 10, weekday: 6, hour: 10 });
  });

  it("returns null when nothing fits in 7 working days", () => {
    const allBusy = [{ start: istDate(2026, 10, 1), end: istDate(2026, 11, 1) }];
    expect(findSlot([designer("a", null, allBusy)], parsePreference(""), now)).toBeNull();
  });
});
