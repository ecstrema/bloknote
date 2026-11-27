import { gradeTextToReference } from "#lib/data/db/grade-text.js";
import { formatTagFilter, parseTagFilter } from "#lib/data/db/tag-filter.js";
import type { SearchFilters, TagFilter } from "#lib/data/db/types.js";
import { atproto } from "#lib/data/network/atproto.svelte.js";

export type PremadeFilterKind = "ticked" | "bookmarked" | "commented" | "rated";

/** URL query params holding the complete search query (issue #268) */
const URL_KEYS = ["q", "types", "styles", "tags", "mine", "gmin", "gmax", "minlen"] as const;

const SEARCH_TYPES: string[] = ["route", "area", "gym"];

export interface SearchResult {
  matches: Set<string>;
  visible: Set<string>;
  expand: Set<string>;
  status: "searching" | "paused" | "done";
}

/** Kinds of premade "from your logbook" filters (issue #166); labels live in the search dialog */
const PREMADE_KINDS: PremadeFilterKind[] = ["ticked", "bookmarked", "commented", "rated"];

/** OSM ref of an atproto record subject, matching the `osm_ref` column of the local database */
function subjectRef(entry: { subject?: { type: string; id: number } }): string | undefined {
  return entry.subject ? `${entry.subject.type}-${entry.subject.id}` : undefined;
}

/**
 * The search state, shared between the sidebar quick input, the search dialog and the active
 * search indicator in the header (issue #166). A module singleton: the sidebar stays mounted
 * for the whole world section, and the dialog and indicator only read and write this state.
 */
class SearchState {
  filters = $state<SearchFilters>({ text: "", types: [], styles: [], tags: [] });
  gradeText = $state({ min: "", max: "" });
  /** Premade "from your logbook" filters currently enabled */
  premades = $state<PremadeFilterKind[]>([]);
  /** Raw text of the "longer than" filter, in meters */
  minLengthText = $state("");
  /** False until the query has been restored from the URL params, so that the sync effect does not wipe them */
  restored = $state(false);

  /** The streaming search result, written by the sidebar effect and read by the tree and the dialog */
  result = $state.raw<SearchResult>();
  /** Continues a paused search: set while a search is streaming, undefined when done */
  loadMore: (() => void) | undefined = $state(undefined);

  get hasFilters(): boolean {
    return (
      this.filters.types.length > 0 ||
      this.filters.gradeMin !== undefined ||
      this.filters.gradeMax !== undefined ||
      this.filters.styles.length > 0 ||
      this.filters.tags.length > 0 ||
      this.premades.length > 0 ||
      this.minLength !== undefined
    );
  }

  get active(): boolean {
    return this.filters.text.trim() !== "" || this.hasFilters;
  }

  /** Minimum length in meters parsed from the raw text, undefined when empty or invalid */
  get minLength(): number | undefined {
    const raw = this.minLengthText.trim().replace(",", ".");
    if (!raw) return undefined;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : undefined;
  }

  /** OSM refs of the elements referenced by the enabled premade logbook filters */
  get mineRefs(): string[] {
    if (this.premades.length === 0 || !atproto.configured) return [];
    const refs = new Set<string>();
    for (const kind of this.premades) {
      const entries =
        kind === "ticked"
          ? atproto.ticks
          : kind === "bookmarked"
            ? atproto.stars
            : kind === "commented"
              ? atproto.comments
              : atproto.ratings;
      for (const entry of entries) {
        const ref = subjectRef(entry);
        if (ref) refs.add(ref);
      }
    }
    return [...refs];
  }

  /** The filters to send to the database worker: the stored filters plus the derived search terms */
  dbFilters(): SearchFilters {
    return { ...$state.snapshot(this.filters), mineRefs: this.mineRefs, minLength: this.minLength };
  }

  /**
   * Restores the search query from the URL params (issue #268): the query belongs to the tab,
   * so it is stored in the address bar instead of localStorage, which also made it leak
   * across tabs. Returns true when any search param was present.
   */
  restoreFromUrl(params: URLSearchParams): boolean {
    const hasAny = URL_KEYS.some((key) => params.has(key));
    this.restored = true;
    if (!hasAny) return false;
    const list = (key: string) => params.get(key)?.split(",").map(decodeURIComponent).filter(Boolean) ?? [];
    this.filters = {
      text: params.get("q") ?? "",
      types: list("types").filter((t): t is SearchFilters["types"][number] => SEARCH_TYPES.includes(t)),
      styles: list("styles"),
      tags: list("tags")
        .map(parseTagFilter)
        .filter((tag): tag is TagFilter => !!tag),
      gradeMin: undefined,
      gradeMax: undefined,
    };
    this.premades = list("mine").filter((kind): kind is PremadeFilterKind =>
      PREMADE_KINDS.includes(kind as PremadeFilterKind),
    );
    this.gradeText = { min: params.get("gmin") ?? "", max: params.get("gmax") ?? "" };
    this.minLengthText = params.get("minlen") ?? "";
    return true;
  }

  /** Writes the complete search query into the given URL */
  writeToUrl(url: URL) {
    const filters = $state.snapshot(this.filters);
    const setOrDelete = (key: string, value: string) => {
      if (value) url.searchParams.set(key, value);
      else url.searchParams.delete(key);
    };
    setOrDelete("q", filters.text.trim());
    setOrDelete("types", filters.types.join(","));
    setOrDelete("styles", filters.styles.join(","));
    setOrDelete("tags", filters.tags.map((tag) => encodeURIComponent(formatTagFilter(tag))).join(","));
    setOrDelete("mine", this.premades.join(","));
    setOrDelete("gmin", this.gradeText.min.trim());
    setOrDelete("gmax", this.gradeText.max.trim());
    setOrDelete("minlen", this.minLengthText.trim());
  }

  clear() {
    this.filters = { text: "", types: [], styles: [], tags: [], gradeMin: undefined, gradeMax: undefined };
    this.gradeText = { min: "", max: "" };
    this.premades = [];
    this.minLengthText = "";
  }
}

export const searchState = new SearchState();
