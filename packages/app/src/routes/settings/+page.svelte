<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { building } from "$app/env";
  import { resolve } from "$app/paths";
  import { page } from "$app/state";
  import { Button } from "#components/ui/button/index.js";
  import BloknoteLogo from "#components/bloknote-logo.svelte";
  import { Select } from "#components/ui/select/index.js";
  import * as Tabs from "#components/ui/tabs/index.js";
  import MapProviderToggles from "#components/map-provider-toggles.svelte";
  import AccountsTab from "./accounts-tab.svelte";
  import ArrowLeftIcon from "@lucide/svelte/icons/arrow-left";
  import SettingsIcon from "@lucide/svelte/icons/settings";
  import UserRoundIcon from "@lucide/svelte/icons/user-round";
  import { allBoulderScales, allRouteScales, convertGrade, french } from "@bloknote/holy-grade";
  import { setMode, userPrefersMode } from "mode-watcher";
  import { settings } from "#lib/data/settings.svelte.js";
  import { i18n, locales, localeNames, setLocale } from "#lib/i18n.svelte.js";
  import {
    getPreferredBoulderGradingScale,
    getPreferredRouteGradingScale,
  } from "#lib/components/shell/providers/settings.svelte.js";

  type SettingsTab = "settings" | "account";

  function parseTab(value: string | null): SettingsTab {
    return value === "account" || value === "accounts" ? "account" : "settings";
  }

  const preferredRouteScale = getPreferredRouteGradingScale();
  const preferredBoulderScale = getPreferredBoulderGradingScale();
  const routeScale = $derived(allRouteScales.find((scale) => scale.id === preferredRouteScale.current));
  const boulderScale = $derived(allBoulderScales.find((scale) => scale.id === preferredBoulderScale.current));
  const routeExamples = $derived(
    routeScale ? ["6a", "7a", "8a"].map((grade) => convertGrade(grade, french, routeScale)).join(", ") : "",
  );
  const boulderExamples = $derived(
    boulderScale ? ["5A", "6A", "7A"].map((grade) => convertGrade(grade, french, boulderScale)).join(", ") : "",
  );

  let activeTab = $state<SettingsTab>(building ? "settings" : parseTab(page.url.searchParams.get("tab")));
  let hasPreviousPage = $state(false);

  onMount(() => {
    hasPreviousPage = window.history.length > 1;
    activeTab = parseTab(page.url.searchParams.get("tab"));
  });

  function onTabChange(value: string) {
    const next = parseTab(value);
    activeTab = next;
    if (building) return;
    const url = new URL(page.url.href);
    if (next === "settings") url.searchParams.delete("tab");
    else url.searchParams.set("tab", next);
    void goto(url, { state: page.state, shallow: true, replace: true });
  }
</script>

<svelte:head>
  <title>{activeTab === "account" ? "Account" : "Settings"} | Bloknote</title>
</svelte:head>

