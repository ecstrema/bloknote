import type { TickStyle } from "@bloknote/common";

export type TickImportFormat = "mountainproject" | "thecrag" | "8anu" | "sendage" | "ukclimbing" | "openclimbing";

export interface ImportedTick {
  routeName: string;
  grade?: string;
  cragName?: string;
  /** Full hierarchical location, when the export provides one (MountainProject) */
  location?: string;
  /** Area path used to scope the OSM matching: deepest segment first (see matchTicks) */
  area?: string;
  /** Climbing style of the route as written in the export (Sport, Trad, Boulder...) */
  routeType?: string;
  /** Ascent style, when the export states one: unknown styles are not set (issue #274) */
  style?: TickStyle;
  /** ISO ascent date, when provided */
  date?: string;
  notes?: string;
}

export interface ParsedTickCsv {
  format: TickImportFormat;
  ticks: ImportedTick[];
  /** Rows that could not be parsed, with the reason */
  errors: string[];
}

/** Minimal RFC 4180 CSV parser: quoted values, escaped quotes, commas and newlines inside quotes */
export function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let inQuotes = false;
  for (let i = 0; i < csv.length; i++) {
    const char = csv[i]!;
    if (inQuotes) {
      if (char === '"') {
        if (csv[i + 1] === '"') {
          value += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        value += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(value);
      value = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && csv[i + 1] === "\n") i++;
      row.push(value);
      value = "";
      rows.push(row);
      row = [];
    } else {
      value += char;
    }
  }
  if (value !== "" || row.length > 0) {
    row.push(value);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

/** MountainProject ascent styles, mapped to the app's tick styles. Unknown styles are not set:
 * ticks do not need a style (issue #274). */
function mountainProjectStyle(leadStyle: string | undefined): TickStyle | undefined {
  const lead = leadStyle?.trim().toLowerCase();
  if (lead === "onsight") return "onsight";
  if (lead === "flash") return "flash";
  if (lead === "pinkpoint") return "pinkpoint";
  if (lead === "redpoint" || lead === "frenchfree") return "redpoint";
  return undefined;
}

/** TheCrag ascent types, mapped to the app's tick styles (undefined when unknown, issue #274) */
function theCragStyle(ascentType: string | undefined): TickStyle | undefined {
  const type = ascentType?.trim().toLowerCase();
  if (type === "onsight") return "onsight";
  if (type === "flash") return "flash";
  if (type === "pinkpoint") return "pinkpoint";
  if (type === "hangdog") return "hangdog";
  if (type === "bailed") return "bailed";
  if (type === "send" || type === "redpoint" || type === "top rope" || type === "repeat") return "redpoint";
  return undefined;
}

/** Maps ascent types shared by 8a.nu, Sendage, and OpenClimbing exports (abbreviations included) */
function ascentTypeStyle(ascentType: string | undefined): TickStyle | undefined {
  const type = ascentType?.trim().toLowerCase();
  if (type === "onsight" || type === "os") return "onsight";
  if (type === "flash" || type === "fl") return "flash";
  if (type === "redpoint" || type === "rp") return "redpoint";
  if (type === "bailed" || type === "bail" || type === "dnf") return "bailed";
  return undefined;
}

/** UKClimbing logbook styles, mapped to the app's tick styles (undefined when unknown, issue #274) */
function ukcStyle(style: string | undefined): TickStyle | undefined {
  const value = style?.trim().toLowerCase();
  if (value === "onsight") return "onsight";
  if (value === "flash") return "flash";
  if (value === "bailed") return "bailed";
  // UKC does not distinguish redpoints from onsights: a logged lead, solo, or boulder is a send
  if (value === "lead" || value === "solo" || value === "boulder") return "redpoint";
  return undefined;
}

const clean = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

/** Deepest location segment: "International > Canada > Alberta > Hemingway Wall" -> "Hemingway Wall" */
function lastLocationSegment(location: string | undefined): string | undefined {
  return clean(location?.split(">").at(-1));
}

/** Full hierarchical location split into segments: "International > Canada > Hemingway Wall" -> ["International", ...] */
export function locationSegments(location: string | undefined): string[] | undefined {
  const segments = (location ?? "")
    .split(">")
    .map(clean)
    .filter((segment): segment is string => !!segment);
  return segments.length > 0 ? segments : undefined;
}

function normalizeDate(value: string | undefined): string | undefined {
  const trimmed = clean(value);
  if (!trimmed) return undefined;
  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

const MONTHS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

/** UKClimbing exports dates as 31/May/23: two-digit years count from 2000 below 69, 1900 above */
function ukcDate(value: string | undefined): string | undefined {
  const match = clean(value)?.match(/^(\d{1,2})\/([A-Za-z]{3})\/(\d{2})$/);
  if (!match) return normalizeDate(value);
  const month = MONTHS[match[2]!.toLowerCase()];
  if (month === undefined) return undefined;
  const year = Number(match[3]) + (Number(match[3]) < 69 ? 2000 : 1900);
  return new Date(Date.UTC(year, month, Number(match[1]))).toISOString();
}

/**
 * Parses a tick logbook CSV exported from MountainProject (profile > see all ticks > export),
 * TheCrag (dashboard > actions > logbook CSV), 8a.nu (profile > edit > download CSV at the
 * bottom), Sendage (profile > export), UKClimbing (logbook > export), or OpenClimbing. Returns
 * undefined when the headers match none of the formats (issues #154, #256, #259, #260, #255).
 */
export function parseTickCsv(csv: string): ParsedTickCsv | undefined {
  const rows = parseCsv(csv);
  if (rows.length === 0) return undefined;
  // Sendage exports start with two preamble lines: the header row is the one containing "Send Type"
  const headerRow = Math.max(
    0,
    rows.findIndex((row) => row.some((cell) => cell.trim().toLowerCase() === "send type")),
  );
  const headers = rows[headerRow]!.map((h) => h.trim());
  const index = (name: string): number => headers.findIndex((h) => h.toLowerCase() === name.toLowerCase());

  let format: TickImportFormat;
  let getTick: (row: string[]) => ImportedTick | { error: string };
  if (index("route_boulder") !== -1 && index("location_name") !== -1) {
    // 8a.nu: location_name is the crag and sector_name the sector inside it (issue #256)
    format = "8anu";
    const col = (name: string) => index(name);
    getTick = (row) => {
      const routeName = clean(row[col("name")]);
      if (!routeName) return { error: "Missing route name" };
      const crag = clean(row[col("location_name")]);
      const sector = clean(row[col("sector_name")]);
      const location = ["country_code", "area_name", "location_name", "sector_name"]
        .map((name) => clean(row[col(name)]))
        .filter((segment): segment is string => !!segment);
      return {
        routeName,
        grade: clean(row[col("difficulty")]),
        cragName: crag,
        area: sector ?? crag,
        location: location.length > 0 ? location.join(" > ") : undefined,
        routeType: clean(row[col("route_boulder")]),
        style: ascentTypeStyle(row[col("type")]),
        // The time of day does not matter for ticks: keep the date only, so parsing does not depend
        // on the local timezone ("2024-08-04 12:00:00" would otherwise shift by the UTC offset)
        date: normalizeDate(row[col("date")]?.slice(0, 10)),
        notes: clean(row[col("comment")]),
      };
    };
  } else if (index("send type") !== -1 && index("climb") !== -1) {
    format = "sendage";
    const col = (name: string) => index(name);
    getTick = (row) => {
      const routeName = clean(row[col("Climb")]);
      if (!routeName) return { error: "Missing route name" };
      const area = clean(row[col("Area")]);
      const country = clean(row[col("Country")]);
      return {
        routeName,
        grade: clean(row[col("Grade")]),
        cragName: area,
        area,
        location: [country, area].filter((segment) => !!segment).join(" > ") || undefined,
        routeType: clean(row[col("Climb Type")]),
        style: ascentTypeStyle(row[col("Send Type")]),
        date: normalizeDate(row[col("Date")]),
        notes: clean(row[col("Comments")]),
      };
    };
  } else if (index("crag") !== -1 && index("county") !== -1) {
    format = "ukclimbing";
    const col = (name: string) => index(name);
    getTick = (row) => {
      const routeName = clean(row[col("Name")]);
      if (!routeName) return { error: "Missing route name" };
      const crag = clean(row[col("Crag")]);
      const location = ["Country", "Region", "County", "Crag"]
        .map((name) => clean(row[col(name)]))
        .filter((segment): segment is string => !!segment);
      return {
        routeName,
        grade: clean(row[col("Grade")]),
        cragName: crag,
        area: crag,
        location: location.length > 0 ? location.join(" > ") : undefined,
        routeType: clean(row[col("Type")]),
        style: ukcStyle(row[col("Style")]),
        date: ukcDate(row[col("Date")]),
        notes: clean(row[col("Notes")]),
      };
    };
  } else if (index("route_short_id") !== -1 && index("route_name") !== -1) {
    format = "openclimbing";
    const col = (name: string) => index(name);
    getTick = (row) => {
      const routeName = clean(row[col("route_name")]);
      if (!routeName) return { error: "Missing route name" };
      const crag = clean(row[col("crag")]);
      const area = clean(row[col("area")]);
      return {
        routeName,
        grade: clean(row[col("route_grade")]),
        cragName: crag ?? area,
        area: crag ?? area,
        location: [area, crag].filter((segment) => !!segment).join(" > ") || undefined,
        routeType: undefined,
        style: ascentTypeStyle(row[col("style")]),
        date: normalizeDate(row[col("date")]),
        notes: clean(row[col("note")]),
      };
    };
  } else if (index("Ascent ID") !== -1 && index("Crag Name") !== -1) {
    format = "thecrag";
    const col = (name: string) => index(name);
    getTick = (row) => {
      const routeName = clean(row[col("Route Name")]);
      if (!routeName) return { error: "Missing route name" };
      return {
        routeName,
        grade: clean(row[col("Ascent Grade")]) ?? clean(row[col("Route Grade")]),
        cragName: clean(row[col("Crag Name")]),
        area: clean(row[col("Crag Path")]) ?? clean(row[col("Crag Name")]),
        routeType: clean(row[col("Ascent Gear Style")]) ?? clean(row[col("Route Gear Style")]),
        style: theCragStyle(row[col("Ascent Type")]),
        date: normalizeDate(row[col("Ascent Date")]),
        notes: clean(row[col("Comment")]),
      };
    };
  } else if (index("Lead Style") !== -1 || (index("Route Type") !== -1 && index("URL") !== -1)) {
    format = "mountainproject";
    const col = (name: string) => index(name);
    getTick = (row) => {
      const routeName = clean(row[col("Route")]);
      if (!routeName) return { error: "Missing route name" };
      return {
        routeName,
        grade: clean(row[col("Rating")]),
        cragName: lastLocationSegment(row[col("Location")]),
        location: clean(row[col("Location")]),
        area: clean(row[col("Location")]),
        routeType: clean(row[col("Route Type")]),
        style: mountainProjectStyle(row[col("Lead Style")]),
        date: normalizeDate(row[col("Date")]),
        notes: clean(row[col("Notes")]),
      };
    };
  } else {
    return undefined;
  }

  const ticks: ImportedTick[] = [];
  const errors: string[] = [];
  // Sendage leaves the date empty on the rows of a day already announced: carry the last date down
  let previousDate: string | undefined;
  for (const [i, row] of rows.slice(headerRow + 1).entries()) {
    const parsed = getTick(row);
    if ("error" in parsed) {
      errors.push(`Row ${i + headerRow + 2}: ${parsed.error}`);
      continue;
    }
    if (format === "sendage") {
      if (parsed.date) previousDate = parsed.date;
      else parsed.date = previousDate;
    }
    ticks.push(parsed);
  }
  return { format, ticks, errors };
}
