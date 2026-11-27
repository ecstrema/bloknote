<script lang="ts">
  import * as Tabs from "#components/ui/tabs/index.js";
  import { atproto } from "#lib/data/network/atproto.svelte.js";
  import AtprotoLogin from "#lib/components/atproto-login.svelte";
  import UserStatsPanel from "./user-stats-panel.svelte";
  import TickImport from "./tick-import.svelte";
  import TicksList from "./ticks-list.svelte";
</script>

<Tabs.Content value="logbook" class="flex flex-col gap-4">
  {#if !atproto.configured}
    <!-- Not connected (issue #263): the same Atmosphere login form as the account page -->
    <section class="grid gap-4 border-t py-6 sm:grid-cols-[minmax(0,1fr)_minmax(16rem,20rem)] sm:items-start">
      <div>
        <h2 class="font-medium">Atmosphere</h2>
        <p class="mt-1 text-sm text-muted-foreground">
          Stores your personal climbing activity on the AT Protocol—logbook ticks and ascents, comments, star ratings,
          and bookmarked climbs—in your own data repository, separate from OpenStreetMap.
        </p>
      </div>
      <AtprotoLogin />
    </section>
  {:else}
    <TickImport />
    <UserStatsPanel />
    <TicksList />
  {/if}
</Tabs.Content>