<div class="min-h-screen bg-background text-foreground">
  <header class="border-b">
    <div class="mx-auto flex h-16 max-w-5xl items-center justify-between px-5 sm:px-8">
      <a href={resolve("/")} class="inline-flex items-center gap-2 font-semibold tracking-tight">
        <BloknoteLogo />
        <span>Bloknote</span>
      </a>
      {#if hasPreviousPage}
        <Button variant="ghost" onclick={() => window.history.back()}>
          <ArrowLeftIcon />
          Back
        </Button>
      {:else}
        <a href={resolve("world")} class="text-sm text-muted-foreground transition-colors hover:text-foreground">
          Browse climbs
        </a>
      {/if}
    </div>
  </header>

  <main class="mx-auto w-full max-w-3xl px-5 py-10 sm:px-8 sm:py-14">
    <div class="mb-6 border-l-4 border-primary pl-5">
      <p class="text-xs font-semibold uppercase text-muted-foreground">Profile</p>
      <h1 class="mt-1 text-3xl font-semibold tracking-tight">
        {activeTab === "account" ? "Account" : "Settings"}
      </h1>
    </div>

    <Tabs.Root value={activeTab} onValueChange={onTabChange} class="gap-6">
      <Tabs.List>
        <Tabs.Trigger value="settings">
          <SettingsIcon />
          Settings
        </Tabs.Trigger>
        <Tabs.Trigger value="account">
          <UserRoundIcon />
          Account
        </Tabs.Trigger>
      </Tabs.List>

      <Tabs.Content value="settings">

    <section class="grid gap-4 border-t py-6 sm:grid-cols-[minmax(0,1fr)_minmax(16rem,20rem)] sm:items-center">
      <div>
        <h2 class="font-medium">Appearance</h2>
        <p class="mt-1 text-sm text-muted-foreground">Theme</p>
      </div>
      <Select aria-label="Theme" bind:value={() => userPrefersMode.current, setMode}>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
        <option value="system">System</option>
      </Select>
    </section>

    <section class="grid gap-4 border-t py-6 sm:grid-cols-[minmax(0,1fr)_minmax(16rem,20rem)] sm:items-center">
      <div>
        <h2 class="font-medium">Language</h2>
        <p class="mt-1 text-sm text-muted-foreground">Language of the interface and of the names of the regions</p>
      </div>
      <Select aria-label="Language" bind:value={() => i18n.locale, setLocale}>
        {#each locales as locale (locale)}
          <option value={locale}>{localeNames[locale]}</option>
        {/each}
      </Select>
    </section>

    <section class="grid gap-4 border-t py-6 sm:grid-cols-[minmax(0,1fr)_minmax(16rem,20rem)] sm:items-start">
      <div>
        <h2 class="font-medium">Route grading scale</h2>
        <p class="mt-1 text-sm text-muted-foreground">Choose how route grades are displayed.</p>
      </div>
      <div class="space-y-2">
        <Select aria-label="Route grading scale" bind:value={preferredRouteScale.current}>
          <option value="local">Local to each area</option>
          {#each allRouteScales as scale (scale.id)}
            <option value={scale.id}>{scale.name} ({scale.id})</option>
          {/each}
        </Select>
        <p class="text-sm text-muted-foreground">
          {routeScale?.description ?? "Uses the grading scale set for each area."}
          {#if routeExamples}
            <span class="mt-1 block"><span class="font-medium text-foreground">Examples:</span> {routeExamples}</span>
          {/if}
        </p>
        <a href={resolve("/grade-comparison/route")} class="text-sm text-primary hover:underline">
          Compare route grades
        </a>
      </div>
    </section>

    <section class="grid gap-4 border-t py-6 sm:grid-cols-[minmax(0,1fr)_minmax(16rem,20rem)] sm:items-start">
      <div>
        <h2 class="font-medium">Boulder grading scale</h2>
        <p class="mt-1 text-sm text-muted-foreground">Choose how boulder grades are displayed.</p>
      </div>
      <div class="space-y-2">
        <Select aria-label="Boulder grading scale" bind:value={preferredBoulderScale.current}>
          <option value="local">Local to each area</option>
          {#each allBoulderScales as scale (scale.id)}
            <option value={scale.id}>{scale.name} ({scale.id})</option>
          {/each}
        </Select>
        <p class="text-sm text-muted-foreground">
          {boulderScale?.description ?? "Uses the grading scale set for each area."}
          {#if boulderExamples}
            <span class="mt-1 block"><span class="font-medium text-foreground">Examples:</span> {boulderExamples}</span>
          {/if}
        </p>
        <a href={resolve("/grade-comparison/boulder")} class="text-sm text-primary hover:underline">
          Compare boulder grades
        </a>
      </div>
    </section>

    <section class="grid gap-4 border-y py-6 sm:grid-cols-[minmax(0,1fr)_minmax(16rem,20rem)] sm:items-center">
      <div>
        <h2 class="font-medium">Data usage</h2>
        <p class="mt-1 text-sm text-muted-foreground">
          When enabled, Bloknote does not automatically download the full climbing dataset. Areas load as you visit
          them, so search may only include areas you have already opened. You can still download all data from the
          sidebar when you need complete search coverage.
        </p>
      </div>
      <label class="flex min-h-10 items-center gap-3 text-sm">
        <input type="checkbox" class="size-4 accent-primary" bind:checked={settings.lowData} />
        Low data usage
      </label>
    </section>

    <section class="grid gap-4 border-b py-6 sm:grid-cols-[minmax(0,1fr)_minmax(16rem,20rem)] sm:items-start">
      <div>
        <h2 class="font-medium">Open in maps</h2>
        <p class="mt-1 text-sm text-muted-foreground">
          Choose which map providers appear in the "Open in" drawer. Mobile-only apps cannot be detected automatically
          from a web browser.
        </p>
      </div>
      <MapProviderToggles />
    </section>
      </Tabs.Content>

      <Tabs.Content value="account">
        <AccountsTab />
      </Tabs.Content>
    </Tabs.Root>
  </main>
</div>
