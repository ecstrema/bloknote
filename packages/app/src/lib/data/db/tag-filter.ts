import type { TagFilter } from "./types.js";

const OPERATOR_PATTERN = /(!=|>=|<=|=|>|<|~)/;

/**
 * Parses a tag filter expression typed by the user (issue #236): `climbing:length>40`,
 * `climbing:rock=sandstone`, `name~crag` or a bare key (the tag only has to be present).
 * Returns undefined when no key could be extracted.
 */
export function parseTagFilter(input: string): TagFilter | undefined {
  const trimmed = input.trim();
  if (!trimmed) return undefined;
  const match = OPERATOR_PATTERN.exec(trimmed);
  if (!match || match.index === 0) {
    return match ? undefined : { key: trimmed, value: "" };
  }
  const key = trimmed.slice(0, match.index).trim();
  if (!key) return undefined;
  return { key, op: match[0] as TagFilter["op"], value: trimmed.slice(match.index + match[0].length).trim() };
}

/** Renders a tag filter back to its expression form, for the filter chips */
export function formatTagFilter(tag: TagFilter): string {
  if (!tag.value) return tag.key;
  return `${tag.key}${tag.op ?? "="}${tag.value}`;
}
