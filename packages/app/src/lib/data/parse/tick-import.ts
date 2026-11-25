import type { TickStyle } from "@bloknote/common";

export type TickImportFormat = "mountainproject" | "thecrag";

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
  style: TickStyle;
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

/** MountainProject ascent styles, mapped to the app's tick styles */
function mountainProjectStyle(leadStyle: string | undefined): TickStyle {
  const lead = leadStyle?.trim().toLowerCase();
  if (lead === "onsight") return "onsight";
  if (lead === "flash") return "flash";
  if (lead === "pinkpoint") return "pinkpoint";
  if (lead === "redpoint" || lead === "frenchfree") return "redpoint";
  // Plain Lead / Follow / Top Rope / Solo styles do not distinguish clean ascents: conservatively
  // count them as hangdogs (attempts) rather than claiming a send
  return "hangdog";
}

/** TheCrag ascent types, mapped to the app's tick styles */
function theCragStyle(ascentType: string | undefined): TickStyle {
  const type = ascentType?.trim().toLowerCase();
  if (type === "onsight") return "onsight";
  if (type === "flash") return "flash";
  if (type === "pinkpoint") return "pinkpoint";
  if (type === "hangdog") return "hangdog";
  if (type === "bailed") return "bailed";
  if (type === "send" || type === "redpoint" || type === "top rope" || type === "repeat") return "redpoint";
  return "hangdog";
}

const clean = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

/** Deepest location segment: "International > Canada > Alberta > Hemingway Wall" -> "Hemingway Wall" */
function lastLocationSegment(location: string | undefined): string | undefined {
  return clean(location?.split(">").at(-1));
}

function normalizeDate(value: string | undefined): string | undefined {
  const trimmed = clean(value);
  if (!trimmed) return undefined;
  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/**
 * Parses a tick logbook CSV exported from MountainProject (profile > see all ticks > export)
 * or TheCrag (dashboard > actions > logbook CSV). Returns undefined when the headers match
 * neither format (issue #154).
 */
export function parseTickCsv(csv: string): ParsedTickCsv | undefined {
  const rows = parseCsv(csv);
  if (rows.length === 0) return undefined;
  const headers = rows[0]!.map((h) => h.trim());
  const index = (name: string): number => headers.findIndex((h) => h.toLowerCase() === name.toLowerCase());

  let format: TickImportFormat;
  let getTick: (row: string[]) => ImportedTick | { error: string };
  if (index("Ascent ID") !== -1 && index("Crag Name") !== -1) {
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
  for (const [i, row] of rows.slice(1).entries()) {
    const parsed = getTick(row);
    if ("error" in parsed) errors.push(`Row ${i + 2}: ${parsed.error}`);
    else ticks.push(parsed);
  }
  return { format, ticks, errors };
}
