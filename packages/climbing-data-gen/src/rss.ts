import type { OsmFeature } from "osm-api";

/** Site root used to build feed and item links */
export const SITE_BASE_URL = "https://ecstrema.github.io/bloknote";
/** OpenStreetMap website root, for element and contributor profile links */
export const OSM_BASE_URL = "https://www.openstreetmap.org";
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

/** A recently added or edited changeset post, ready to be rendered into the region feeds */
export interface RecentItem {
  /** Element last-edit timestamp, in ms since the epoch */
  timestamp: number;
  /** Pre-rendered RSS <item> XML */
  xml: string;
  /** Slugs of the subtrees holding the elements of this post, used to place it into the feeds */
  slugs: string[];
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
          Math.sin(dLat / 2) ** 2 + Math.cos(toRad(previous.lat)) * Math.cos(toRad(el.lat)) * Math.sin(dLon / 2) ** 2,
        ),
      );
    return meters >= 0.1
      ? `moved ${meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`}`
      : undefined;
  }
  if (el.type === "way" && previous.type === "way") {
    return JSON.stringify(previous.nodes) === JSON.stringify(el.nodes) ? undefined : "node list changed";
  }
  if (el.type === "relation" && previous.type === "relation") {
    return JSON.stringify(previous.members) === JSON.stringify(el.members) ? undefined : "member list changed";
  }
  return undefined;
}

/** The change summary between two versions, without the wrapping paragraph (issues #222 and #281) */
export function describeChanges(previous: OsmFeature, el: OsmFeature): string | undefined {
  return describeTagChanges(previous, el) ?? describeGeometryChange(previous, el);
}

const GRADE_TAG_PREFIX = "climbing:grade:";

/** Percent-encodes a Commons file title for a URL, keeping the "File:" prefix raw */
function encodeCommonsTitle(file: string): string {
  const colon = file.indexOf(":");
  return colon === -1
    ? encodeURIComponent(file)
    : `${file.slice(0, colon + 1)}${encodeURIComponent(file.slice(colon + 1))}`;
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

/** A recently changed climbing feature grouped into its changeset post (issue #281) */
export interface ChangesetEntry {
  feature: OsmFeature;
  /** Slug of the subtree holding the element, used to place the post into the region feeds */
  slug: string;
  /** Full display path of the element, e.g. "Québec > Canada > North > Americas" */
  path: string;
  /** Summary of what changed since the previous version, when known (issue #222) */
  changes?: string;
}

/** At most this many elements are listed in one changeset post */
export const RSS_ELEMENTS_PER_POST = 15;
/** At most this many Commons photos are embedded in one changeset post */
export const RSS_IMAGES_PER_POST = 4;

/** The kind counts of the created or modified entries, e.g. "2 routes, 1 crag and 3 boulders" */
function countedKinds(entries: ChangesetEntry[], created: boolean): string | undefined {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    if (((entry.feature.version ?? 1) === 1) !== created) continue;
    const kind = describeClimbingFeature(entry.feature);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  const parts = [...counts].map(([kind, n]) => `${n} ${kind.toLowerCase()}${n === 1 ? "" : "s"}`);
  if (parts.length === 0) return undefined;
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * Renders one RSS <item> per OpenStreetMap changeset (issue #281) instead of one per element:
 * the post credits the contributor, tells how many elements were created or modified, lists the
 * changed elements with their kind, grade and full region path, and embeds their Commons photos.
 * The changeset id, contributor and timestamps come from the Overpass data itself (out meta), so
 * nothing has to be fetched or cached here. Entries must already be filtered by isRecentItem.
 */
export function changesetItemXml(
  changesetId: number | undefined,
  entries: ChangesetEntry[],
  now: number = Date.now(),
): RecentItem | undefined {
  if (entries.length === 0) return undefined;
  const timestamp = Math.max(...entries.map((entry) => Date.parse(entry.feature.timestamp!)));
  if (!Number.isFinite(timestamp) || now - timestamp > RSS_RECENT_DAYS * 24 * 60 * 60 * 1000) return undefined;
  const user = entries.map((entry) => entry.feature.user).find(Boolean);
  const author = user ?? "An anonymous editor";
  const first = entries[0]!.feature;
  const guid = changesetId ? `osm-changeset-${changesetId}` : `osm-${first.type}-${first.id}-v${first.version ?? 0}`;
  const link = changesetId ? `${OSM_BASE_URL}/changeset/${changesetId}` : `${OSM_BASE_URL}/${first.type}/${first.id}`;
  const created = countedKinds(entries, true);
  const updated = countedKinds(entries, false);
  const actions = [created && `created ${created}`, updated && `updated ${updated}`].filter(Boolean) as string[];
  const title = `${author} ${actions.join(" and ")}`;

  const paragraphs: string[] = [];
  const createdCount = entries.filter((entry) => (entry.feature.version ?? 1) === 1).length;
  paragraphs.push(
    `<p>${escapeXml(
      `${author} changed ${entries.length} climbing element${entries.length === 1 ? "" : "s"} (${createdCount} created, ${entries.length - createdCount} modified) on ${new Date(timestamp).toISOString().slice(0, 10)}`,
    )}${changesetId ? ` in <a href="${escapeXml(link)}">changeset ${changesetId}</a>` : ""}.</p>`,
  );
  const shown = entries.slice(0, RSS_ELEMENTS_PER_POST);
  paragraphs.push(
    `<ul>${shown
      .map((entry) => {
        const kind = describeClimbingFeature(entry.feature);
        const gradeEntry = Object.entries(entry.feature.tags ?? {}).find(([key]) => key.startsWith(GRADE_TAG_PREFIX));
        const bits = [gradeEntry ? `${kind} graded ${gradeEntry[1]}` : kind, entry.path, entry.changes].filter(Boolean);
        const href = `${SITE_BASE_URL}/world/${entry.slug.replace(/^world\//, "")}`;
        return `<li><a href="${escapeXml(href)}">${escapeXml(entry.feature.tags?.name ?? "")}</a> — ${escapeXml(bits.join(", "))}</li>`;
      })
      .join("")}</ul>`,
  );
  if (entries.length > shown.length) {
    paragraphs.push(`<p>${escapeXml(`and ${entries.length - shown.length} more elements`)}</p>`);
  }
  const images = new Map<string, { page: string; image: string; name: string }>();
  for (const entry of entries) {
    for (const file of commonsFiles(entry.feature.tags?.wikimedia_commons)) {
      images.set(file.image, { ...file, name: entry.feature.tags?.name ?? "climbing feature" });
    }
  }
  for (const { page, image, name } of [...images.values()].slice(0, RSS_IMAGES_PER_POST)) {
    paragraphs.push(
      `<p><a href="${escapeXml(page)}"><img src="${escapeXml(image)}" alt="${escapeXml(`Photo of ${name}`)}" width="480"/></a></p>`,
    );
  }
  paragraphs.push(`<p><a href="${escapeXml(link)}">Details on OpenStreetMap</a></p>`);

  const xml =
    `    <item>\n` +
    `      <title>${escapeXml(title)}</title>\n` +
    `      <link>${escapeXml(link)}</link>\n` +
    `      <guid isPermaLink="false">${escapeXml(guid)}</guid>\n` +
    `      <pubDate>${new Date(timestamp).toUTCString()}</pubDate>\n` +
    `      <description>${escapeXml(paragraphs.join(""))}</description>\n` +
    `    </item>`;
  return { timestamp, xml, slugs: entries.map((entry) => entry.slug.replace(/^world\//, "")) };
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
