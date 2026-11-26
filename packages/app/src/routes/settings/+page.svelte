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
  import AboutDialog from "./about-dialog.svelte";
  import { gradingScales, type GradingScaleType, type PreferredScaleId } from "#lib/data/grading-scales.svelte.js";
  import { i18n, locales, localeNames, setLocale } from "#lib/i18n.svelte.js";
  import * as Popover from "#components/ui/popover/index.js";
  import * as Table from "#components/ui/table/index.js";

  // Reference grades of each discipline, converted into every scale to build the examples (issue #223)
  const REFERENCE_GRADES: Record<GradingScaleType, { from: Scale; grades: string[] }> = {
    route: { from: french, grades: ["6a", "7a", "8a"] },
    boulder: { from: fb, grades: ["5A", "6A", "7A"] },
    viaFerrata: { from: husler, grades: ["K2", "K4", "K5"] },
  } as const;

  function scaleExamples(scale: Scale): string {
    const reference = REFERENCE_GRADES[scale.gradeType as GradingScaleType];
    return reference.grades
      .map((grade) => convertGrade(grade, reference.from, scale))
      .filter((grade): grade is string => grade !== undefined)
      .join(", ");
  }

  interface ScaleInfo {
    title: string;
    description: string;
    examples: string;
  }

  function scaleInfo(scale: Scale): ScaleInfo {
    const where = scale.usedIn ? ` · ${scale.usedIn}` : "";
    return { title: `${scale.name}${where}`, description: scale.description, examples: scaleExamples(scale) };
  }

  /** Scale hovered in the tables, shown on the left; falls back to the effective scales */
  let inspected = $state<ScaleInfo>();
  let aboutOpen = $state(false);
  const defaultDetails = $derived(
    (["route", "boulder", "viaFerrata"] as const)
      .map((type) => getScale(gradingScales.effective(type)))
      .filter((scale): scale is Scale => scale !== undefined)
      .map((scale) => scaleInfo(scale)),
  );
</script>

{#snippet scaleInfoCard(info: ScaleInfo)}
  <div class="text-sm">
    <p class="font-medium">{info.title}</p>
    <p class="mt-1 text-muted-foreground">{info.description}</p>
    <p class="mt-1"><span class="font-medium text-foreground">Examples:</span> {info.examples}</p>
  </div>
{/snippet}

{#snippet scaleTable(id: string, type: GradingScaleType, scales: Scale[], compareLabel: string, compareHref: string)}
  <div class="overflow-hidden rounded-xl border bg-muted/50">
    <Table.Root onmouseleave={() => (inspected = undefined)}>
      <Table.Header>
        <Table.Row>
          <Table.Head class="h-8 py-1 text-xs">Preferred</Table.Head>
          <Table.Head class="h-8 py-1 text-xs">Understood</Table.Head>
          <Table.Head class="h-8 py-1 text-xs">Scale</Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {#each scales as scale (scale.id)}
          <Table.Row class="cursor-default" onmouseenter={() => (inspected = scaleInfo(scale))}>
            <Table.Cell class="py-1">
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
            </Table.Cell>
            <Table.Cell class="py-1">
              <input
                type="checkbox"
                class="size-4 accent-primary"
                checked={gradingScales.known(type).includes(scale.id as never)}
                onchange={() => gradingScales.toggleKnown(scale.id as never)}
                aria-label={`Understand the ${scale.name} scale`}
              />
            </Table.Cell>
            <Table.Cell class="py-1">
              <span>
                {scale.name}
                {#if scale.usedIn}<span class="text-muted-foreground"> · {scale.usedIn}</span>{/if}
              </span>
              <Popover.Root>
                <Popover.Trigger
                  aria-label={`About the ${scale.name} scale`}
                  class="ml-1 inline-flex items-center rounded-sm align-middle text-muted-foreground hover:text-foreground sm:hidden"
                >
                  <span class="icon-[lucide--info] size-3.5"></span>
                </Popover.Trigger>
                <Popover.Content class="w-64 text-sm" side="top">
                  {@render scaleInfoCard(scaleInfo(scale))}
                </Popover.Content>
              </Popover.Root>
            </Table.Cell>
          </Table.Row>
        {/each}
      </Table.Body>
    </Table.Root>
  </div>
  <a href={compareHref} class="text-sm text-primary hover:underline">{compareLabel}</a>
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
              Fontainebleau. Hover a scale to learn more about it.
            </p>
            <div class="mt-4 hidden sm:block">
              {#if inspected}
                {@render scaleInfoCard(inspected)}
              {:else}
                <div class="grid gap-4">
                  {#each defaultDetails as detail (detail.title)}
                    {@render scaleInfoCard(detail)}
                  {/each}
                </div>
              {/if}
            </div>
          </div>
          <div class="space-y-6">
            {@render scaleTable("route", "route", allRouteScales, "Compare route grades", resolve("/grade-comparison/route"))}
            {@render scaleTable("boulder", "boulder", allBoulderScales, "Compare boulder grades", resolve("/grade-comparison/boulder"))}
            {@render scaleTable("via-ferrata", "viaFerrata", allViaFerrataScales, "Compare via ferrata grades", resolve("/grade-comparison/via-ferrata"))}
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

        <section class="grid gap-4 border-t py-6 sm:grid-cols-[minmax(0,1fr)_minmax(16rem,20rem)] sm:items-start">
          <div>
            <h2 class="font-medium">Open in maps</h2>
            <p class="mt-1 text-sm text-muted-foreground">
              Choose which map providers appear in the "Open in" drawer. Mobile-only apps cannot be detected
              automatically from a web browser.
            </p>
          </div>
          <MapProviderToggles />
        </section>

        <section class="grid gap-4 border-b py-6 sm:grid-cols-[minmax(0,1fr)_minmax(16rem,20rem)] sm:items-center">
          <div>
            <h2 class="font-medium">About Bloknote</h2>
            <p class="mt-1 text-sm text-muted-foreground">
              What Bloknote is, the version you are running, and the state of your downloaded data
            </p>
          </div>
          <Button variant="outline" onclick={() => (aboutOpen = true)}>About Bloknote</Button>
        </section>
      </Tabs.Content>

<AboutDialog bind:open={aboutOpen} />
