export const DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"] as const;

/** Minutes since midnight, `end` may be above 1440 for ranges closing after midnight */
export interface TimeRange {
  start: number;
  end: number;
}

export type WeekHours = TimeRange[][];

const emptyWeek = (): WeekHours => DAYS.map(() => []);

function parseTime(s: string): number | undefined {
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return;
  const minutes = Number(m[1]) * 60 + Number(m[2]);
  return minutes <= 24 * 60 ? minutes : undefined;
}

function parseDays(s: string): number[] | undefined {
  const days = new Set<number>();
  for (const part of s.split(",")) {
    const p = part.trim();
    if (p === "PH" || p === "SH") continue;
    const [a, b] = p.split("-").map((d) => DAYS.indexOf(d as (typeof DAYS)[number]));
    if (a === undefined || a < 0) return;
    if (p.includes("-")) {
      if (b === undefined || b < 0) return;
      for (let i = a; ; i = (i + 1) % 7) {
        days.add(i);
        if (i === b) break;
      }
    } else {
      days.add(a);
    }
  }
  return [...days];
}

/**
 * Parses the common subset of the OSM `opening_hours` syntax: `24/7`, day ranges and time ranges.
 * Returns undefined for anything else (months, weeks, sunrise, ...).
 */
export function parseOpeningHours(value: string | undefined): WeekHours | undefined {
  const text = value?.trim();
  if (!text) return;
  const week = emptyWeek();
  if (text === "24/7") return week.map(() => [{ start: 0, end: 1440 }]);

  for (const rule of text.split(";")) {
    const r = rule.trim();
    if (!r) continue;
    const m = r.match(/^(?:([A-Za-z,\- ]+?)\s+)?([\d:,\- ]+|off|closed)$/);
    if (!m) return;
    const days = m[1] ? parseDays(m[1].replace(/\s+/g, "")) : [0, 1, 2, 3, 4, 5, 6];
    if (!days) return;
    const times = m[2]!.trim();
    // A later rule overrides the days it names
    for (const d of days) week[d] = [];
    if (times === "off" || times === "closed") continue;
    const ranges: TimeRange[] = [];
    for (const range of times.split(",")) {
      const [from, to] = range
        .trim()
        .split("-")
        .map((t) => parseTime(t.trim()));
      if (from === undefined || to === undefined) return;
      ranges.push({ start: from, end: to <= from ? to + 1440 : to });
    }
    for (const d of days) week[d] = ranges;
  }
  return week;
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

  return [...bySchedule.entries()].map(([schedule, days]) => `${formatDayGroup(days)} ${schedule}`).join("; ");
}
