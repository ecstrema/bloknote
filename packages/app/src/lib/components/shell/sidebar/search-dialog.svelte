<script lang="ts">
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import * as Dialog from "#components/ui/dialog/index.js";
  import * as DropdownMenu from "#components/ui/dropdown-menu/index.js";
  import { Button } from "#components/ui/button/index.js";
  import { Select } from "#components/ui/select/index.js";
  import Input from "#components/ui/input/input.svelte";
  import { localDb } from "#lib/data/db/local-db.svelte.js";
  import { gradeTextToReference } from "#lib/data/db/grade-text.js";
  import { parseTagFilter } from "#lib/data/db/tag-filter.js";
  import type { TagFilter } from "#lib/data/db/types.js";
  import { searchState, type PremadeFilterKind } from "./search-state.svelte.js";
  import { atproto } from "#lib/data/network/atproto.svelte.js";
  import { untrack } from "svelte";

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

  /** The premade "from your logbook" filters the user can toggle (issue #166) */
  const PREMADE_FILTERS = [
    { kind: "ticked", label: "Ticked", icon: "icon-[lucide--check-circle-2]" },
    {
      kind: "bookmarked",
      label: "Bookmarked",
      icon: "icon-[lucide--bookmark]",
    },
    { kind: "rated", label: "Rated", icon: "icon-[lucide--gauge]" },
    {
      kind: "commented",
      label: "Commented",
      icon: "icon-[lucide--message-circle]",
    },
  ] as const satisfies readonly {
    kind: PremadeFilterKind;
    label: string;
    icon: string;
  }[];

  let textInput = $state<HTMLInputElement | null>(null);

  /**
   * Tag filter rows (issue #269): one row per filter with separate tag, comparison and value
   * fields, no "add" button. The last row stays empty and ready for a new query: typing in it
   * grows the list, blurring an untouched row removes it again.
   */
  interface TagRow {
    key: string;
    op: NonNullable<TagFilter["op"]>;
    value: string;
  }
  const emptyRow = (): TagRow => ({ key: "", op: "=", value: "" });
  let tagRows = $state<TagRow[]>([emptyRow()]);

  /** Comparison operators of the row selects, in display order (issue #269) */
  const TAG_OPS: { value: TagRow["op"]; label: string }[] = [
    { value: "=", label: "=" },
    { value: "!=", label: "≠" },
    { value: "~", label: "contains" },
    { value: ">", label: ">" },
    { value: ">=", label: "≥" },
    { value: "<", label: "<" },
    { value: "<=", label: "≤" },
  ];

  $effect(() => {
    // Seed the rows from the active filters whenever the dialog opens
    if (!open) return;
    const seed = untrack(() => searchState.filters.tags).map((tag) => ({
      key: tag.key,
      op: tag.op ?? "=",
      value: tag.value,
    }));
    tagRows = [...seed, emptyRow()];
  });

  /** Converts a row to a filter: an expression pasted into the tag field keeps working (issue #236) */
  function rowToFilter(row: TagRow): TagFilter | undefined {
    const key = row.key.trim();
    if (!key) return undefined;
    const parsed = parseTagFilter(key);
    if (parsed && (parsed.op || parsed.value)) {
      return {
        key: parsed.key,
        op: row.op === "=" && !row.value.trim() ? (parsed.op ?? "=") : row.op,
        value: parsed.value || row.value.trim(),
      };
    }
    return { key, op: row.op, value: row.value.trim() };
  }

  /** Pushes the filled rows into the search state, keeping one empty row at the bottom */
  function syncTagRows() {
    searchState.filters.tags = tagRows.flatMap(rowToFilter).filter((tag): tag is TagFilter => !!tag);
    const last = tagRows[tagRows.length - 1];
    if (!last || last.key.trim() !== "" || last.value.trim() !== "") tagRows = [...tagRows, emptyRow()];
  }

  /** The search starts after a short delay: there is no "add" button anymore (issue #269) */
  const TAG_SEARCH_DELAY_MS = 500;
  let tagSyncTimer: ReturnType<typeof setTimeout> | undefined;

  function onTagInput() {
    clearTimeout(tagSyncTimer);
    tagSyncTimer = setTimeout(syncTagRows, TAG_SEARCH_DELAY_MS);
  }

  function onTagBlur(index: number) {
    // An empty row that is not the bottom "new query" row disappears when the user defocuses it
    const row = tagRows[index];
    if (!row || index === tagRows.length - 1) return;
    if (row.key.trim() === "" && row.value.trim() === "") {
      tagRows = tagRows.filter((_, i) => i !== index);
      syncTagRows();
    }
  }

  function removeTagRow(index: number) {
    clearTimeout(tagSyncTimer);
    tagRows = tagRows.filter((_, i) => i !== index);
    if (tagRows.length === 0) tagRows = [emptyRow()];
    syncTagRows();
  }

  /** Flushes pending tag row edits, e.g. before showing the results or closing the dialog */
  function flushTagRows() {
    clearTimeout(tagSyncTimer);
    syncTagRows();
  }

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

  /** Opens the overview plots of the current results in a full page (issue #214) */
  function exploreResults() {
    flushTagRows();
    open = false;
    void goto(resolve("/explore"));
  }
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

        <!-- Tag filter rows (issue #269): no add button, the bottom row is always ready for a new query -->
        <div class="flex flex-col gap-1.5" role="group" aria-label="Tag filters">
          {#each tagRows as row, i (i)}
            <div class="flex items-center gap-1.5">
              <Input
                placeholder="Tag, e.g. climbing:length"
                class="h-8 flex-1"
                aria-label="Tag name"
                bind:value={tagRows[i]!.key}
                oninput={onTagInput}
                onblur={() => onTagBlur(i)}
              />
              <Select
                aria-label="Comparison"
                class="h-8 w-auto py-0"
                bind:value={tagRows[i]!.op}
                onchange={onTagInput}
              >
                {#each TAG_OPS as op (op.value)}
                  <option value={op.value}>{op.label}</option>
                {/each}
              </Select>
              <Input
                placeholder="Value"
                class="h-8 w-28"
                aria-label="Tag value"
                bind:value={tagRows[i]!.value}
                oninput={onTagInput}
                onblur={() => onTagBlur(i)}
              />
              <Button
                size="icon-sm"
                variant="ghost"
                title="Remove this filter"
                aria-label="Remove this filter"
                onclick={() => removeTagRow(i)}
              >
                <span class="icon-[lucide--x] shrink-0 size-3.5"></span>
              </Button>
            </div>
          {/each}
        </div>
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

          <Button variant="outline" onclick={exploreResults}>
            <span class="icon-[lucide--chart-column] shrink-0 size-3.5"></span>
            Explore this data
          </Button>
        {/if}
      </section>
    </div>

    <Dialog.Footer>
      <Button
        variant="ghost"
        onclick={() => {
          flushTagRows();
          searchState.clear();
          tagRows = [emptyRow()];
        }}
      >
        Clear search
      </Button>
      <Button
        onclick={() => {
          flushTagRows();
          onShowResults();
        }}
      >
        Show results
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
