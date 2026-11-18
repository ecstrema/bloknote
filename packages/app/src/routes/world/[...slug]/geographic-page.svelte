<script lang="ts">
  import type { DataTree } from "#lib/types.js";
  import ChildrenTable from "./children-table.svelte";
  import type { GeographicFolderElement } from "@bloknote/climbing-data-gen";

  let {
    item = $bindable(),
  }: {
    item: DataTree<GeographicFolderElement>;
  } = $props();
</script>

<ChildrenTable bind:item />
