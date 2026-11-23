import type { OsmFeature } from "osm-api";

/** Site root used to build feed and item links */
export const SITE_BASE_URL = "https://ecstrema.github.io/bloknote";
/** OpenStreetMap website root, for element and contributor profile links */
export const OSM_BASE_URL = "https://www.openstreetmap.org";
/** OpenClimbing root, for the mirror page of an OSM element */
export const OPENCLIMBING_BASE_URL = "https://openclimbing.org/en";
/** Wikimedia Commons URLs for the wikimedia_commons tag: file pages and direct images */
export const COMMONS_WIKI_URL = "https://commons.wikimedia.org/wiki";
export const COMMONS_FILE_URL = "https://commons.wikimedia.org/wiki/Special:FilePath";
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

/** Percent-encodes a Commons file title for a URL, keeping the "File:" prefix raw */
function encodeCommonsTitle(file: string): string {
  const colon = file.indexOf(":");
  return colon === -1 ? encodeURIComponent(file) : `${file.slice(0, colon + 1)}${encodeURIComponent(file.slice(colon + 1))}`;
}

/** File page and direct image URLs for each file listed in a wikimedia_commons tag (; separated) */
function commonsFiles(value: string | undefined): { page: string; image: string }[] {
  return (value ?? "")
    .split(";")
    .map((file) => file.trim())
    .filter(Boolean)
    .map((file) => ({
      page: `${COMMONS_WIKI_URL}/${encodeCommonsTitle(file)}`,
      image: `${COMMONS_FILE_URL}/${encodeCommonsTitle(file)}?width=480`,
    }));
}

/** The "… was added by <contributor>" paragraph, with a link to the OSM profile */
function authorParagraph(summary: string, user: string | undefined): string {
  if (!user) return escapeXml(`${summary} was added by an anonymous editor`);
  const profile = `${OSM_BASE_URL}/user/${encodeURIComponent(user)}`;
  return `${escapeXml(`${summary} was added by`)} <a href="${escapeXml(profile)}">${escapeXml(user)}</a>`;
}

/** The paragraph of links to the same feature on OpenStreetMap, OpenClimbing and Bloknote */
function linksParagraph(el: OsmFeature, bloknoteLink: string): string {
  const links = [
    ["OpenStreetMap", `${OSM_BASE_URL}/${el.type}/${el.id}`],
    ["OpenClimbing", `${OPENCLIMBING_BASE_URL}/${el.type}/${el.id}`],
    ["Bloknote", bloknoteLink],
  ] as const;
  return links.map(([label, href]) => `<a href="${escapeXml(href)}">${label}</a>`).join(" · ");
}

/**
 * Renders an RSS <item> for a climbing feature, or undefined when the element is not recent
 * (last edit older than RSS_RECENT_DAYS), unnamed, or carries no last-edit timestamp.
 * The Overpass data does not need any diffing against a previous build: each element carries
 * the date of its last edit, and newly created elements simply have a recent one.
 * The description is escaped HTML: contributor credit, Commons photos, and provider links.
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

  const paragraphs = [`<p>${authorParagraph(summary, el.user)}</p>`];
  for (const { page, image } of commonsFiles(el.tags?.wikimedia_commons)) {
    paragraphs.push(
      `<p><a href="${escapeXml(page)}"><img src="${escapeXml(image)}" alt="${escapeXml(`Photo of ${name}`)}" width="480"/></a></p>`,
    );
  }
  paragraphs.push(`<p>${linksParagraph(el, link)}</p>`);

  const xml =
    `    <item>\n` +
    `      <title>${escapeXml(name)} — ${escapeXml(summary)}</title>\n` +
    `      <link>${escapeXml(link)}</link>\n` +
    `      <guid isPermaLink="false">${escapeXml(guid)}</guid>\n` +
    `      <pubDate>${new Date(timestamp).toUTCString()}</pubDate>\n` +
    `      <description>${escapeXml(paragraphs.join(""))}</description>\n` +
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
