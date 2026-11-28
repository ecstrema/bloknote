<script lang="ts">
  import { Button } from "#components/ui/button/index.js";
  import { getBrowserUrl } from "#lib/helpers/url.js";
  import { cn } from "#lib/utils.js";

  let { class: className }: { class?: string } = $props();

  /** Shares the current page on Bluesky (issue #273) */
  function shareHref(): string {
    const url = getBrowserUrl();
    return `https://bsky.app/intent/post?text=${encodeURIComponent(url.href)}`;
  }
</script>

<Button
  class={cn(className)}
  variant="outline"
  size="icon-sm"
  href={shareHref()}
  target="_blank"
  rel="noopener noreferrer"
  title="Share this page on Bluesky"
  aria-label="Share this page on Bluesky"
>
  <span class="icon-[lucide--share-2] shrink-0 size-4 text-sky-500"></span>
</Button>