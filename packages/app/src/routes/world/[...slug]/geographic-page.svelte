<script lang="ts">
  import type { DataTree } from "#lib/types.js";
  import SectorStats from "#lib/components/sector-stats.svelte";
  import ChildrenTable from "./children-table.svelte";
  import type { GeographicFolderElement } from "@bloknote/climbing-data-gen";
  import { page } from "$app/state";

  let {
    item = $bindable(),
  }: {
    item: DataTree<GeographicFolderElement>;
  } = $props();

  const slug = $derived(page.params.slug ?? "");
</script>

<SectorStats {item} {slug} />
<ChildrenTable bind:item />
