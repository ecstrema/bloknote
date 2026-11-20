<script lang="ts">
  import type { OsmFeature } from "osm-api";
  import { getClimbingProviderLinks, type ClimbingProviderLink } from "#lib/data/climbing-providers.js";
  import { Button } from "#components/ui/button/index.js";
  import ExternalLinkIcon from "@lucide/svelte/icons/external-link";

  let { feature }: { feature: OsmFeature } = $props();

  const links = $derived(getClimbingProviderLinks(feature));
</script>

{#snippet linkLabel(link: ClimbingProviderLink)}
  {#if link.id === "thecrag"}
    {#if link.direct}theCrag{:else}Search on theCrag{/if}
  {:else if link.id === "mountainproject"}
    {#if link.direct}Mountain Project{:else}Search on Mountain Project{/if}
  {:else}
    OpenClimbing
  {/if}
{/snippet}

{#if links.length > 0}
  <div class="flex flex-wrap items-center gap-2">
    {#each links as link (link.id)}
      <Button
        variant="outline"
        size="sm"
        class="font-normal"
        href={link.href}
        target="_blank"
        rel="noopener noreferrer"
      >
        {#if link.direct}
          <ExternalLinkIcon class="text-muted-foreground" aria-hidden="true" />
        {/if}
        {@render linkLabel(link)}
      </Button>
    {/each}
  </div>
{/if}
