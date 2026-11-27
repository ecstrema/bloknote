<script lang="ts">
  import { resolve } from "$app/paths";
  import { cn } from "#lib/utils.js";

  const isDev = import.meta.env.DEV;
  const { class: className }: { class?: string } = $props();
  /** Static assets have no typed route: build the path from the app base */
  const base = `${resolve("/").replace(/\/$/, "")}`;
</script>

<!-- Climbing tree emblem, from paroisduquebec.ca (issue #85). The emblem has black borders, which
     are unreadable on a dark background: the white-stroke variant is swapped in via CSS, so the
     server and client renders agree (issue #254) -->
<img
  src={`${base}/logo.svg`}
  alt=""
  class={cn("size-6 shrink-0 dark:hidden", isDev && "grayscale opacity-60", className)}
  aria-hidden="true"
/>
<img
  src={`${base}/logo-dark.svg`}
  alt=""
  class={cn("hidden size-6 shrink-0 dark:block", isDev && "grayscale opacity-60", className)}
  aria-hidden="true"
/>
