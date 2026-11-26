<script lang="ts">
  import { getAppState } from "#lib/data/app-state.js";
  import { getLocalizedName } from "#lib/data/parse/localized-name.js";
  import { devPrefix } from "#lib/page-title.js";

  const appState = getAppState();

  const name: string | undefined = $derived(getLocalizedName(appState.currentNode.current?.feature));
</script>

<svelte:head>
  <title>{devPrefix}Bloknote{name ? ` - ${name}` : ""}</title>
</svelte:head>
