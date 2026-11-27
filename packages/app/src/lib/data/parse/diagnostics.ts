import type { DataJSON } from "@bloknote/climbing-data-gen";
import type { Key, OsmFeature, Tags } from "osm-api";
import type { DataTree } from "#lib/types.js";
import {
  featureToTypeOSM,
  getGrade,
  getTagRule,
  gradeTags,
  isProjectRoute,
  isViaFerrata,
  parseClimbingLength,
  scaleIdToTag,
} from "@bloknote/osm-climbing";
import { findDuplicatedRoutePartNames } from "./route-parts.js";

export type DiagnosticSeverity = "error" | "warning";

export interface DiagnosticPatch {
  set?: Partial<Record<Key, string>>;
  remove?: Key[];
}

export interface DiagnosticFix {
  label: string;
  patch: DiagnosticPatch;
}

export interface TagDiagnostic {
  id: string;
  severity: DiagnosticSeverity;
  title: string;
  description: string;
  tags: Key[];
  fixes?: DiagnosticFix[];
}

const GRADE_KEYS: Key[] = ["climbing:grade", ...gradeTags.map(([key]) => key)];
const SECONDARY_GRADE_KEYS = new Set<Key>(["climbing:grade:british_adjectival", "climbing:grade:yds_danger"]);
/** Tags set to their implicit default value: they carry no information and should be removed (issue #233) */
const REDUNDANT_DEFAULT_TAGS: [Key, string][] = [["deepwater", "no"]];
const nonEmpty = (value: string | undefined): value is string => value !== undefined && value.trim() !== "";

export function getAreaKindLabel(feature: OsmFeature): string {
  const climbing = feature.tags?.climbing?.split(";").map((s) => s.trim()) ?? [];
  if (climbing.includes("crag")) return "Crag";
  if (climbing.includes("boulder") || climbing.includes("bouldering")) return "Boulder";
  return "Area";
}

