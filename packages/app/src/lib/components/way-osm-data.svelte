<script lang="ts">
  import { getFeature, type OsmNode, type OsmWay } from "osm-api";
  import * as Collapsible from "#components/ui/collapsible/index.js";

  let { way }: { way: OsmWay } = $props();

  interface WayNodeData {
    id: number;
    lat: number | undefined;
    lon: number | undefined;
    tags: Record<string, string> | undefined;
  }

  let nodes = $state<WayNodeData[]>();
  let error = $state<string>();

  $effect(() => {
    // The dataset only carries the way and its tagged POIs: the full node list comes live from OSM
    nodes = undefined;
    error = undefined;
    let cancelled = false;
    getFeature("way", way.id, true)
      .then((features) => {
        if (cancelled) return;
        nodes = features
          .filter((f): f is OsmNode => f.type === "node")
          .map((node) => ({ id: node.id, lat: node.lat, lon: node.lon, tags: node.tags }));
      })
      .catch((e) => {
        if (!cancelled) error = e instanceof Error ? e.message : "Could not load the way nodes.";
      });
    return () => {
      cancelled = true;
    };
  });
</script>

<Collapsible.Root class="text-sm">
  <Collapsible.Trigger
    class="flex w-fit items-center gap-1.5 rounded text-sm font-semibold hover:text-foreground"
    aria-label="Show the nodes of this way"
  >
    <span
      aria-hidden="true"
      class="icon-[lucide--chevron-right] size-4 shrink-0 transition-transform"
      class:rotate-90={nodes !== undefined && nodes.length > 0}
    ></span>
    Way nodes
  </Collapsible.Trigger>

  <Collapsible.Content class="flex flex-col gap-2 pt-2">
    {#if error}
      <p class="text-xs text-destructive">{error}</p>
    {:else if nodes === undefined}
      <p class="text-xs text-muted-foreground">Loading nodes from OpenStreetMap...</p>
    {:else}
      <ul class="flex flex-col gap-1.5">
        {#each nodes as node (node.id)}
          <li class="flex flex-col gap-0.5 rounded border p-2 text-xs">
            <div class="flex flex-wrap items-center gap-2">
              <a
                href={`https://www.openstreetmap.org/node/${node.id}`}
                target="_blank"
                rel="noopener noreferrer"
                class="font-medium underline underline-offset-2"
              >
                node/{node.id}
              </a>
              {#if node.lat !== undefined && node.lon !== undefined}
                <span class="text-muted-foreground">{node.lat.toFixed(5)}, {node.lon.toFixed(5)}</span>
              {/if}
            </div>
            {#if node.tags && Object.keys(node.tags).length > 0}
              <div class="flex flex-wrap gap-1 pt-0.5">
                {#each Object.entries(node.tags) as [key, value] (key)}
                  <span class="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{key}={value}</span>
                {/each}
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </Collapsible.Content>
</Collapsible.Root>