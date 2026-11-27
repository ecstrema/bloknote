<script lang="ts">
  import { resolve } from "$app/paths";
  import { cn } from "#lib/utils.js";

  const isDev = import.meta.env.DEV;
  const { class: className }: { class?: string } = $props();
  /** Static assets have no typed route: build the path from the app base */
  const src = `${resolve("/").replace(/\/$/, "")}/logo.svg`;
</script>

<!-- Climbing tree emblem, from paroisduquebec.ca (issue #85) -->
<img {src} alt="" class={cn("size-6 shrink-0", isDev && "grayscale opacity-60", className)} aria-hidden="true" />
