<script lang="ts">
  import { Button } from "#components/ui/button/index.js";
  import { apiUrl } from "#lib/data/network/api-url.js";
  import { cn } from "#lib/utils.js";

  let { slug, class: className }: { slug: string; class?: string } = $props();

  const feedUrl = $derived(apiUrl(slug, "feed.xml"));

  // The feed only exists for areas with recent edits: probe it before showing the button
  let available = $state<boolean>();
  $effect(() => {
    const url = feedUrl;
    available = undefined;
    let cancelled = false;
    fetch(url, { method: "HEAD" })
      .then((res) => {
        if (!cancelled) available = res.ok;
      })
      .catch(() => {
        if (!cancelled) available = false;
      });
    return () => (cancelled = true);
  });
</script>

<svelte:head>
  {#if available}
    <link rel="alternate" type="application/rss+xml" title="Recent climbing changes" href={feedUrl} />
  {/if}
</svelte:head>

{#if available}
  <Button
    class={cn(className)}
    variant="outline"
    size="icon-sm"
    href={feedUrl}
    target="_blank"
    rel="noopener noreferrer"
    title="Subscribe to the RSS feed of recently added or edited climbs"
    aria-label="Subscribe to the RSS feed of recently added or edited climbs"
  >
    <span class="icon-[lucide--rss] shrink-0 size-4 text-orange-500"></span>
  </Button>
{/if}
