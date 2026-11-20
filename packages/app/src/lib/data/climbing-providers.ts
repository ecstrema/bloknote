import { getName } from "#lib/data/parse/data.js";
import type { OsmFeature } from "osm-api";

export interface ClimbingProviderLink {
  id: "openclimbing" | "thecrag" | "mountainproject";
  href: string;
  /** True when the link points at the exact item instead of a search */
  direct: boolean;
}

const WEBSITE_KEYS = ["website", "contact:website", "url"] as const;

const PROVIDER_HOSTS = [
  {
    id: "thecrag",
    host: /(?:https?:\/\/)?(?:www\.)?thecrag\.com\S*/i,
    searchBase: "https://www.thecrag.com/en/search?q=",
  },
  {
    id: "mountainproject",
    host: /(?:https?:\/\/)?(?:www\.)?mountainproject\.com\S*/i,
    searchBase: "https://www.mountainproject.com/search?q=",
  },
] as const;

/** First website tag of the feature that links to the given provider, normalized to https */
function directProviderUrl(feature: OsmFeature, host: RegExp): string | undefined {
  for (const key of WEBSITE_KEYS) {
    const value = feature.tags?.[key]?.trim();
    if (!value) continue;
    const match = value.match(host);
    if (match) return value.startsWith("http") ? match[0] : `https://${match[0]}`;
  }
  return undefined;
}

/**
 * External climbing data provider links for an OSM feature.
 *
 * OpenClimbing maps the same OSM items, so it always links directly. For the other providers a
 * direct link is offered when the OSM data already points at them, otherwise a search on the
 * feature name.
 */
export function getClimbingProviderLinks(feature: OsmFeature): ClimbingProviderLink[] {
  // Locally created features have a negative temporary id and do not exist upstream yet
  if (feature.id < 0) return [];

  const links: ClimbingProviderLink[] = [
    {
      id: "openclimbing",
      href: `https://openclimbing.org/en/${feature.type}/${feature.id}`,
      direct: true,
    },
  ];

  const name = getName(feature) ?? "";
  for (const provider of PROVIDER_HOSTS) {
    const direct = directProviderUrl(feature, provider.host);
    if (direct) {
      links.push({ id: provider.id, href: direct, direct: true });
    } else if (name) {
      links.push({
        id: provider.id,
        href: provider.searchBase + encodeURIComponent(name),
        direct: false,
      });
    }
  }

  return links;
}
