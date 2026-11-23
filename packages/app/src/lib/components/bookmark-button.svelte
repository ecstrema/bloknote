<script lang="ts">
  import { Button } from "#components/ui/button/index.js";
  import { atproto } from "#lib/data/network/atproto.svelte.js";
  import { cn } from "#lib/utils.js";
  import type { OsmFeature } from "osm-api";

  let {
    feature,
    labelled = false,
    class: className,
  }: {
    feature: OsmFeature;
    /** Show the "Bookmark"/"Bookmarked" label next to the icon */
    labelled?: boolean;
    class?: string;
  } = $props();

  let busy = $state(false);
  let error = $state<string>();

  const starred = $derived(atproto.isStarred(feature));

  async function toggle() {
    error = undefined;
    busy = true;
    try {
      await atproto.toggleStar(feature);
    } catch (e) {
      error = e instanceof Error ? e.message : "Could not update bookmark";
    } finally {
      busy = false;
    }
  }
</script>

<div class={cn("flex flex-col items-end gap-0.5", className)}>
  {#if error}<span class="text-xs text-destructive">{error}</span>{/if}
  <Button
    size={labelled ? "xs" : "icon-sm"}
    variant={starred ? "secondary" : "outline"}
    disabled={busy}
    onclick={toggle}
    title={starred ? "Remove bookmark" : "Bookmark this climb"}
    aria-label={starred ? "Remove bookmark" : "Bookmark this climb"}
  >
    <span class="icon-[lucide--star] shrink-0 size-4" class:text-amber-500={starred}></span>
    {#if labelled}{starred ? "Bookmarked" : "Bookmark"}{/if}
  </Button>
</div>
