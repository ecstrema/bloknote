<script lang="ts">
  import type { OsmFeature } from "osm-api";
  import { getClimbingProviderLinks, type ClimbingProviderLink } from "#lib/data/climbing-providers.js";
  import { Button } from "#components/ui/button/index.js";
  import * as Sheet from "#components/ui/sheet/index.js";

  let { feature }: { feature: OsmFeature } = $props();

  const links = $derived(getClimbingProviderLinks(feature));
  let open = $state(false);

  function linkLabel(link: ClimbingProviderLink): string {
    switch (link.id) {
      case "thecrag":
        return link.direct ? "theCrag" : "Search on theCrag";
      case "mountainproject":
        return link.direct ? "Mountain Project" : "Search on Mountain Project";
      default:
        return "OpenClimbing";
    }
  }
</script>

{#snippet linkRow(link: ClimbingProviderLink)}
  <a
    href={link.href}
    target="_blank"
    rel="noopener noreferrer"
    onclick={() => (open = false)}
    class="flex min-w-0 items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm hover:underline"
  >
    <span class="min-w-0 truncate font-medium">{linkLabel(link)}</span>
    <span aria-hidden="true" class="icon-[lucide--external-link] shrink-0 size-4 text-muted-foreground"></span>
  </a>
{/snippet}

{#if links.length > 0}
  <Sheet.Root bind:open>
    <Sheet.Trigger>
      {#snippet child({ props })}
        <Button {...props} variant="outline" size="sm" class="self-start">
          <span aria-hidden="true" class="icon-[lucide--external-link] shrink-0 size-4"></span>
          View in...
        </Button>
      {/snippet}
    </Sheet.Trigger>

    <Sheet.Content side="bottom" class="mx-auto max-w-lg rounded-t-xl max-h-[85vh] overflow-y-auto">
      <Sheet.Header>
        <Sheet.Title>View in climbing apps</Sheet.Title>
        <Sheet.Description>Choose a climbing data provider.</Sheet.Description>
      </Sheet.Header>

      <div class="flex flex-col gap-2 px-4 pb-5">
        {#each links as link (link.id)}
          {@render linkRow(link)}
        {/each}
      </div>
    </Sheet.Content>
  </Sheet.Root>
{/if}
