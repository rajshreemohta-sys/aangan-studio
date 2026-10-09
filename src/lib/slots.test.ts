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
    expect(p.fromHour).toBe(18);
  });
  it("reads Saturday morning", () => {
    const p = parsePreference("Any Saturday morning");
    expect([...p.days!]).toEqual([6]);
    expect([p.fromHour, p.toHour]).toEqual([10, 13]);
  });
  it("defaults to any working day 10–7", () => {
    expect(parsePreference("")).toEqual({ days: null, fromHour: 10, toHour: 19 });
  });
});

describe("findSlot", () => {
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
