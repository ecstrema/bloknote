import opening_hours from "opening_hours";

export const DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"] as const;

/** Minutes since midnight, `end` may be above 1440 for ranges closing after midnight */
export interface TimeRange {
  start: number;
  end: number;
}

export type WeekHours = TimeRange[][];

export interface OpeningHoursCoordinates {
  lat: number;
  lon: number;
}

const emptyWeek = (): WeekHours => DAYS.map(() => []);

function toNominatim(coordinates?: OpeningHoursCoordinates) {
  return coordinates ? { lat: String(coordinates.lat), lon: String(coordinates.lon) } : null;
}

function createOpeningHours(value: string, coordinates?: OpeningHoursCoordinates): opening_hours | undefined {
  const text = value.trim();
  if (!text) return undefined;
  try {
    return new opening_hours(text, toNominatim(coordinates));
  } catch {
    return undefined;
  }
}

/** Monday 00:00 of the current week in local time */
function getCurrentWeekMonday(): Date {
  const now = new Date();
  const mondayOffset = (now.getDay() + 6) % 7;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - mondayOffset, 0, 0, 0, 0);
}

function addDays(base: Date, days: number): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + days, 0, 0, 0, 0);
}

function localMinutes(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

/**
 * Parses an OSM `opening_hours` string using the `opening_hours` library into a 7-day schedule.
 * Returns `undefined` when the string is empty or has invalid OSM syntax.
 */
export function parseOpeningHours(
  value: string | undefined,
  coordinates?: OpeningHoursCoordinates,
): WeekHours | undefined {
  if (!value) return undefined;
  const oh = createOpeningHours(value, coordinates);
  if (!oh) return undefined;

  const mon = getCurrentWeekMonday();
  const dayMidnights = Array.from({ length: 9 }, (_, i) => addDays(mon, i));
  const intervals = oh.getOpenIntervals(dayMidnights[0]!, dayMidnights[8]!);

  const week = emptyWeek();

  for (const [start, end] of intervals) {
    if (end <= dayMidnights[0]! || start >= dayMidnights[7]!) continue;

    for (let day = 0; day < 7; day++) {
      const dayStart = dayMidnights[day]!;
      const dayEnd = dayMidnights[day + 1]!;
      const nextDayEnd = dayMidnights[day + 2]!;

      if (end <= dayStart || start >= dayEnd) continue;

      const startsOnThisDay = start >= dayStart;
      const startMin = startsOnThisDay ? localMinutes(start) : 0;

      // Overnight closing past midnight (e.g. 18:00-02:00) stays attached to the opening day
      if (startsOnThisDay && end > dayEnd && end < nextDayEnd) {
        const endNextMin = localMinutes(end);
        if (endNextMin > 0 && endNextMin < startMin) {
          week[day]!.push({ start: startMin, end: 1440 + endNextMin });
          break;
        }
      }

      const endMin = end >= dayEnd ? 1440 : localMinutes(end);
      if (endMin > startMin) {
        week[day]!.push({ start: startMin, end: endMin });
      }
    }
  }

  // Remove Sunday overnight spillover duplicated at the start of Monday
  const sundaySpill = week[6]!.find((r) => r.end > 1440);
  if (sundaySpill) {
    const spillEnd = sundaySpill.end - 1440;
    week[0] = week[0]!.flatMap((r) => {
      if (r.start === 0 && r.end <= spillEnd) return [];
      if (r.start === 0 && r.end > spillEnd && r.end < 1440) return [{ start: spillEnd, end: r.end }];
      return [r];
    });
  }

  return week.map((ranges) => normalizeRanges(ranges));
}

export function isValidOpeningHours(value: string | undefined, coordinates?: OpeningHoursCoordinates): boolean {
  return !!value && createOpeningHours(value, coordinates) !== undefined;
}

export function prettifyOpeningHours(
  value: string,
  coordinates?: OpeningHoursCoordinates,
): string | undefined {
  return createOpeningHours(value, coordinates)?.prettifyValue();
}

/**
 * Returns true when `value` can be losslessly edited via the weekly bar graph
 * (empty, or a week-stable schedule whose canonical `formatOpeningHours` round-trip matches).
 */
export function canEditOpeningHoursGraph(
  value: string | undefined,
  coordinates?: OpeningHoursCoordinates,
): boolean {
  const text = value?.trim();
  if (!text) return true;
  const oh = createOpeningHours(text, coordinates);
  if (!oh || !oh.isWeekStable()) return false;
  const week = parseOpeningHours(text, coordinates);
  if (!week) return false;
  const formatted = formatOpeningHours(week);
  if (!formatted) return false;
  const roundTripped = createOpeningHours(formatted, coordinates);
  return roundTripped ? oh.isEqualTo(roundTripped)[0] : false;
}

export function formatTime(minutes: number): string {
  const m = minutes % 1440 === 0 && minutes > 0 ? 1440 : minutes % 1440;
  const h = Math.floor(m / 60);
  return `${String(h).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export function snapMinutes(minutes: number, step = 15): number {
  return Math.max(0, Math.min(1440, Math.round(minutes / step) * step));
}

export function normalizeRanges(ranges: TimeRange[]): TimeRange[] {
  const sorted = [...ranges].filter((r) => r.end > r.start).sort((a, b) => a.start - b.start);
  const merged: TimeRange[] = [];
  for (const r of sorted) {
    const prev = merged.at(-1);
    if (prev && r.start <= prev.end) {
      prev.end = Math.max(prev.end, r.end);
    } else {
      merged.push({ start: r.start, end: r.end });
    }
  }
  return merged;
}

function formatDayGroup(days: number[]): string {
  const parts: string[] = [];
  let start = days[0]!;
  let prev = start;
  const pushRun = (a: number, b: number) => {
    parts.push(a === b ? DAYS[a]! : `${DAYS[a]}-${DAYS[b]}`);
  };
  for (let i = 1; i < days.length; i++) {
    const d = days[i]!;
    if (d === prev + 1) {
      prev = d;
    } else {
      pushRun(start, prev);
      start = d;
      prev = d;
    }
  }
  pushRun(start, prev);
  return parts.join(",");
}

export function cloneWeekHours(week: WeekHours): WeekHours {
  return week.map((ranges) => ranges.map((r) => ({ ...r })));
}

export const MIN_OPENING_DURATION = 15;

export type OpeningHoursDrag =
  | {
      mode: "resize-start" | "resize-end";
      day: number;
      index: number;
      initialWeek: WeekHours;
      minStart: number;
      maxEnd: number;
    }
  | {
      mode: "move";
      day: number;
      index: number;
      initialWeek: WeekHours;
      originMinutes: number;
      initialStart: number;
      initialEnd: number;
      minStart: number;
      maxEnd: number;
    }
  | {
      mode: "create";
      day: number;
      initialWeek: WeekHours;
      anchorMinutes: number;
      minStart: number;
      maxEnd: number;
    }
  | {
      mode: "copy-day";
      sourceDay: number;
      targetDay: number;
      initialWeek: WeekHours;
    };

export function applyOpeningHoursDrag(drag: OpeningHoursDrag, minutes: number, day: number): WeekHours {
  const next = cloneWeekHours(drag.initialWeek);

  if (drag.mode === "resize-start") {
    const range = next[drag.day]![drag.index]!;
    const upper = Math.min(range.end, drag.maxEnd) - MIN_OPENING_DURATION;
    range.start = Math.min(Math.max(snapMinutes(minutes), drag.minStart), upper);
  } else if (drag.mode === "resize-end") {
    const range = next[drag.day]![drag.index]!;
    const lower = range.start + MIN_OPENING_DURATION;
    range.end = Math.max(Math.min(snapMinutes(minutes), drag.maxEnd), lower);
  } else if (drag.mode === "move") {
    const rawDelta = Math.round((minutes - drag.originMinutes) / 15) * 15;
    const minDelta = drag.minStart - drag.initialStart;
    const maxDelta = drag.maxEnd - drag.initialEnd;
    const delta = Math.max(minDelta, Math.min(maxDelta, rawDelta));
    next[drag.day]![drag.index] = {
      start: drag.initialStart + delta,
      end: drag.initialEnd + delta,
    };
  } else if (drag.mode === "create") {
    const current = Math.max(drag.minStart, Math.min(drag.maxEnd, snapMinutes(minutes)));
    const start = Math.min(drag.anchorMinutes, current);
    const end = Math.max(drag.anchorMinutes, current);
    if (end - start >= MIN_OPENING_DURATION) {
      next[drag.day] = normalizeRanges([...next[drag.day]!, { start, end }]);
    }
  } else if (drag.mode === "copy-day") {
    const from = Math.min(drag.sourceDay, day);
    const to = Math.max(drag.sourceDay, day);
    const template = drag.initialWeek[drag.sourceDay]!;
    for (let d = from; d <= to; d++) {
      next[d] = template.map((r) => ({ ...r }));
    }
  }

  return next;
}

/**
 * Serializes a {@link WeekHours} schedule into canonical OSM `opening_hours` syntax.
 * Returns `undefined` when every day is closed.
 */
export function formatOpeningHours(week: WeekHours): string | undefined {
  const normalized = week.map((ranges) => normalizeRanges(ranges));
  const is247 = normalized.every((ranges) => ranges.length === 1 && ranges[0]!.start === 0 && ranges[0]!.end === 1440);
  if (is247) return "24/7";

  const bySchedule = new Map<string, number[]>();
  for (let day = 0; day < DAYS.length; day++) {
    const ranges = normalized[day] ?? [];
    if (ranges.length === 0) continue;
    const schedule = ranges.map((r) => `${formatTime(r.start)}-${formatTime(r.end)}`).join(",");
    const group = bySchedule.get(schedule) ?? [];
    group.push(day);
    bySchedule.set(schedule, group);
  }

  if (bySchedule.size === 0) return undefined;

  const raw = [...bySchedule.entries()].map(([schedule, days]) => `${formatDayGroup(days)} ${schedule}`).join("; ");
  return prettifyOpeningHours(raw) ?? raw;
}
