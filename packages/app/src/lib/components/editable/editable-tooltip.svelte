<script lang="ts">
  import type { Snippet } from "svelte";

  let { children }: { children: Snippet<[any]> } = $props();
</script>

{@render children({})}

