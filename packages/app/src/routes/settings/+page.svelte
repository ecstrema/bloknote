<script lang="ts">
  import { resolve } from "$app/paths";
  import { Button } from "#components/ui/button/index.js";
  import { Select } from "#components/ui/select/index.js";
  import * as Tabs from "#components/ui/tabs/index.js";
  import MapProviderToggles from "#components/map-provider-toggles.svelte";
  import {
    allBoulderScales,
    allRouteScales,
    allViaFerrataScales,
    convertGrade,
    fb,
    french,
    getScale,
    husler,
    type Scale,
  } from "@bloknote/holy-grade";
  import { setMode, userPrefersMode } from "mode-watcher";
  import { atproto } from "#lib/data/network/atproto.svelte.js";
  import { settings } from "#lib/data/settings.svelte.js";
  import { gradingScales, type GradingScaleType, type PreferredScaleId } from "#lib/data/grading-scales.svelte.js";
  import { i18n, locales, localeNames, setLocale } from "#lib/i18n.svelte.js";

  const routeExamples = $derived(
    ["6a", "7a", "8a"].map((grade) => convertGrade(grade, french, getScale(gradingScales.effective("route"))!)).join(", "),
  );
  const boulderExamples = $derived(
    ["5A", "6A", "7A"].map((grade) => convertGrade(grade, fb, getScale(gradingScales.effective("boulder"))!)).join(", "),
  );
  const viaFerrataExamples = $derived(
    ["K2", "K4", "K5"].map((grade) => convertGrade(grade, husler, getScale(gradingScales.effective("viaFerrata"))!)).join(", "),
  );
</script>

{#snippet scaleList(id: string, type: GradingScaleType, scales: Scale[], compareHref: string, examples: string)}
  <div class="space-y-1">
    <div class="flex items-center gap-3 text-xs text-muted-foreground">
      <span class="size-4 shrink-0" aria-hidden="true"></span>
      <span>Preferred</span>
      <span class="size-4 shrink-0" aria-hidden="true"></span>
      <span>Understood</span>
    </div>
    {#each scales as scale (scale.id)}
      <label class="flex min-h-8 items-center gap-3 text-sm">
        <input
          type="radio"
          name={`preferred-${id}`}
          class="size-4 accent-primary"
          checked={gradingScales.preferred(type) === scale.id}
          onclick={() =>
            gradingScales.setPreferred(
              type,
              gradingScales.preferred(type) === scale.id ? undefined : (scale.id as PreferredScaleId),
            )}
          aria-label={`Preferred ${scale.name} scale`}
        />
        <input
          type="checkbox"
          class="size-4 accent-primary"
          checked={gradingScales.known(type).includes(scale.id as never)}
          onchange={() => gradingScales.toggleKnown(scale.id as never)}
          aria-label={`Understand the ${scale.name} scale`}
        />
        <span class="flex-1">
          {scale.name}
          {#if scale.usedIn}<span class="text-muted-foreground"> · {scale.usedIn}</span>{/if}
        </span>
      </label>
    {/each}
    <p class="text-sm text-muted-foreground">
      {getScale(gradingScales.effective(type))?.description}
      <span class="mt-1 block"
        ><span class="font-medium text-foreground">Examples:</span> {examples}</span
      >
    </p>
    <a href={compareHref} class="text-sm text-primary hover:underline">Compare grades</a>
  </div>
{/snippet}

<Tabs.Content value="settings">
        <section class="grid gap-4 border-t py-6 sm:grid-cols-[minmax(0,1fr)_minmax(16rem,20rem)] sm:items-center">
          <div>
            <h2 class="font-medium">Appearance</h2>
            <p class="mt-1 text-sm text-muted-foreground">Theme</p>
          </div>
          <Select
            aria-label="Theme"
            bind:value={() => userPrefersMode.current, (mode) => { setMode(mode); void atproto.saveSettings({ mode }); }}
          >
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
            <Select
              aria-label="Language"
              bind:value={() => i18n.locale, (locale) => { void setLocale(locale); void atproto.saveSettings({ locale }); }}
            >
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

        <section class="grid gap-4 border-t py-6 sm:grid-cols-[minmax(0,1fr)_minmax(16rem,24rem)] sm:items-start">
          <div>
            <h2 class="font-medium">Grading scales</h2>
            <p class="mt-1 text-sm text-muted-foreground">
              Tick the scales you understand: grades in them are shown as written. Grades in the others are translated
              to the preferred scale of their discipline, which is also used wherever a single scale is needed (charts,
              comparisons). Without any preference, the scale of your location is used, falling back to French and
              Fontainebleau.
            </p>
          </div>
          <div class="space-y-6">
            {@render scaleList("route", "route", allRouteScales, resolve("/grade-comparison/route"), routeExamples)}
            {@render scaleList("boulder", "boulder", allBoulderScales, resolve("/grade-comparison/boulder"), boulderExamples)}
            {@render scaleList("via-ferrata", "viaFerrata", allViaFerrataScales, resolve("/grade-comparison/via-ferrata"), viaFerrataExamples)}
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
