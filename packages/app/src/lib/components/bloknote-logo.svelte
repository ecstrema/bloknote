<script lang="ts">
  import { cn } from "#lib/utils.js";

  const isDev = import.meta.env.DEV;
  const { class: className }: { class?: string } = $props();
</script>

<svg
  viewBox="0 0 32 32"
  fill="none"
  xmlns="http://www.w3.org/2000/svg"
  class={cn("size-6 shrink-0", isDev && "grayscale opacity-60", className)}
  aria-hidden="true"
>
  <!-- Pine tree + climbing cam emblem -->
  <path
    d="M16 2.5L9.5 11.5H13L8 18.5H12.5L9.5 23.5H22.5L19.5 18.5H24L19 11.5H22.5L16 2.5Z"
    class="fill-emerald-700 dark:fill-emerald-500"
  />
  <!-- Cam axle & stem integrated as the trunk -->
  <circle cx="16" cy="18.5" r="2.2" class="fill-amber-400 stroke-background" stroke-width="1" />
  <path d="M16 20.5V27" class="stroke-amber-600 dark:stroke-amber-400" stroke-width="2" stroke-linecap="round" />
  <circle cx="16" cy="28" r="1.8" class="stroke-amber-600 dark:stroke-amber-400" stroke-width="1.6" />
</svg>
