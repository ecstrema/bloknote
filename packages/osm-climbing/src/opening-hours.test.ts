import { beforeAll, describe, expect, it } from "vitest";
import {
  applyOpeningHoursDrag,
  canEditOpeningHoursGraph,
  DAYS,
  formatOpeningHours,
  formatTime,
  isValidOpeningHours,
  loadOpeningHours,
  normalizeRanges,
  parseOpeningHours,
  prettifyOpeningHours,
  snapMinutes,
  type WeekHours,
} from "./opening-hours.js";

const emptyWeek = (): WeekHours => DAYS.map(() => []);

describe("opening-hours", () => {
  beforeAll(async () => {
    await loadOpeningHours();
  });
  it("formats times including midnight end of day as 24:00", () => {
    expect(formatTime(0)).toBe("00:00");
    expect(formatTime(600)).toBe("10:00");
    expect(formatTime(1440)).toBe("24:00");
    expect(formatTime(1560)).toBe("02:00");
  });

  it("snaps and clamps minutes", () => {
    expect(snapMinutes(-10)).toBe(0);
    expect(snapMinutes(548)).toBe(555);
    expect(snapMinutes(547)).toBe(540);
    expect(snapMinutes(1500)).toBe(1440);
  });

  it("merges overlapping and adjacent ranges", () => {
    expect(
      normalizeRanges([
        { start: 840, end: 1320 },
        { start: 540, end: 720 },
        { start: 720, end: 840 },
      ]),
    ).toEqual([{ start: 540, end: 1320 }]);
  });

  it("serializes empty weeks as undefined and full weeks as 24/7", () => {
    expect(formatOpeningHours(emptyWeek())).toBeUndefined();
    expect(formatOpeningHours(DAYS.map(() => [{ start: 0, end: 1440 }]))).toBe("24/7");
  });

  it("groups consecutive and non-consecutive days cleanly and round-trips", () => {
    const input = "Mo-Fr 10:00-22:00; Sa-Su 10:00-18:00";
    const parsed = parseOpeningHours(input)!;
    expect(formatOpeningHours(parsed)).toBe(input);

    const split = "Mo-Tu,Th-Fr 09:00-12:00,14:00-21:00";
    const parsedSplit = parseOpeningHours(split)!;
    expect(formatOpeningHours(parsedSplit)).toBe(split);

    const late = "Fr-Sa 18:00-02:00";
    const parsedLate = parseOpeningHours(late)!;
    expect(formatOpeningHours(parsedLate)).toBe(late);
    expect(parseOpeningHours(formatOpeningHours(parsedLate)!)).toEqual(parsedLate);
  });

  it("parses complex OSM opening_hours rules via the opening_hours library", () => {
    // 24/7
    expect(parseOpeningHours("24/7")).toEqual(DAYS.map(() => [{ start: 0, end: 1440 }]));

    // Rule subtraction / off override
    const withBreak = parseOpeningHours("Mo-Fr 08:00-22:00; We 10:00-14:00 off")!;
    expect(withBreak[0]).toEqual([{ start: 480, end: 1320 }]);
    expect(withBreak[2]).toEqual([
      { start: 480, end: 600 },
      { start: 840, end: 1320 },
    ]);

    // Sunday overnight spillover stays attached to Sunday rather than duplicating on Monday
    const sundayLate = parseOpeningHours("Su 18:00-02:00")!;
    expect(sundayLate[0]).toEqual([]);
    expect(sundayLate[6]).toEqual([{ start: 1080, end: 1560 }]);

    // Public holiday rule, open-ended hours, comments, and sunrise-sunset
    expect(parseOpeningHours("Mo-Fr 09:00-22:00; Sa,Su 10:00-20:00; PH closed")).toBeDefined();
    expect(parseOpeningHours("Mo-Fr 09:00+")).toBeDefined();
    expect(parseOpeningHours("sunrise-sunset", { lat: 48.8566, lon: 2.3522 })).toBeDefined();
    expect(parseOpeningHours('Mo-Fr 09:00-18:00 "by appointment"')).toBeDefined();

    // Daily times without explicit weekday prefix
    expect(parseOpeningHours("09:00-21:00")).toEqual(DAYS.map(() => [{ start: 540, end: 1260 }]));

    // Invalid syntax returns undefined
    expect(parseOpeningHours("not valid hours")).toBeUndefined();
    expect(isValidOpeningHours("Mo-Fr 09:00-18:00")).toBe(true);
    expect(isValidOpeningHours("not valid hours")).toBe(false);
  });

  it("prettifies and detects whether a schedule can be losslessly edited in the graph", () => {
    expect(prettifyOpeningHours("mo-fr 9:00-22:00")).toBe("Mo-Fr 09:00-22:00");
    expect(canEditOpeningHoursGraph("")).toBe(true);
    expect(canEditOpeningHoursGraph("Mo-Fr 09:00-22:00; Sa-Su 10:00-18:00")).toBe(true);
    expect(canEditOpeningHoursGraph("Mo-Fr 08:00-22:00; We 10:00-14:00 off")).toBe(true);
    expect(canEditOpeningHoursGraph("Mo-Fr 09:00-22:00; PH off")).toBe(false);
    expect(canEditOpeningHoursGraph('Mo-Fr 09:00-18:00 "note"')).toBe(false);
    expect(canEditOpeningHoursGraph("invalid")).toBe(false);
  });

  it("applies resize, move, create, and copy-day drag operations", () => {
    const initial = parseOpeningHours("Mo 10:00-22:00")!;

    const resized = applyOpeningHoursDrag(
      { mode: "resize-start", day: 0, index: 0, initialWeek: initial, minStart: 0, maxEnd: 1440 },
      540,
      0,
    );
    expect(formatOpeningHours(resized)).toBe("Mo 09:00-22:00");

    const moved = applyOpeningHoursDrag(
      {
        mode: "move",
        day: 0,
        index: 0,
        initialWeek: initial,
        originMinutes: 720,
        initialStart: 600,
        initialEnd: 1320,
        minStart: 0,
        maxEnd: 1440,
      },
      780,
      0,
    );
    expect(formatOpeningHours(moved)).toBe("Mo 11:00-23:00");

    const created = applyOpeningHoursDrag(
      { mode: "create", day: 1, initialWeek: initial, anchorMinutes: 540, minStart: 0, maxEnd: 1440 },
      1080,
      1,
    );
    expect(formatOpeningHours(created)).toBe("Mo 10:00-22:00; Tu 09:00-18:00");

    const copied = applyOpeningHoursDrag(
      { mode: "copy-day", sourceDay: 0, targetDay: 0, initialWeek: initial },
      600,
      4,
    );
    expect(formatOpeningHours(copied)).toBe("Mo-Fr 10:00-22:00");
  });
});
