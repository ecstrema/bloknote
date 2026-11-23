<script lang="ts">
  import { resolve } from "$app/paths";
  import { Button } from "#components/ui/button/index.js";
  import { Select } from "#components/ui/select/index.js";
  import * as Tabs from "#components/ui/tabs/index.js";
  import MapProviderToggles from "#components/map-provider-toggles.svelte";
  import { allBoulderScales, allRouteScales, convertGrade, french } from "@bloknote/holy-grade";
  import { setMode, userPrefersMode } from "mode-watcher";
  import { settings } from "#lib/data/settings.svelte.js";
  import { i18n, locales, localeNames, setLocale } from "#lib/i18n.svelte.js";
  import {
    getPreferredBoulderGradingScale,
    getPreferredRouteGradingScale,
  } from "#lib/components/shell/providers/settings.svelte.js";

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
</script>

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
          <div class="space-y-2">
            <Select aria-label="Language" bind:value={() => i18n.locale, setLocale}>
              {#each locales as locale (locale)}
                <option value={locale}>{localeNames[locale]}</option>
              {/each}
            </Select>
            <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <a
                href="https://github.com/ecstrema/bloknote/issues/new?title=Translation%20issue"
                target="_blank"
                rel="noopener noreferrer"
                class="text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                Report a translation issue
              </a>
              <Button
                variant="outline"
                size="sm"
                href="https://github.com/ecstrema/bloknote/issues/new?title=Request%20another%20language"
                target="_blank"
                rel="noopener noreferrer"
              >
                Request another language
              </Button>
            </div>
          </div>
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
                <span class="mt-1 block"
                  ><span class="font-medium text-foreground">Examples:</span>
                  {routeExamples}</span
                >
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
                <span class="mt-1 block"
                  ><span class="font-medium text-foreground">Examples:</span>
                  {boulderExamples}</span
                >
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
              Choose which map providers appear in the "Open in" drawer. Mobile-only apps cannot be detected
              automatically from a web browser.
            </p>
          </div>
          <MapProviderToggles />
        </section>
      </Tabs.Content>
