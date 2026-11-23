<script lang="ts">
  import type { Snippet } from "svelte";
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { page } from "$app/state";
  import { onMount } from "svelte";
  import { Button } from "#components/ui/button/index.js";
  import BloknoteLogo from "#components/bloknote-logo.svelte";
  import * as Tabs from "#components/ui/tabs/index.js";
  import SettingsProvider from "#lib/components/shell/providers/settings-provider.svelte";

  const { children }: { children: Snippet } = $props();

  type SettingsTab = "settings" | "logbook" | "account";

  const activeTab = $derived<SettingsTab>(
    page.url.pathname === resolve("/settings/account")
      ? "account"
      : page.url.pathname === resolve("/settings/logbook")
        ? "logbook"
        : "settings",
  );

  function onTabChange(value: string) {
    const route =
      value === "account" ? resolve("/settings/account") : value === "logbook" ? resolve("/settings/logbook") : resolve("/settings");
    void goto(route);
  }

  let hasPreviousPage = $state(false);
  onMount(() => {
    hasPreviousPage = window.history.length > 1;
  });

  // Legacy links and in-flight OAuth logins still point to /settings?tab=account
  $effect(() => {
    if (activeTab === "settings" && ["account", "accounts"].includes(page.url.searchParams.get("tab") ?? "")) {
      void goto(resolve("/settings/account"), { replaceState: true });
    }
  });
</script>

<svelte:head>
  <title>{activeTab === "account" ? "Account" : activeTab === "logbook" ? "Logbook" : "Settings"} | Bloknote</title>
</svelte:head>

<SettingsProvider>
  <div class="min-h-screen bg-background text-foreground">
    <header class="border-b">
      <div class="mx-auto flex h-16 max-w-5xl items-center justify-between px-5 sm:px-8">
        <a href={resolve("/")} class="inline-flex items-center gap-2 font-semibold tracking-tight">
          <BloknoteLogo />
          <span>Bloknote</span>
        </a>
        <div class="flex items-center gap-3">
          <a href={resolve("/docs")} class="text-sm text-muted-foreground transition-colors hover:text-foreground">
            Docs
          </a>
          {#if hasPreviousPage}
            <Button variant="ghost" onclick={() => window.history.back()}>
              <span class="icon-[lucide--arrow-left] shrink-0 size-4"></span>
              Back
            </Button>
          {:else}
            <a href={resolve("world")} class="text-sm text-muted-foreground transition-colors hover:text-foreground">
              Browse climbs
            </a>
          {/if}
        </div>
      </div>
    </header>

    <main class="mx-auto w-full max-w-3xl px-5 py-10 sm:px-8 sm:py-14">
      <div class="mb-6 border-l-4 border-primary pl-5">
        <p class="text-xs font-semibold uppercase text-muted-foreground">Profile</p>
        <h1 class="mt-1 text-3xl font-semibold tracking-tight">
          {activeTab === "account" ? "Account" : activeTab === "logbook" ? "Logbook" : "Settings"}
        </h1>
      </div>

      <Tabs.Root value={activeTab} onValueChange={onTabChange} class="gap-6">
        <Tabs.List>
          <Tabs.Trigger value="settings">
            <span class="icon-[lucide--settings] shrink-0 size-4"></span>
            Settings
          </Tabs.Trigger>
          <Tabs.Trigger value="logbook">
            <span class="icon-[lucide--book-open] shrink-0 size-4"></span>
            Logbook
          </Tabs.Trigger>
          <Tabs.Trigger value="account">
            <span class="icon-[lucide--user-round] shrink-0 size-4"></span>
            Account
          </Tabs.Trigger>
        </Tabs.List>

        {@render children()}
      </Tabs.Root>
    </main>
  </div>
</SettingsProvider>
