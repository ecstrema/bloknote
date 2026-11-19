import type { OsmFeature } from "osm-api";
import type { DataTree } from "#lib/types.js";
import { featureToTypeOSM, getClimbingStyles, getGrade, isMultipitchRoute, parseClimbingLength } from "../parse/osm-tags.js";
import { getLocalizedName } from "../parse/localized-name.js";
import { getImagesFromTags } from "#components/topo/topo-helpers.js";
import { collectLoadedOsmNodes } from "../parse/diagnostics.js";

function escapeTypst(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("#", "\\#")
    .replaceAll("$", "\\$")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]")
    .replaceAll("<", "\\<")
    .replaceAll(">", "\\>")
    .replaceAll("@", "\\@")
    .replaceAll("*", "\\*")
    .replaceAll("_", "\\_")
    .replaceAll("`", "\\`");
}

function escapeTypstString(value: string): string {
  return JSON.stringify(value);
}

export interface TypstExportSection {
  title: string;
  description?: string;
  images: string[];
  routes: {
    name: string;
    grade: string;
    style: string;
    length: string;
    pitches: string;
    description: string;
  }[];
}

export function buildTypstDocument(root: DataTree, rootSlug: string, extraElements: OsmFeature[] = []): string {
  const title = getLocalizedName(root.feature) || "Climbing Sector";
  const description = root.feature.type !== "geographic" ? root.feature.tags?.description?.trim() : undefined;
  const ownImages = root.feature.type !== "geographic" ? getImagesFromTags(root.feature.tags).map((i) => i.title) : [];

  const featureMap = collectLoadedOsmNodes(root, rootSlug);
  const allFeatures = [...featureMap.values()];
  for (const extra of extraElements) {
    if (!allFeatures.some((f) => f.type === extra.type && f.id === extra.id)) {
      allFeatures.push(extra);
    }
  }

  const routes = allFeatures
    .filter((f) => featureToTypeOSM(f) === "route")
    .map((f) => {
      const tags = f.tags ?? {};
      const grade = getGrade(tags)?.v.v ?? "—";
      const styles = getClimbingStyles(tags).map((s) => s.label).join(", ") || "—";
      const len = parseClimbingLength(tags["climbing:length"])?.meters;
      const length = len !== undefined ? `${len} m` : "—";
      const pitches = tags["climbing:pitches"]?.trim() || (isMultipitchRoute(tags) ? "2+" : "1");
      return {
        name: getLocalizedName(f) || "Unnamed",
        grade,
        style: styles,
        length,
        pitches,
        description: tags.description?.trim() ?? "",
      };
    });

  const lines: string[] = [
    `#set page(paper: "a4", margin: 1.5cm)`,
    `#set text(font: "Inter", size: 10pt)`,
    "",
    `= ${escapeTypst(title)}`,
  ];

  if (description) {
    lines.push("", escapeTypst(description));
  }

  if (ownImages.length > 0) {
    lines.push("", "== Topos & Images", ...ownImages.map((img) => `- ${escapeTypst(img)}`));
  }

  lines.push("", `== Routes (${routes.length})`);

  if (routes.length === 0) {
    lines.push("", "_No routes recorded in this sector._");
  } else {
    lines.push(
      "",
      "#table(",
      "  columns: (2.2fr, 0.8fr, 1.2fr, 0.7fr, 0.6fr, 2.5fr),",
      "  inset: 6pt,",
      "  align: horizon,",
      "  table.header([*Route*], [*Grade*], [*Style*], [*Length*], [*Pitches*], [*Notes*]),",
    );
    for (const r of routes) {
      lines.push(
        `  [${escapeTypst(r.name)}], [${escapeTypst(r.grade)}], [${escapeTypst(r.style)}], [${escapeTypst(r.length)}], [${escapeTypst(r.pitches)}], [${escapeTypst(r.description)}],`,
      );
    }
    lines.push(")");
  }

  lines.push(
    "",
    `#align(right)[#text(size: 8pt, fill: luma(120))[Exported from Bloknote · OpenStreetMap (${escapeTypstString(rootSlug)})]]`,
    "",
  );

  return lines.join("\n");
}
