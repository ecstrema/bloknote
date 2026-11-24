<script lang="ts">
  import { resolve } from "$app/paths";
  import * as Tabs from "#components/ui/tabs/index.js";
  import { atproto } from "#lib/data/network/atproto.svelte.js";
  import UserStatsPanel from "./user-stats-panel.svelte";
  import TickImport from "./tick-import.svelte";
  import TicksList from "./ticks-list.svelte";
</script>

<Tabs.Content value="logbook" class="flex flex-col gap-4">
  {#if !atproto.configured}
    <p class="border-t py-6 text-sm text-muted-foreground">
      Connect your Atmosphere account in the
      <a href={resolve("/settings/account")} class="text-primary underline underline-offset-2">Account</a>
      tab to keep your ticks, bookmarks, and comments.
    </p>
  {/if}
  <TickImport />
  <UserStatsPanel />
  <TicksList />
</Tabs.Content>