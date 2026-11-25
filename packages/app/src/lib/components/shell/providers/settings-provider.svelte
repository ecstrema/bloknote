<script lang="ts">
  import type { Snippet } from "svelte";
  // Module singleton: loads the grading scale preferences and starts the location-based fallback
  import { gradingScales } from "#lib/data/grading-scales.svelte.js";

  let {
    children,
  }: {
    children: Snippet;
  } = $props();

  void gradingScales;
</script>

{@render children?.()}
