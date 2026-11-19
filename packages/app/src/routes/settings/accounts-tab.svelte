<script lang="ts">
  import { onMount } from "svelte";
  import { isLoggedIn } from "osm-api";
  import { Button } from "#components/ui/button/index.js";
  import { Input } from "#components/ui/input/index.js";
  import UserStatsPanel from "./user-stats-panel.svelte";
  import { loginOsm, logoutOsm } from "#lib/data/network/osm.svelte.js";
  import { atproto } from "#lib/data/network/atproto.svelte.js";
  import {
    getCommonsAccessToken,
    getCommonsUsername,
    logoutCommons,
    startCommonsLogin,
  } from "#lib/data/network/commons.js";

  let osmLoggedIn = $state<boolean | undefined>(undefined);
  let commonsLoggedIn = $state<boolean | undefined>(undefined);
  let commonsUsername = $state<string>();
  let commonsError = $state<string>();
  let atHandle = $state("");
  let atAppPassword = $state("");
  let atConnecting = $state(false);
  let atError = $state<string>();

  onMount(() => {
    osmLoggedIn = isLoggedIn();

    const accessToken = getCommonsAccessToken();
    if (!accessToken) {
      commonsLoggedIn = false;
      return;
    }

    commonsLoggedIn = true;
    void getCommonsUsername(accessToken)
      .then((username) => {
        commonsUsername = username;
      })
      .catch(() => {
        logoutCommons();
        commonsLoggedIn = false;
        commonsUsername = undefined;
      });
  });

  function toggleOsmLogin() {
    if (osmLoggedIn) {
      logoutOsm();
      osmLoggedIn = isLoggedIn();
    } else {
      loginOsm(() => {
        osmLoggedIn = isLoggedIn();
      });
    }
  }

  async function toggleCommonsLogin() {
    commonsError = undefined;
    if (commonsLoggedIn) {
      logoutCommons();
      commonsLoggedIn = false;
      commonsUsername = undefined;
      return;
    }

    try {
      await startCommonsLogin();
    } catch (error) {
      commonsError = error instanceof Error ? error.message : String(error);
    }
  }

  async function connectAtProto(event: SubmitEvent) {
    event.preventDefault();
    atError = undefined;
    atConnecting = true;
    try {
      await atproto.connect(atHandle, atAppPassword || undefined);
      atHandle = "";
      atAppPassword = "";
    } catch (error) {
      atError = error instanceof Error ? error.message : String(error);
    } finally {
      atConnecting = false;
    }
  }
</script>

<section class="grid gap-4 border-t py-6 sm:grid-cols-[minmax(0,1fr)_minmax(16rem,20rem)] sm:items-center">
  <div>
    <h2 class="font-medium">OpenStreetMap</h2>
    <p class="mt-1 text-sm text-muted-foreground">
      Stores the shared climbing directory—routes, sectors, crags, gyms, grades, and tags. Sign in to add, edit,
      reorganize, or fix climbing data and publish your changesets.
    </p>
  </div>
  <Button onclick={toggleOsmLogin} disabled={osmLoggedIn === undefined} variant="outline">
    {#if osmLoggedIn === undefined}
      Checking login status...
    {:else if osmLoggedIn}
      Log out of OpenStreetMap
    {:else}
      Log in with OpenStreetMap
    {/if}
  </Button>
</section>

<section class="grid gap-4 border-t py-6 sm:grid-cols-[minmax(0,1fr)_minmax(16rem,20rem)] sm:items-start">
  <div>
    <h2 class="font-medium">Atmosphere</h2>
    <p class="mt-1 text-sm text-muted-foreground">
      Stores your personal climbing activity on the AT Protocol—logbook ticks and ascents, route reviews, ratings, and
      starred climbs—in your own data repository, separate from OpenStreetMap.
    </p>
    {#if atproto.session}
      <p class="mt-2 text-xs text-muted-foreground">
        Connected as <span class="font-medium text-foreground">{atproto.session.handle ?? atproto.session.did}</span>
        ({atproto.session.pdsUrl}{atproto.session.accessJwt ? " · authenticated" : " · local logbook"})
      </p>
    {/if}
    {#if atError}
      <p class="mt-2 text-xs text-destructive">{atError}</p>
    {/if}
  </div>
  {#if atproto.session}
    <Button variant="outline" onclick={() => atproto.setSession(undefined)}>Disconnect Atmosphere</Button>
  {:else}
    <form class="flex flex-col gap-2" onsubmit={connectAtProto}>
      <Input bind:value={atHandle} placeholder="Handle (e.g. alice.bsky.social)" required />
      <Input bind:value={atAppPassword} type="password" placeholder="App password (optional for PDS sync)" />
      <Button type="submit" variant="outline" disabled={atConnecting || !atHandle.trim()}>
        {atConnecting ? "Connecting..." : "Connect Atmosphere"}
      </Button>
    </form>
  {/if}
</section>

<section class="grid gap-4 border-y py-6 sm:grid-cols-[minmax(0,1fr)_minmax(16rem,20rem)] sm:items-center">
  <div>
    <h2 class="font-medium">Wikimedia Commons</h2>
    <p class="mt-1 text-sm text-muted-foreground">
      Hosts freely licensed topo photos and crag images linked from OpenStreetMap climbing features. Sign in to upload
      new photos and attach them as topos.
    </p>
    {#if commonsLoggedIn && commonsUsername}
      <p class="mt-2 text-xs text-muted-foreground">
        Signed in as <span class="font-medium text-foreground">{commonsUsername}</span>
      </p>
    {/if}
    {#if commonsError}
      <p class="mt-2 text-xs text-destructive">{commonsError}</p>
    {/if}
  </div>
  <Button onclick={toggleCommonsLogin} disabled={commonsLoggedIn === undefined} variant="outline">
    {#if commonsLoggedIn === undefined}
      Checking login status...
    {:else if commonsLoggedIn}
      Log out of Wikimedia
    {:else}
      Log in with Wikimedia
    {/if}
  </Button>
</section>

<UserStatsPanel />
