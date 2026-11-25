import { gradeTextToReference } from "#lib/data/db/grade-text.js";
import type { SearchFilters } from "#lib/data/db/types.js";
import { atproto } from "#lib/data/network/atproto.svelte.js";

export type PremadeFilterKind = "ticked" | "bookmarked" | "commented" | "rated";

const STORAGE_KEY = "bloknote:search-filters";

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
  /** False until the persisted filters have been restored, so that ?q= does not race with them */
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

  restore() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
      if (stored) {
        if (stored.filters) this.filters = { ...this.filters, ...stored.filters };
        if (stored.gradeText) this.gradeText = { ...this.gradeText, ...stored.gradeText };
        if (Array.isArray(stored.premades)) {
          this.premades = stored.premades.filter((kind: unknown): kind is PremadeFilterKind =>
            PREMADE_KINDS.includes(kind as PremadeFilterKind),
          );
        }
      }
    } catch {
      // Unreadable settings are ignored
    }
    this.restored = true;
  }

  persist() {
    try {
      const data = $state.snapshot({ filters: this.filters, gradeText: this.gradeText, premades: this.premades });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // The in-memory state still works when storage is unavailable
    }
  }

  clear() {
    this.filters = { text: "", types: [], styles: [], tags: [], gradeMin: undefined, gradeMax: undefined };
    this.gradeText = { min: "", max: "" };
    this.premades = [];
    this.minLengthText = "";
  }
}

export const searchState = new SearchState();
