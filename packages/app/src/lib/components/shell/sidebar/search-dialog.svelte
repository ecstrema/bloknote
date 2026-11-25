<script lang="ts">
  import { Chart, Layer, Axis, Rect, Text } from "layerchart/svg";
  import { scaleBand, scaleLinear } from "d3-scale";
  import type { DataJSON } from "@bloknote/climbing-data-gen";
  import type { OsmFeature } from "osm-api";
  import * as Dialog from "#components/ui/dialog/index.js";
  import * as DropdownMenu from "#components/ui/dropdown-menu/index.js";
  import { Button } from "#components/ui/button/index.js";
  import Input from "#components/ui/input/input.svelte";
  import { localDb } from "#lib/data/db/local-db.svelte.js";
  import { gradeTextToReference } from "#lib/data/db/grade-text.js";
  import { searchState, type PremadeFilterKind } from "./search-state.svelte.js";
  import { atproto } from "#lib/data/network/atproto.svelte.js";
  import {
    computeSectorStats,
    STAT_STYLE_COLORS,
    STAT_STYLE_ORDER,
  } from "#lib/data/parse/sector-stats.js";
  import { gradingScales } from "#lib/data/grading-scales.svelte.js";
  import type { BoulderScaleId, RouteScaleId } from "@bloknote/holy-grade";

  let { open = $bindable(false), onShowResults }: { open?: boolean; onShowResults: () => void } = $props();

  const TYPES = [
    ["route", "Routes"],
    ["area", "Areas"],
    ["gym", "Gyms"],
  ] as const;

  const STYLES = [
    ["sport", "Sport"],
    ["trad", "Trad"],
    ["boulder", "Boulder"],
    ["toprope", "Top rope"],
    ["speed", "Speed"],
    ["multipitch", "Multi-pitch"],
    ["ice", "Ice"],
    ["mixed", "Mixed"],
    ["dry", "Dry tooling"],
    ["aid", "Aid"],
    ["deepwater", "Deep-water solo"],
  ] as const;

  /** How many matched elements are loaded for the results overview charts */
  const OVERVIEW_LIMIT = 500;

  /** The premade "from your logbook" filters the user can toggle (issue #166) */
  const PREMADE_FILTERS = [
    { kind: "ticked", label: "Ticked", icon: "icon-[lucide--check-circle-2]" },
    { kind: "bookmarked", label: "Bookmarked", icon: "icon-[lucide--star]" },
    { kind: "rated", label: "Rated", icon: "icon-[lucide--gauge]" },
    { kind: "commented", label: "Commented", icon: "icon-[lucide--message-circle]" },
  ] as const satisfies readonly { kind: PremadeFilterKind; label: string; icon: string }[];

  let textInput = $state<HTMLInputElement | null>(null);
  let tagKey = $state("");
  let tagValue = $state("");

  $effect(() => {
    if (open) requestAnimationFrame(() => textInput?.focus());
  });

  const minInvalid = $derived(
    searchState.gradeText.min.trim() !== "" && gradeTextToReference(searchState.gradeText.min) === undefined,
  );
  const maxInvalid = $derived(
    searchState.gradeText.max.trim() !== "" && gradeTextToReference(searchState.gradeText.max) === undefined,
  );
  const styleSummary = $derived(
    searchState.filters.styles.length === 0
      ? "Any style"
      : STYLES.filter(([s]) => searchState.filters.styles.includes(s))
          .map(([, label]) => label)
          .join(", "),
  );
  const hasImage = $derived(searchState.filters.tags.some((t) => t.key === "wikimedia_commons"));

  function toggle<T extends string>(list: T[], item: T): T[] {
    return list.includes(item) ? list.filter((i) => i !== item) : [...list, item];
  }

  function togglePremade(kind: PremadeFilterKind) {
    searchState.premades = toggle(searchState.premades, kind);
  }

  function toggleType(type: (typeof TYPES)[number][0]) {
    searchState.filters.types = toggle(searchState.filters.types, type);
  }

  function toggleHasImage() {
    searchState.filters.tags = hasImage
      ? searchState.filters.tags.filter((t) => t.key !== "wikimedia_commons")
      : [...searchState.filters.tags, { key: "wikimedia_commons", value: "" }];
  }

  function addTag() {
    const key = tagKey.trim();
    if (!key) return;
    searchState.filters.tags = [...searchState.filters.tags, { key, value: tagValue.trim() }];
    tagKey = "";
    tagValue = "";
  }

  /** Matched elements loaded for the overview charts: refreshed (debounced) while the search streams */
  let overview = $state.raw<Record<string, DataJSON>>({});
  $effect(() => {
    const matches = searchState.result?.matches;
    if (!localDb.ready || !matches || matches.size === 0) {
      overview = {};
      return;
    }
    const slugs = [...matches].slice(0, OVERVIEW_LIMIT);
    let cancelled = false;
    const timer = setTimeout(() => {
      localDb
        .getElements(slugs)
        .then((res) => {
          if (!cancelled) overview = res;
        })
        .catch(() => {});
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  });

  const stats = $derived(
    computeSectorStats(
      Object.values(overview).filter((f): f is OsmFeature => f.type !== "geographic"),
      {
        routeScale: gradingScales.effective("route") as RouteScaleId,
        boulderScale: gradingScales.effective("boulder") as BoulderScaleId,
      },
    ),
  );
  const maxGradeCount = $derived(Math.max(1, ...stats.gradeDistribution.map((b) => b.total)));
  const chartPadding = { top: 14, right: 10, bottom: 28, left: 30 };
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
    <Dialog.Header>
      <Dialog.Title>Search</Dialog.Title>
      <Dialog.Description>Find climbs everywhere and filter the sidebar tree.</Dialog.Description>
    </Dialog.Header>

    <div class="flex flex-col gap-5 text-sm">
      <Input
        bind:ref={textInput}
        placeholder="Name..."
        bind:value={searchState.filters.text}
        aria-label="Search by name"
      />

      <section class="flex flex-col gap-2">
        <p class="text-xs font-semibold uppercase text-muted-foreground">From your logbook</p>
        {#if atproto.configured}
          <div class="flex flex-wrap gap-1.5">
            {#each PREMADE_FILTERS as premade (premade.kind)}
              <Button
                size="xs"
                variant={searchState.premades.includes(premade.kind) ? "default" : "outline"}
                onclick={() => togglePremade(premade.kind)}
              >
                <span class="{premade.icon} shrink-0 size-3.5"></span>
                {premade.label}
              </Button>
            {/each}
          </div>
        {:else}
          <p class="text-xs text-muted-foreground">
            Connect Atmosphere in the settings to search among your ticks, bookmarks, ratings and comments.
          </p>
        {/if}
      </section>

      <section class="flex flex-col gap-2">
        <p class="text-xs font-semibold uppercase text-muted-foreground">Attributes</p>
        <div class="flex flex-wrap items-center gap-3">
          <Button size="xs" variant={hasImage ? "default" : "outline"} onclick={toggleHasImage}>
            <span class="icon-[lucide--image] shrink-0 size-3.5"></span>
            Has image
          </Button>
          <label class="flex items-center gap-1.5 text-muted-foreground">
            Longer than
            <Input
              class="h-7 w-20"
              inputmode="decimal"
              aria-label="Minimum length in meters"
              bind:value={searchState.minLengthText}
            />
            m
          </label>
        </div>
      </section>

      <section class="flex flex-col gap-2">
        <p class="text-xs font-semibold uppercase text-muted-foreground">Filters</p>
        <div class="flex flex-wrap gap-x-3 gap-y-1">
          {#each TYPES as [type, label] (type)}
            <label class="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={searchState.filters.types.includes(type)}
                onchange={() => toggleType(type)}
              />
              {label}
            </label>
          {/each}
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <DropdownMenu.Root>
            <DropdownMenu.Trigger>
              {#snippet child({ props })}
                <Button {...props} variant="outline" size="sm" class="justify-between">
                  {styleSummary}
                  <span class="icon-[lucide--chevron-down] shrink-0 size-4"></span>
                </Button>
              {/snippet}
            </DropdownMenu.Trigger>
            <DropdownMenu.Content class="w-48">
              <DropdownMenu.CheckboxGroup bind:value={searchState.filters.styles}>
                {#each STYLES as [style, label] (style)}
                  <DropdownMenu.CheckboxItem value={style} closeOnSelect={false}>{label}</DropdownMenu.CheckboxItem>
                {/each}
              </DropdownMenu.CheckboxGroup>
            </DropdownMenu.Content>
          </DropdownMenu.Root>

          <Input
            placeholder="Min grade"
            class="h-8 w-24"
            aria-invalid={minInvalid}
            bind:value={searchState.gradeText.min}
          />
          <Input
            placeholder="Max grade"
            class="h-8 w-24"
            aria-invalid={maxInvalid}
            bind:value={searchState.gradeText.max}
          />
        </div>

        <form
          class="flex items-center gap-2"
          onsubmit={(e) => {
            e.preventDefault();
            addTag();
          }}
        >
          <Input placeholder="Tag, e.g. climbing:rock" class="h-8" bind:value={tagKey} />
          <Input placeholder="Value" class="h-8" bind:value={tagValue} />
          <Button size="xs" variant="outline" type="submit">Add</Button>
        </form>

        {#if searchState.filters.tags.length > 0}
          <div class="flex flex-wrap gap-1">
            {#each searchState.filters.tags as tag, i (i)}
              <Button
                size="xs"
                variant="secondary"
                onclick={() => (searchState.filters.tags = searchState.filters.tags.filter((_, j) => j !== i))}
              >
                {tag.key}{tag.value ? `=${tag.value}` : ""}
                <span class="icon-[lucide--x] shrink-0 size-3"></span>
              </Button>
            {/each}
          </div>
        {/if}
      </section>

      <section class="flex flex-col gap-2" aria-label="Search results overview">
        <p class="text-xs font-semibold uppercase text-muted-foreground">Results</p>
        {#if !searchState.active}
          <p class="text-xs text-muted-foreground">Type a name or pick a filter to search.</p>
        {:else if searchState.result === undefined}
          <p class="text-xs text-muted-foreground">
            {localDb.ready
              ? "No results"
              : "Searching everywhere needs all the data. Open an area first, or download everything in the sidebar."}
          </p>
        {:else}
          <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span class="text-sm font-semibold">{searchState.result.matches.size} matches</span>
            {#if searchState.result.status === "searching"}
              <span class="text-xs text-muted-foreground">Searching...</span>
            {:else if searchState.result.status === "paused"}
              <Button size="xs" variant="outline" onclick={() => searchState.loadMore?.()}>Load more</Button>
            {/if}
          </div>

          {#if stats.total > 0}
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              {#each stats.typeDistribution as entry (entry.style)}
                <span class="inline-flex items-center gap-1.5">
                  <span class="size-2.5 rounded-xs" style:background-color={entry.color}></span>
                  <span class="text-muted-foreground">{entry.label}:</span>
                  <span class="font-medium">{entry.count}</span>
                </span>
              {/each}
              {#if stats.ungraded > 0}
                <span class="text-muted-foreground">{stats.ungraded} ungraded</span>
              {/if}
            </div>

            {#if stats.gradeDistribution.length > 0}
              <div class="h-[170px] w-full overflow-x-auto">
                <div class="h-full" style:min-width="{Math.max(260, stats.gradeDistribution.length * 28)}px">
                  <Chart
                    data={stats.gradeDistribution}
                    height={170}
                    x="grade"
                    y="total"
                    xScale={scaleBand().padding(0.22)}
                    yScale={scaleLinear()}
                    yDomain={[0, maxGradeCount]}
                    padding={chartPadding}
                  >
                    {#snippet children({ context })}
                      <Layer>
                        <Axis placement="left" ticks={Math.min(4, maxGradeCount)} grid rule />
                        <Axis placement="bottom" rule />
                        {#each stats.gradeDistribution as bucket (bucket.grade)}
                          {@const x = context.xScale(bucket.grade) ?? 0}
                          {@const bw = context.xScale.bandwidth?.() ?? 16}
                          {#each STAT_STYLE_ORDER as style (style)}
                            {@const count = bucket.byStyle[style] ?? 0}
                            {#if count > 0}
                              {@const y1 = context.yScale(bucket.total)}
                              {@const y0 = context.yScale(bucket.total - count)}
                              <Rect
                                {x}
                                y={y0}
                                width={bw}
                                height={Math.max(1, y1 - y0)}
                                fill={STAT_STYLE_COLORS[style]}
                                rx={1}
                              />
                            {/if}
                          {/each}
                          <Text
                            x={x + bw / 2}
                            y={context.yScale(bucket.total) - 4}
                            textAnchor="middle"
                            fontSize={10}
                            value={String(bucket.total)}
                            class="fill-muted-foreground"
                          />
                        {/each}
                      </Layer>
                    {/snippet}
                  </Chart>
                </div>
              </div>
            {/if}
            {#if searchState.result.matches.size > OVERVIEW_LIMIT}
              <p class="text-xs text-muted-foreground">Charts cover the first {OVERVIEW_LIMIT} matches.</p>
            {/if}
          {/if}
        {/if}
      </section>
    </div>

    <Dialog.Footer>
      <Button variant="ghost" onclick={() => searchState.clear()}>Clear search</Button>
      <Button onclick={onShowResults}>Show results</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
