<script lang="ts">
  import { Button } from "#components/ui/button/index.js";
  import { MAP_PROVIDERS } from "#lib/data/map-providers.js";
  import { settings } from "#lib/data/settings.svelte.js";
  import { IsMobile } from "#lib/hooks/is-mobile.svelte.js";
    
  let { showMore = $bindable(false) }: { showMore?: boolean } = $props();

  const isMobile = new IsMobile();

  const visibleProviders = $derived(
    showMore
      ? MAP_PROVIDERS
      : MAP_PROVIDERS.filter((p) => p.defaultEnabled || settings.isMapProviderEnabled(p.id, isMobile.current)),
  );
  const hiddenCount = $derived(MAP_PROVIDERS.length - visibleProviders.length);
</script>

<div class="space-y-2">
  {#each visibleProviders as provider (provider.id)}
    {@const checked = settings.isMapProviderEnabled(provider.id, isMobile.current)}
    <label class="flex items-start gap-3 rounded-md border px-3 py-2 text-sm cursor-pointer hover:bg-muted/50">
      <input
        type="checkbox"
        class="mt-0.5 size-4 accent-primary"
        {checked}
        onchange={(e) => settings.setMapProviderEnabled(provider.id, e.currentTarget.checked)}
      />
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2 font-medium">
          <span>{provider.label}</span>
          {#if provider.mobileOnly}
            <span class="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">Mobile</span>
          {/if}
        </div>
        <p class="text-xs text-muted-foreground">{provider.description}</p>
      </div>
    </label>
  {/each}

  {#if hiddenCount > 0 || showMore}
    <Button type="button" variant="ghost" size="sm" onclick={() => (showMore = !showMore)}>
      {#if showMore}
        <span class="icon-[lucide--chevron-up] shrink-0 size-4"></span>
        Fewer providers
      {:else}
        <span class="icon-[lucide--chevron-down] shrink-0 size-4"></span>
        More ({hiddenCount})
      {/if}
    </Button>
  {/if}
</div>
