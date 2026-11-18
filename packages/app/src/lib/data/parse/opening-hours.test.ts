import { describe, expect, it } from "vitest";
import {
  applyOpeningHoursDrag,
  DAYS,
  formatOpeningHours,
  formatTime,
  normalizeRanges,
  parseOpeningHours,
  snapMinutes,
  type WeekHours,
} from "./opening-hours.js";

const emptyWeek = (): WeekHours => DAYS.map(() => []);

describe("opening-hours", () => {
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
