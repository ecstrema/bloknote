<script lang="ts">
  import { dev } from "$app/env";
  import { getBrowserUrl } from "#lib/helpers/url.js";
  import { Button } from "#components/ui/button/index.js";
  import { cn } from "#lib/utils.js";

  /**
   * Dev-only link to the same page on the production instance (issue #270), shown next to the
   * bookmark / tick / RSS buttons. Only rendered in development.
   */
  const PRODUCTION_ORIGIN = "https://ecstrema.github.io";
  const productionHref = $derived.by(() => {
    if (!dev) return undefined;
    const url = getBrowserUrl();
    return `${PRODUCTION_ORIGIN}${url.pathname}${url.search}${url.hash}`;
  });
  let { class: className }: { class?: string } = $props();
</script>

{#if productionHref}
  <Button
    class={cn(className)}
    variant="outline"
    size="icon-sm"
    href={productionHref}
    target="_blank"
    rel="noopener noreferrer"
    title="Open this page in the production instance"
    aria-label="Open this page in the production instance"
  >
    <span class="icon-[lucide--external-link] shrink-0 size-4 text-muted-foreground"></span>
  </Button>
{/if}