export function getFeatureDiagnostics(feature: OsmFeature, children?: OsmFeature[]): TagDiagnostic[] {
  const tags: Tags = feature.tags ?? {};
  const featureType = featureToTypeOSM(feature);
  const diagnostics: TagDiagnostic[] = [];

  for (const [key, defaultValue] of REDUNDANT_DEFAULT_TAGS) {
    if (tags[key] !== defaultValue) continue;
    diagnostics.push({
      id: `useless:${key}`,
      severity: "warning",
      title: `Useless "${key}=${defaultValue}" tag`,
      description: `"${key}=${defaultValue}" is the default value: it carries no information and should be removed.`,
      tags: [key],
      fixes: [{ label: `Remove ${key}`, patch: { remove: [key] } }],
    });
  }

  for (const rawKey of Object.keys(tags)) {
    const key = rawKey as Key;
    const value = tags[key];
    if (value === undefined) continue;
    const rule = getTagRule(featureType, key);
    if (!rule) continue;

    if (typeof rule === "object") {
      const fixes: DiagnosticFix[] = [];
      if (key === "ele" && featureType === "route" && !nonEmpty(tags["climbing:length"])) {
        const parsedLength = parseClimbingLength(value);
        if (parsedLength && parsedLength.meters > 0) {
          const metersStr = Number(parsedLength.meters.toFixed(2)).toString();
          fixes.push({
            label: `Move to climbing:length=${metersStr}`,
            patch: { set: { "climbing:length": metersStr }, remove: ["ele"] },
          });
        }
      }
      fixes.push({ label: `Remove ${key}`, patch: { remove: [key] } });
      diagnostics.push({
        id: `deprecated:${key}`,
        severity: "warning",
        title: `Deprecated tag "${key}"`,
        description: rule.deprecated,
        tags: [key],
        fixes,
      });
    } else if (!rule(value)) {
      const fixes: DiagnosticFix[] = [];
      if (key === "climbing:length") {
        const parsedLength = parseClimbingLength(value);
        if (parsedLength && parsedLength.meters > 0) {
          const metersStr = Number(parsedLength.meters.toFixed(2)).toString();
          fixes.push({ label: `Normalize to ${metersStr} m`, patch: { set: { "climbing:length": metersStr } } });
        }
      }
      diagnostics.push({
        id: `invalid:${key}`,
        severity: "error",
        title: `Invalid value for "${key}"`,
        description: `"${value}" is not a valid value for ${key}.`,
        tags: [key],
        fixes: fixes.length > 0 ? fixes : undefined,
      });
    }
  }

  // highway=via_ferrata elements do not need sport=climbing, per
  // https://wiki.openstreetmap.org/wiki/Tag:highway%3Dvia_ferrata (issue #251)
  if (featureType && tags.sport !== "climbing" && tags.highway !== "via_ferrata") {
    diagnostics.push({
      id: "missing:sport",
      severity: "warning",
      title: 'Missing "sport=climbing"',
      description: "Climbing elements on OpenStreetMap should carry sport=climbing.",
      tags: ["sport"],
      fixes: [{ label: "Set sport=climbing", patch: { set: { sport: "climbing" } } }],
    });
  }

  if (!nonEmpty(tags.name)) {
    diagnostics.push({
      id: "missing:name",
      severity: "warning",
      title: 'Missing "name" tag',
      description: "This feature has no name tag.",
      tags: ["name"],
    });
  }

  const presentGradeKeys = GRADE_KEYS.filter((k) => nonEmpty(tags[k]));
  const primaryGradeKeys = presentGradeKeys.filter((k) => !SECONDARY_GRADE_KEYS.has(k));

  if (primaryGradeKeys.length > 1) {
    diagnostics.push({
      id: "duplicate:grades",
      severity: "error",
      title: "Multiple grades set",
      description: `Found multiple grade tags: ${primaryGradeKeys.map((k) => `${k}=${tags[k]}`).join(", ")}.`,
      tags: primaryGradeKeys,
      fixes: primaryGradeKeys.map((keepKey) => ({
        label: `Keep ${keepKey} (${tags[keepKey]})`,
        patch: { remove: primaryGradeKeys.filter((k) => k !== keepKey) },
      })),
    });
  }

  if (nonEmpty(tags["climbing:grade"])) {
    const parsed = getGrade({ "climbing:grade": tags["climbing:grade"] });
    const fixes: DiagnosticFix[] = [];
    if (parsed && parsed.v.scale !== "unknown") {
      const targetKey = scaleIdToTag(parsed.v.scale);
      if (targetKey) {
        fixes.push({
          label: `Use ${targetKey}=${parsed.v.v}`,
          patch: { set: { [targetKey]: parsed.v.v }, remove: ["climbing:grade"] },
        });
      }
    }
    diagnostics.push({
      id: "generic:climbing:grade",
      severity: "warning",
      title: 'Generic "climbing:grade" tag',
      description:
        "Use a scale-specific tag (such as climbing:grade:french or climbing:grade:yds) instead of climbing:grade.",
      tags: ["climbing:grade"],
      fixes: fixes.length > 0 ? fixes : undefined,
    });
  }

  const project = isProjectRoute(tags);
  if (featureType === "route" && project && presentGradeKeys.length > 0) {
    diagnostics.push({
      id: "conflict:project-grade",
      severity: "error",
      title: "Project has a grade set",
      description: `This route is named "${tags.name}" but has a grade assigned (${presentGradeKeys.map((k) => tags[k]).join(", ")}). Projects are typically unclimbed and ungraded.`,
      tags: presentGradeKeys,
      fixes: [{ label: "Remove grade", patch: { remove: presentGradeKeys } }],
    });
  } else if (featureType === "route" && !project && presentGradeKeys.length === 0) {
    // A via ferrata graded only with the SAC hiking scale is not "missing" a grade (issue #234)
    if (!(isViaFerrata(tags) && nonEmpty(tags.sac_scale))) {
      diagnostics.push({
        id: "missing:grade",
        severity: "warning",
        title: "Missing grade",
        description: "This route does not have a grade tag.",
        tags: [],
      });
    }
  }

  if (nonEmpty(tags.phone) && nonEmpty(tags["contact:phone"])) {
    diagnostics.push({
      id: "duplicate:phone",
      severity: "warning",
      title: "Duplicate phone tags",
      description: `Both phone (${tags.phone}) and contact:phone (${tags["contact:phone"]}) are set.`,
      tags: ["phone", "contact:phone"],
      fixes: [
        { label: "Keep phone", patch: { remove: ["contact:phone"] } },
        { label: "Keep contact:phone", patch: { remove: ["phone"] } },
      ],
    });
  }

  const websiteKeys = (["website", "contact:website", "url"] as Key[]).filter((k) => nonEmpty(tags[k]));
  if (websiteKeys.length > 1) {
    diagnostics.push({
      id: "duplicate:website",
      severity: "warning",
      title: "Duplicate website tags",
      description: `Multiple website tags set: ${websiteKeys.join(", ")}.`,
      tags: websiteKeys,
      fixes: websiteKeys.map((keepKey) => ({
        label: `Keep ${keepKey}`,
        patch: { remove: websiteKeys.filter((k) => k !== keepKey) },
      })),
    });
  }

  const pitches = Number(tags["climbing:pitches"]?.trim());
  if (featureType === "route" && Number.isInteger(pitches) && pitches > 1 && tags["climbing:multipitch"] !== "yes") {
    diagnostics.push({
      id: "missing:multipitch-tag",
      severity: "warning",
      title: 'Missing "climbing:multipitch=yes"',
      description: `This route has ${pitches} pitches but is not tagged with climbing:multipitch=yes.`,
      tags: ["climbing:pitches", "climbing:multipitch"],
      fixes: [{ label: "Set climbing:multipitch=yes", patch: { set: { "climbing:multipitch": "yes" } } }],
    });
  }

  if (
    featureType === "area" &&
    tags.climbing === "crag" &&
    children?.some((child) => featureToTypeOSM(child) === "area")
  ) {
    diagnostics.push({
      id: "crag:has-subareas",
      severity: "warning",
      title: "Crag contains sub-areas",
      description:
        "A climbing=crag should only contain routes; use climbing=area when a node contains other areas or crags.",
      tags: ["climbing"],
      fixes: [{ label: "Change to climbing=area", patch: { set: { climbing: "area" } } }],
    });
  }

  // A multipitch route mapped with a bottom and a top point must only reference one of them in the
  // parent relation (see issue #135)
  if (children) {
    for (const name of findDuplicatedRoutePartNames(children)) {
      diagnostics.push({
        id: `duplicate:route-parts:${name.trim().toLowerCase().replace(/\s+/g, "-")}`,
        severity: "warning",
        title: `Route "${name}" has both a bottom and a top point`,
        description:
          "Two points of the same route (climbing=route_bottom and climbing=route_top) are referenced here. Only one of them (usually the bottom) should be a member of this relation: group the bottom and top points in a separate climbing=route relation instead, or leave the top point out of this relation.",
        tags: ["climbing"],
      });
    }
  }

  return diagnostics;
}

