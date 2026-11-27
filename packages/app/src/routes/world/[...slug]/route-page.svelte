<script lang="ts">
  import { resolve } from "$app/paths";
  import EditableDescription from "#lib/components/editable/editable-description.svelte";
  import CommonsTopo from "#lib/components/commons-topo.svelte";
  import RouteLogbook from "#lib/components/route-logbook.svelte";
  import type { DataTree } from "#lib/types.js";
  import type { DataJSON } from "@bloknote/climbing-data-gen";
  import type { OsmFeature } from "osm-api";
  import ClimbingProviderLinks from "#lib/components/climbing-provider-links.svelte";
  import MapLinks from "#lib/components/map-links.svelte";
  import HolyGrade from "#components/grade/holy-grade.svelte";
  import { getGrade } from "@bloknote/osm-climbing";

  let {
    item = $bindable(),
    slug,
    coordinates,
    companion,
  }: {
    item: DataTree<OsmFeature>;
    slug: string;
    coordinates?: { lat: number; lon: number };
    /** The bottom/top point paired with this route, when the route is mapped with two points (issue #135) */
    companion?: { slug: string; feature: DataJSON };
  } = $props();

  const feature = $derived(item.feature);

  // Routes mapped as ways list their member nodes as children with their properties (issue #135)
  const wayChildren = $derived.by(() => {
    if (feature.type !== "way" || !item.children) return [];
    return Object.entries(item.children).map(([childSlug, child]) => ({
      slug: childSlug,
      feature: child.feature as OsmFeature,
    }));
  });

  function partLabel(type: string, id: number, tags: OsmFeature["tags"]): string {
    const role = tags?.climbing === "route_top" ? "top" : "bottom";
    return `${role} ${type}/${id}`;
  }
</script>

<EditableDescription {feature} featureSlug={slug} />

{#if companion && companion.feature.type !== "geographic"}
  {@const companionFeature = companion.feature as OsmFeature}
  <p class="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
    <span aria-hidden="true" class="icon-[lucide--route] size-4 shrink-0"></span>
    <span>This route is mapped with two points:</span>
    <a
      href="https://www.openstreetmap.org/{feature.type}/{feature.id}"
      target="_blank"
      rel="noopener noreferrer"
      class="underline underline-offset-2 hover:text-foreground"
    >
      {partLabel(feature.type, feature.id, feature.tags)}
    </a>
    <a
      href="https://www.openstreetmap.org/{companionFeature.type}/{companionFeature.id}"
      target="_blank"
      rel="noopener noreferrer"
      class="underline underline-offset-2 hover:text-foreground"
    >
      {partLabel(companionFeature.type, companionFeature.id, companionFeature.tags)}
    </a>
  </p>
{/if}

{#if wayChildren.length > 0}
  <section class="flex flex-col gap-1.5" aria-label="Points of the route">
    <h2 class="text-sm font-semibold">Points ({wayChildren.length})</h2>
    <ul class="flex flex-col gap-1 text-sm">
      {#each wayChildren as child (child.slug)}
        {@const tags = child.feature.tags ?? {}}
        {@const grade = getGrade(tags)}
        <li class="flex flex-wrap items-center gap-2">
          <a href={resolve("/world/[...slug]", { slug: child.slug })} class="font-medium underline underline-offset-2">
            {tags.name ?? "Unnamed"}
          </a>
          {#if tags.climbing}
            <span class="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{tags.climbing}</span>
          {/if}
          {#if grade}
            <HolyGrade class="text-xs font-semibold" grade={grade.v} />
          {/if}
        </li>
      {/each}
    </ul>
  </section>
{/if}

<div class="flex flex-wrap items-center gap-2">
  {#if coordinates}
    <MapLinks {coordinates} name={feature.tags?.name} />
  {/if}
  <ClimbingProviderLinks {feature} />
</div>

<CommonsTopo {feature} featureSlug={slug} />

<RouteLogbook {feature} allowTicks />
