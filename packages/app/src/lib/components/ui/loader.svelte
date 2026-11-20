<script lang="ts">
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import { cn } from "#lib/utils.js";

  /** Subtle centered loading indicator; give it a `class` height to reserve space */
  let { class: className }: { class?: string } = $props();
</script>

<div class={cn("flex items-center justify-center py-8 text-muted-foreground", className)} role="status">
  <LoaderCircleIcon class="size-4 animate-spin" aria-hidden="true" />
  <span class="sr-only">Loading</span>
</div>
