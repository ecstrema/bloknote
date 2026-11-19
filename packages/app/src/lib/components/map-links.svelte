<script lang="ts">
  import { Button } from "#components/ui/button/index.js";
  import * as Sheet from "#components/ui/sheet/index.js";
  import { MAP_PROVIDERS, type MapCoordinates, type MapProvider } from "#lib/data/map-providers.js";
  import { settings } from "#lib/data/settings.svelte.js";
  import { IsMobile } from "#lib/hooks/is-mobile.svelte.js";
  import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
  import ChevronUpIcon from "@lucide/svelte/icons/chevron-up";
  import ExternalLinkIcon from "@lucide/svelte/icons/external-link";
  import MapIcon from "@lucide/svelte/icons/map";

  let { coordinates, name }: { coordinates: MapCoordinates; name?: string } = $props();

  const isMobile = new IsMobile();
  let open = $state(false);
  let showMore = $state(false);

  const enabledProviders = $derived(settings.getEnabledMapProviders(isMobile.current));
  const extraProviders = $derived(
    MAP_PROVIDERS.filter((provider) => !settings.isMapProviderEnabled(provider.id, isMobile.current)),
  );

  function linkAttrs(provider: MapProvider) {
    return provider.external ? { target: "_blank", rel: "noopener noreferrer" } : {};
  }
</script>

<Sheet.Root bind:open>
  <Sheet.Trigger>
    {#snippet child({ props })}
      <Button {...props} variant="outline" size="sm" class="self-start">
        <MapIcon aria-hidden="true" />
        Open in...
      </Button>
    {/snippet}
  </Sheet.Trigger>

  <Sheet.Content side="bottom" class="mx-auto max-w-lg rounded-t-xl max-h-[85vh] overflow-y-auto">
    <Sheet.Header>
      <Sheet.Title>Open in maps</Sheet.Title>
      <Sheet.Description>
        {name ? `Choose a maps provider for ${name}.` : "Choose a maps provider."}
        {#if !isMobile.current}
          Some options only open native apps on mobile devices.
        {/if}
      </Sheet.Description>
    </Sheet.Header>

    <div class="flex flex-col gap-2 px-4 pb-5">
      {#if enabledProviders.length === 0}
        <p class="py-2 text-sm text-muted-foreground">No map providers enabled. Use "More" below to turn some on.</p>
      {:else}
        {#each enabledProviders as provider (provider.id)}
          {@render providerRow(provider, true)}
        {/each}
      {/if}

      {#if showMore && extraProviders.length > 0}
        <div class="mt-2 border-t pt-3 flex flex-col gap-2">
          <p class="text-xs font-medium text-muted-foreground">More providers</p>
          {#each extraProviders as provider (provider.id)}
            {@render providerRow(provider, false)}
          {/each}
        </div>
      {/if}

      {#if extraProviders.length > 0 || showMore}
        <Button type="button" variant="ghost" size="sm" class="mt-1 self-start" onclick={() => (showMore = !showMore)}>
          {#if showMore}
            <ChevronUpIcon />
            Show fewer
          {:else}
            <ChevronDownIcon />
            More ({extraProviders.length})
          {/if}
        </Button>
      {/if}
    </div>
  </Sheet.Content>
</Sheet.Root>

{#snippet providerRow(provider: MapProvider, enabled: boolean)}
  <div class="flex items-center gap-2 rounded-md border px-3 py-2">
    <a
      href={provider.buildHref(coordinates, name)}
      {...linkAttrs(provider)}
      onclick={() => (open = false)}
      class="flex min-w-0 flex-1 items-center justify-between gap-2 text-sm hover:underline"
    >
      <div class="min-w-0">
        <div class="flex items-center gap-2 font-medium">
          <span>{provider.label}</span>
          {#if provider.mobileOnly}
            <span class="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">Mobile</span>
          {/if}
        </div>
        <p class="truncate text-xs text-muted-foreground">{provider.description}</p>
      </div>
      <ExternalLinkIcon class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </a>
    <input
      type="checkbox"
      aria-label="Enable {provider.label}"
      title={enabled ? `Remove ${provider.label} from defaults` : `Add ${provider.label} to defaults`}
      class="size-4 shrink-0 accent-primary cursor-pointer"
      checked={enabled}
      onchange={(e) => settings.setMapProviderEnabled(provider.id, e.currentTarget.checked)}
    />
  </div>
{/snippet}
