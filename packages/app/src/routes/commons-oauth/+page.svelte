<script lang="ts">
  import { onMount } from "svelte";
  import { resolve } from "$app/paths";
  import { completeCommonsLogin } from "#lib/data/network/commons.js";
  import { pageTitle } from "#lib/page-title.js";
  import { Button } from "#components/ui/button/index.js";

  let message = $state("Completing Wikimedia sign-in…");
  let failed = $state(false);

  onMount(() => {
    void completeCommonsLogin(window.location.search)
      .then((returnTo) => window.location.replace(returnTo))
      .catch((error: unknown) => {
        message = error instanceof Error ? error.message : String(error);
        failed = true;
      });
  });
</script>

<svelte:head>
  <title>{pageTitle("Wikimedia sign-in | Bloknote")}</title>
</svelte:head>

<main class="mx-auto max-w-xl px-5 py-16 text-center">
  <h1 class="text-xl font-semibold">Wikimedia sign-in</h1>
  <p class="mt-3 text-sm text-muted-foreground" role="status">{message}</p>
  {#if failed}
    <Button class="mt-6" href={resolve("/settings/account")} variant="outline">Back to the account page</Button>
  {/if}
</main>
