<script lang="ts">
  import { cn } from "#lib/utils.js";

  /** Subtle centered loading indicator; give it a `class` height to reserve space */
  let { class: className }: { class?: string } = $props();
</script>

<div class={cn("flex items-center justify-center py-8 text-muted-foreground", className)} role="status">
  <span aria-hidden="true"  class="icon-[lucide--loader-circle] shrink-0 size-4 animate-spin"></span>
  <span class="sr-only">Loading</span>
</div>
