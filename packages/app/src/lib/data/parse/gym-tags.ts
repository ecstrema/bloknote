import type { Tags } from "osm-api";
import { MAP_PROVIDERS, type MapCoordinates } from "../map-providers.js";

type AnyTags = Record<string, string | undefined>;

export function getWebsite(tags: Tags): string | undefined {
  const t = tags as AnyTags;
  const value = (t.website || t["contact:website"] || t.url)?.trim();
  if (!value) return;
  const url = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
  // Only http(s): avoids javascript: links from user-edited tags
  if (!/^https?:\/\//i.test(url)) return;
  try {
    new URL(url);
    return url;
  } catch {
    return undefined;
  }
}

/** `true`/`false` from `fee=yes|no`, undefined when unknown */
export function getFee(tags: Tags): boolean | undefined {
  const fee = (tags as AnyTags).fee?.trim().toLowerCase();
  if (fee === "yes") return true;
  if (fee === "no") return false;
  return undefined;
}

export function getFeeCharge(tags: Tags): string | undefined {
  return (tags as AnyTags).charge?.trim() || undefined;
}

export interface MapLink {
  id: string;
  label: string;
  href: string;
}

/** Links opening a location in the maps apps. */
export function getMapLinks(coordinates: MapCoordinates, name?: string): MapLink[] {
  return MAP_PROVIDERS.map((provider) => ({
    id: provider.id,
    label: provider.label,
    href: provider.buildHref(coordinates, name),
  }));
}
