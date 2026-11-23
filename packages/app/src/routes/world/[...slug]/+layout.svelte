<script lang="ts">
  import AppTopNavigation from "#lib/components/shell/app-top-navigation.svelte";

  import type { WithChildren } from "bits-ui";

  import AppSidebar from "#components/shell/sidebar/app-sidebar.svelte";
  import { Separator } from "#components/ui/separator/index.js";
  import * as Sidebar from "#components/ui/sidebar/index.js";
  import AppProvider from "#components/shell/providers/app-provider.svelte";
  import ProfileButton from "#components/shell/app-settings-menu.svelte";

  import type { LayoutProps } from "./$types";
  import Head from "#components/shell/head.svelte";
  import type { LayoutLoadType } from "./+layout";
  import { resolve } from "$app/paths";
  import BloknoteLogo from "#components/bloknote-logo.svelte";
  import OsmChanges from "#components/shell/osm-changes.svelte";
  import EditButton from "#components/shell/edit-button.svelte";
  import UndoControls from "#components/shell/undo-controls.svelte";

  const { children, params, data }: WithChildren<LayoutProps> & { data: LayoutLoadType } = $props();
</script>

<AppProvider slug={data.slug} currentItem={data.currentItem} additionalDataJSON={data.additionalData}>
  <Head />
  <Sidebar.Provider>
    <AppSidebar />

    <Sidebar.Inset class="min-w-0">
      <header class="flex h-12 shrink-0 items-center gap-2 border-b px-3 max-w-screen overflow-auto no-scrollbar">
        <Sidebar.Trigger class="-ms-1" />
        <a href={resolve("/")} aria-label="Bloknote home" class="shrink-0">
          <BloknoteLogo class="size-5" />
        </a>
        <Separator orientation="vertical" class="me-1 data-[orientation=vertical]:h-4" />

        <AppTopNavigation />
        <div class="grow"></div>
        <UndoControls />
        <ProfileButton />
      </header>

      <div class="flex flex-1 flex-col gap-3 p-3">
        {@render children?.()}
      </div>
    </Sidebar.Inset>
  </Sidebar.Provider>
  <OsmChanges />
  <!-- Edit entry point shown when not connected: asks the user to log in with OSM (needs the app state context) -->
  <EditButton />
</AppProvider>
