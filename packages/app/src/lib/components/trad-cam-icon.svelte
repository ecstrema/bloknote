<script lang="ts">
  import { cn } from "#lib/utils.js";

  const {
    class: className,
    title = "Trad / mixed route",
  }: {
    class?: string;
    title?: string;
  } = $props();
</script>

<svg
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  class={cn("size-3.5 shrink-0 text-amber-600 dark:text-amber-400", className)}
  role="img"
  aria-label={title}
>
  <title>{title}</title>
  <!-- Left and right cam lobes around central axle -->
  <path d="M12 8C10 4 5 3.5 4 7c-.8 2.8 1.5 5 5 5h3" />
  <path d="M12 8c2-4 7-4.5 8-1 .8 2.8-1.5 5-5 5h-3" />
  <circle cx="12" cy="9.5" r="1.5" />
  <!-- Stem and trigger bar -->
  <path d="M12 11v7" />
  <path d="M9.5 14.5h5" />
  <circle cx="12" cy="20" r="2" />
</svg>