export interface DiagnosticEntry {
  slug: string;
  feature: OsmFeature;
  diagnostics: TagDiagnostic[];
}

export function collectLoadedOsmNodes(root: DataTree, rootSlug: string): Map<string, OsmFeature> {
  const map = new Map<string, OsmFeature>();
  const visit = (node: DataTree, nodeSlug: string) => {
    if (node.feature.type !== "geographic") map.set(nodeSlug, node.feature);
    for (const [childSlug, child] of Object.entries(node.children ?? {})) visit(child, childSlug);
  };
  visit(root, rootSlug);
  return map;
}

export function collectSubtreeDiagnostics(
  root: DataTree,
  rootSlug: string,
  dbElements: Record<string, DataJSON>,
  getReactiveNode: (slug: string) => DataTree | undefined,
): DiagnosticEntry[] {
  const merged = new Map<string, OsmFeature>();
  for (const [entrySlug, data] of Object.entries(dbElements)) {
    if (data.type !== "geographic") merged.set(entrySlug, data);
  }
  for (const [entrySlug, feature] of collectLoadedOsmNodes(root, rootSlug)) merged.set(entrySlug, feature);

  const childrenByParent = new Map<string, OsmFeature[]>();
  for (const [entrySlug, feature] of merged) {
    const slash = entrySlug.lastIndexOf("/");
    const parentSlug = slash === -1 ? "" : entrySlug.slice(0, slash);
    const reactiveFeature = getReactiveNode(entrySlug)?.feature;
    const effective = reactiveFeature && reactiveFeature.type !== "geographic" ? reactiveFeature : feature;
    const arr = childrenByParent.get(parentSlug) ?? [];
    arr.push(effective);
    childrenByParent.set(parentSlug, arr);
  }

  const list: DiagnosticEntry[] = [];
  for (const [entrySlug, feature] of merged) {
    const reactiveFeature = getReactiveNode(entrySlug)?.feature;
    const effective = reactiveFeature && reactiveFeature.type !== "geographic" ? reactiveFeature : feature;
    const diagnostics = getFeatureDiagnostics(effective, childrenByParent.get(entrySlug));
    if (diagnostics.length > 0) list.push({ slug: entrySlug, feature: effective, diagnostics });
  }
  list.sort((a, b) => a.slug.localeCompare(b.slug));
  return list;
}
