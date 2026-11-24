<script lang="ts">
  import EditableDescription from "#lib/components/editable/editable-description.svelte";
  import CommonsTopo from "#lib/components/commons-topo.svelte";
  import RouteLogbook from "#lib/components/route-logbook.svelte";
  import type { DataTree } from "#lib/types.js";
  import type { OsmFeature } from "osm-api";
  import ClimbingProviderLinks from "#lib/components/climbing-provider-links.svelte";
  import MapLinks from "#lib/components/map-links.svelte";

  let {
    item = $bindable(),
    slug,
    coordinates,
  }: {
    item: DataTree<OsmFeature>;
    slug: string;
    coordinates?: { lat: number; lon: number };
  } = $props();

  const feature = $derived(item.feature);
</script>

<EditableDescription {feature} featureSlug={slug} />

<div class="flex flex-wrap items-center gap-2">
  {#if coordinates}
    <MapLinks {coordinates} name={feature.tags?.name} />
  {/if}
  <ClimbingProviderLinks {feature} />
</div>

<CommonsTopo {feature} featureSlug={slug} />

<RouteLogbook {feature} allowTicks />
