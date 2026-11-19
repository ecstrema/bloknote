<script lang="ts">
  import type { DataTree } from "#lib/types.js";
  import SectorStats from "#lib/components/sector-stats.svelte";
  import ChildrenTable from "./children-table.svelte";
  import type { GeographicFolderElement } from "@bloknote/climbing-data-gen";
  import { getDefaultGradingScales } from "#lib/data/parse/region-grading.js";
  import { page } from "$app/state";

  let {
    item = $bindable(),
  }: {
    item: DataTree<GeographicFolderElement>;
  } = $props();

  const slug = $derived(page.params.slug ?? "");
  const defaultScales = $derived(getDefaultGradingScales(slug));
</script>

{#if slug}
  <p class="text-xs text-muted-foreground">
    Local grading schemes: <span class="font-medium text-foreground">{defaultScales.route}</span> (routes) ·
    <span class="font-medium text-foreground">{defaultScales.boulder}</span> (boulders)
  </p>
{/if}

<SectorStats {item} {slug} />
<ChildrenTable bind:item />
