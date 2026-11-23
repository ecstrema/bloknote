import type { OsmFeature } from "osm-api";

/** Site root used to build feed and item links */
export const SITE_BASE_URL = "https://ecstrema.github.io/bloknote";
/** Items added or edited less than this many days ago are included in the feeds */
export const RSS_RECENT_DAYS = 30;
/** Maximum number of items in a single feed */
export const RSS_MAX_ITEMS = 100;

/** A recently added or edited climbing feature, ready to be rendered into the region feeds */
export interface RecentItem {
  /** Element last-edit timestamp, in ms since the epoch */
  timestamp: number;
  /** Pre-rendered RSS <item> XML */
  xml: string;
}

/** Escapes text for inclusion in an XML document */
export function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/** Human-readable kind of a climbing feature, from its tags */
export function describeClimbingFeature(el: OsmFeature): string {
  const tags = el.tags ?? {};
  const climbingValues = (tags.climbing ?? "").split(";").map((v) => v.trim());
  if (climbingValues.some((v) => ["route", "route_bottom", "route_top", "route_start"].includes(v))) return "Route";
  if (climbingValues.includes("boulder") || climbingValues.includes("bouldering")) return "Boulder";
  if (climbingValues.includes("crag")) return "Crag";
  if (climbingValues.includes("area")) return "Area";
  if (tags.natural === "cliff") return "Cliff";
  if (tags.leisure === "sports_centre" || tags.leisure === "pitch") return "Gym";
  if (tags.sport === "climbing") return "Climbing feature";
  return "Climbing feature";
}

const GRADE_TAG_PREFIX = "climbing:grade:";

/**
 * Renders an RSS <item> for a climbing feature, or undefined when the element is not recent
 * (last edit older than RSS_RECENT_DAYS), unnamed, or carries no last-edit timestamp.
 * The Overpass data does not need any diffing against a previous build: each element carries
 * the date of its last edit, and newly created elements simply have a recent one.
 */
export function recentItemXml(el: OsmFeature, slug: string, now: number = Date.now()): RecentItem | undefined {
  const name = el.tags?.name;
  if (!name || !el.timestamp) return undefined;
  const timestamp = Date.parse(el.timestamp);
  if (!Number.isFinite(timestamp) || now - timestamp > RSS_RECENT_DAYS * 24 * 60 * 60 * 1000) return undefined;

  const kind = describeClimbingFeature(el);
  const gradeEntry = Object.entries(el.tags ?? {}).find(([key]) => key.startsWith(GRADE_TAG_PREFIX));
  const summary = gradeEntry ? `${kind} graded ${gradeEntry[1]}` : kind;
  // Slugs in the generated tree are prefixed with world/, matching the app's internal slugs
  const cleanSlug = slug.replace(/^world\//, "");
  const link = `${SITE_BASE_URL}/world/${cleanSlug}`;
  const guid = `osm-${el.type}-${el.id}-v${el.version ?? 0}`;
  const xml =
    `    <item>\n` +
    `      <title>${escapeXml(name)} — ${escapeXml(summary)}</title>\n` +
    `      <link>${escapeXml(link)}</link>\n` +
    `      <guid isPermaLink="false">${escapeXml(guid)}</guid>\n` +
    `      <pubDate>${new Date(timestamp).toUTCString()}</pubDate>\n` +
    `      <description>${escapeXml(`${summary} on OpenStreetMap: https://www.openstreetmap.org/${el.type}/${el.id}`)}</description>\n` +
    `    </item>`;
  return { timestamp, xml };
}

/** Renders a complete RSS 2.0 document for a region feed */
export function renderRssFeed(options: { title: string; slug: string; items: RecentItem[] }): string {
  const cleanSlug = options.slug.replace(/^world\//, "");
  const link = `${SITE_BASE_URL}/world/${cleanSlug}`;
  const lastBuildDate = options.items[0]?.timestamp ?? Date.now();
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<rss version="2.0">\n` +
    `  <channel>\n` +
    `    <title>${escapeXml(options.title)}</title>\n` +
    `    <link>${escapeXml(link)}</link>\n` +
    `    <description>${escapeXml(`Recently added or edited climbing routes and crags in ${options.title}, from OpenStreetMap data`)}</description>\n` +
    `    <lastBuildDate>${new Date(lastBuildDate).toUTCString()}</lastBuildDate>\n` +
    `    <generator>bloknote climbing-data-gen</generator>\n` +
    `    <ttl>1440</ttl>\n` +
    options.items.map((item) => item.xml).join("\n") +
    (options.items.length > 0 ? "\n" : "") +
    `  </channel>\n` +
    `</rss>\n`
  );
}
