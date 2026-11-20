<script lang="ts">
  import EditableDescription from "#lib/components/editable/editable-description.svelte";
  import EditableGrade from "#components/editable/editable-grade.svelte";
  import EditableLength from "#components/editable/editable-length.svelte";
  import EditablePitches from "#components/editable/editable-pitches.svelte";
  import ClimbingStyles from "#components/climbing-styles.svelte";
  import CommonsTopo from "#lib/components/commons-topo.svelte";
  import RouteLogbook from "#lib/components/route-logbook.svelte";
  import type { DataTree } from "#lib/types.js";
  import type { OsmFeature } from "osm-api";
  import { getGrade, isProjectRoute } from "#lib/data/parse/osm-tags.js";
  import { isIceRoute, isTradRoute } from "#lib/data/parse/route-styles.js";
  import TradCamIcon from "#components/trad-cam-icon.svelte";
  import SnowflakeIcon from "@lucide/svelte/icons/snowflake";
  import ClimbingProviderLinks from "#lib/components/climbing-provider-links.svelte";

  let {
    item = $bindable(),
    slug,
  }: {
    item: DataTree<OsmFeature>;
    slug: string;
  } = $props();

  const feature = $derived(item.feature);

  let grade = $derived(feature.tags ? getGrade(feature.tags) : undefined);
  const isProject = $derived(isProjectRoute(feature.tags));
</script>

<div class="flex flex-wrap gap-3 items-baseline">
  <EditableGrade {feature} {grade} featureSlug={slug} gradedProject={isProject} />
  {#if isTradRoute(feature.tags)}
    <TradCamIcon class="self-center" />
  {/if}
  {#if isIceRoute(feature.tags)}
    <SnowflakeIcon class="size-3.5 shrink-0 self-center text-cyan-500" aria-label="Ice / dry-tooling route" />
  {/if}
  <EditableLength {feature} featureSlug={slug} />
  <EditablePitches {feature} featureSlug={slug} />
  <ClimbingStyles {feature} featureSlug={slug} editable />
</div>

<ClimbingProviderLinks {feature} />

<EditableDescription {feature} featureSlug={slug} />

<CommonsTopo {feature} featureSlug={slug} />

<RouteLogbook {feature} allowTicks />
