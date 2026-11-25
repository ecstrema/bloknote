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
/** Maximum number of previous versions fetched at build time to describe changes (issue #222) */
export const RSS_CHANGES_FETCH_LIMIT = 100;
/** Delay between two previous-version fetches, to stay polite with the OSM API */
export const RSS_CHANGES_FETCH_DELAY_MS = 150;

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

/** Whether the element is named and recent enough to be rendered into the feeds */
export function isRecentItem(el: OsmFeature, now: number = Date.now()): boolean {
  if (!el.tags?.name || !el.timestamp) return false;
  const timestamp = Date.parse(el.timestamp);
  return Number.isFinite(timestamp) && now - timestamp <= RSS_RECENT_DAYS * 24 * 60 * 60 * 1000;
}

/** Human-readable summary of the tag changes between two versions of an element */
export function describeTagChanges(previous: OsmFeature, el: OsmFeature): string | undefined {
  const before = (previous.tags ?? {}) as Record<string, string | undefined>;
  const after = (el.tags ?? {}) as Record<string, string | undefined>;
  const changes: string[] = [];
  for (const key of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
    const from = before[key];
    const to = after[key];
    if (from === to) continue;
    // Typographic quotes: the whole description is escaped again, straight quotes would double-escape
    if (from === undefined) changes.push(`set ${key} to “${to}”`);
    else if (to === undefined) changes.push(`removed ${key}`);
    else changes.push(`changed ${key} from “${from}” to “${to}”`);
  }
  if (changes.length === 0) return undefined;
  const shown = changes.slice(0, 4).join(", ");
  return changes.length > 4 ? `${shown}, and ${changes.length - 4} more tags` : shown;
}

/** Human-readable summary of the geometry change between two versions of an element */
export function describeGeometryChange(previous: OsmFeature, el: OsmFeature): string | undefined {
  if (el.type === "node" && previous.type === "node") {
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const dLat = toRad(el.lat - previous.lat);
    const dLon = toRad(el.lon - previous.lon);
    const meters =
      2 *
      6_371_000 *
      Math.asin(
        Math.sqrt(
          Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(previous.lat)) * Math.cos(toRad(el.lat)) * Math.sin(dLon / 2) ** 2,
        ),
      );
    return meters >= 0.1 ? `moved ${meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`}` : undefined;
  }
  if (el.type === "way" && previous.type === "way") {
    return JSON.stringify(previous.nodes) === JSON.stringify(el.nodes) ? undefined : "node list changed";
  }
  if (el.type === "relation" && previous.type === "relation") {
    return JSON.stringify(previous.members) === JSON.stringify(el.members) ? undefined : "member list changed";
  }
  return undefined;
}

/** The "Changes: …" sentence describing what the edit actually did (issue #222) */
function changesParagraph(previous: OsmFeature, el: OsmFeature): string | undefined {
  const changes = describeTagChanges(previous, el) ?? describeGeometryChange(previous, el);
  return changes ? `<p>Changes: ${escapeXml(changes)}</p>` : undefined;
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
function authorParagraph(summary: string, user: string | undefined, created: boolean): string {
  const verb = created ? "was added" : "was edited";
  if (!user) return escapeXml(`${summary} ${verb} by an anonymous editor`);
  const profile = `${OSM_BASE_URL}/user/${encodeURIComponent(user)}`;
  return `${escapeXml(`${summary} ${verb} by`)} <a href="${escapeXml(profile)}">${escapeXml(user)}</a>`;
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
 * The description is escaped HTML: contributor credit, a summary of what changed when the
 * previous version is available (issue #222), Commons photos, and provider links.
 */
export function recentItemXml(el: OsmFeature, slug: string, now: number = Date.now(), previous?: OsmFeature): RecentItem | undefined {
  const name = el.tags?.name;
  if (!name || !el.timestamp || !isRecentItem(el, now)) return undefined;
  const timestamp = Date.parse(el.timestamp);

  const kind = describeClimbingFeature(el);
  const gradeEntry = Object.entries(el.tags ?? {}).find(([key]) => key.startsWith(GRADE_TAG_PREFIX));
  const summary = gradeEntry ? `${kind} graded ${gradeEntry[1]}` : kind;
  // Slugs in the generated tree are prefixed with world/, matching the app's internal slugs
  const cleanSlug = slug.replace(/^world\//, "");
  const link = `${SITE_BASE_URL}/world/${cleanSlug}`;
  const guid = `osm-${el.type}-${el.id}-v${el.version ?? 0}`;

  const paragraphs = [`<p>${authorParagraph(summary, el.user, (el.version ?? 1) === 1)}</p>`];
  if (previous && (el.version ?? 1) > 1) {
    const changes = changesParagraph(previous, el);
    if (changes) paragraphs.push(changes);
  }
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
