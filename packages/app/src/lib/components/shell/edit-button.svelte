<script lang="ts">
  import { Button } from "#components/ui/button/index.js";
  import * as Popover from "#components/ui/popover/index.js";
  import { getAppState } from "#lib/data/app-state.js";

  const appState = getAppState();
  let open = $state(false);
</script>

<!-- Edit entry point when not connected (issue #159): pressing it asks the user to log in with OSM -->
{#if !appState.osmUser.loggedIn}
  <Popover.Root bind:open>
    <Popover.Trigger>
      {#snippet child({ props })}
        <Button {...props} size="sm" class="fixed right-5 bottom-5 z-30 rounded-full shadow-lg" title="Edit this page">
          <span aria-hidden="true" class="icon-[lucide--pencil] shrink-0 size-4"></span>
          Edit
        </Button>
      {/snippet}
    </Popover.Trigger>
    <Popover.Content side="top" align="end" class="w-72">
      <div class="flex flex-col gap-3 text-sm">
        <p>
          Edits are saved to OpenStreetMap, a free shared database that works across tons of apps and websites. Improve
          the climbing data once and every climber benefits.
        </p>
        <Button onclick={() => appState.osmUser.login()}>
          <span aria-hidden="true" class="icon-[lucide--log-in] shrink-0 size-4"></span>
          Log in with OSM
        </Button>
      </div>
    </Popover.Content>
  </Popover.Root>
{/if}
