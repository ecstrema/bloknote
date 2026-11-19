import { createContext } from "svelte";
import { SvelteSet } from "svelte/reactivity";

export function computeRangeSelection(
  orderedSlugs: string[],
  anchor: string | undefined,
  target: string,
): string[] {
  const targetIdx = orderedSlugs.indexOf(target);
  if (targetIdx === -1) return [target];
  const anchorIdx = anchor ? orderedSlugs.indexOf(anchor) : -1;
  if (anchorIdx === -1) return [target];
  const start = Math.min(anchorIdx, targetIdx);
  const end = Math.max(anchorIdx, targetIdx);
  return orderedSlugs.slice(start, end + 1);
}

export class SidebarSelection {
  readonly selected = new SvelteSet<string>();
  anchor = $state<string | undefined>(undefined);
  #getOrderedSlugs: () => string[];

  constructor(getOrderedSlugs: () => string[]) {
    this.#getOrderedSlugs = getOrderedSlugs;
  }

  get size(): number {
    return this.selected.size;
  }

  get slugs(): string[] {
    return [...this.selected];
  }

  has(slug: string): boolean {
    return this.selected.has(slug);
  }

  setAnchor(slug: string | undefined) {
    this.anchor = slug;
  }

  toggle(slug: string) {
    if (this.selected.has(slug)) {
      this.selected.delete(slug);
    } else {
      this.selected.add(slug);
    }
    this.anchor = slug;
  }

  selectRange(targetSlug: string) {
    const slugs = computeRangeSelection(this.#getOrderedSlugs(), this.anchor, targetSlug);
    for (const s of slugs) this.selected.add(s);
    if (this.anchor === undefined) this.anchor = targetSlug;
  }

  clear() {
    this.selected.clear();
  }
}

export const [getSidebarSelection, setSidebarSelection] = createContext<SidebarSelection>();