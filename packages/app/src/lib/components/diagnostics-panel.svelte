<script lang="ts">
  import type { DataJSON } from "@bloknote/climbing-data-gen";
  import type { OsmFeature } from "osm-api";
  import { untrack } from "svelte";
  import { SvelteSet } from "svelte/reactivity";
  import { getItemUrl } from "#components/shell/sidebar/utils.js";
  import { Button } from "#components/ui/button/index.js";
  import { Select } from "#components/ui/select/index.js";
  import { getAppState } from "#lib/data/app-state.js";
  import { localDb } from "#lib/data/db/local-db.svelte.js";
  import { featureToType } from "#lib/data/parse/data.js";
  import {
    collectSubtreeDiagnostics,
    getAreaKindLabel,
    type DiagnosticPatch,
    type DiagnosticSeverity,
  } from "#lib/data/parse/diagnostics.js";
  import { getLocalizedName } from "#lib/data/parse/localized-name.js";
  import { getParentSlug, getParentSlugs } from "#lib/helpers/slug.js";
  import type { DataTree } from "#lib/types.js";

  let { item, slug }: { item: DataTree; slug: string } = $props();

  const appState = getAppState();

  let dbElements = $state.raw<Record<string, DataJSON>>({});
  let dbTruncated = $state(false);
  let loadingSubtree = $state(false);
  let scanningLoaded = $state(false);
  let severityFilter = $state<"all" | DiagnosticSeverity>("all");
  let categoryFilter = $state("all");
  let fixableOnly = $state(false);
  const fixingSlugs = new SvelteSet<string>();
  let fixError = $state<string>();

  const isAreaLike = $derived(item.feature.type === "geographic" || featureToType(item.feature) === "area");

  $effect(() => {
    const targetSlug = slug;
    if (!isAreaLike || !localDb.ready) {
      dbElements = {};
      dbTruncated = false;
      return;
    }

    let cancelled = false;
    loadingSubtree = true;
    localDb
      .getSubtreeElements(targetSlug, 2000)
      .then((res) => {
        if (cancelled) return;
        dbElements = res.data;
        dbTruncated = res.truncated;
      })
      .finally(() => {
        if (!cancelled) loadingSubtree = false;
      });
    return () => {
      cancelled = true;
    };
  });

  const allEntries = $derived(
    collectSubtreeDiagnostics(item, slug, dbElements, (entrySlug) => appState.tree.getReactiveNode(entrySlug)),
  );

  const categories = $derived.by(() => {
    const titles = new Map<string, string>();
    for (const entry of allEntries) {
      for (const d of entry.diagnostics) titles.set(d.id, d.title);
    }
    return [...titles.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  });

  const filteredEntries = $derived.by(() =>
    allEntries
      .map((entry) => ({
        ...entry,
        diagnostics: entry.diagnostics.filter(
          (d) =>
            (severityFilter === "all" || d.severity === severityFilter) &&
            (categoryFilter === "all" || d.id === categoryFilter) &&
            (!fixableOnly || (d.fixes && d.fixes.length > 0)),
        ),
      }))
      .filter((entry) => entry.diagnostics.length > 0),
  );

  const counts = $derived.by(() => {
    let errors = 0;
    let warnings = 0;
    let fixable = 0;
    for (const entry of allEntries) {
      for (const d of entry.diagnostics) {
        if (d.severity === "error") errors++;
        else warnings++;
        if (d.fixes && d.fixes.length > 0) fixable++;
      }
    }
    return { errors, warnings, fixable, total: errors + warnings };
  });

  async function scanUnloadedSubtree() {
    scanningLoaded = true;
    try {
      const queue: { node: DataTree; nodeSlug: string }[] = [{ node: item, nodeSlug: slug }];
      const visited = new Set<string>();
      while (queue.length > 0) {
        const current = queue.shift()!;
        if (visited.has(current.nodeSlug)) continue;
        visited.add(current.nodeSlug);
        if (current.node.feature.type === "geographic" || featureToType(current.node.feature) === "area") {
          await untrack(() => appState.fetchChildren(current.nodeSlug));
          const updated = untrack(() => appState.tree.getReactiveNode(current.nodeSlug)) ?? current.node;
          for (const [childSlug, child] of Object.entries(updated.children ?? {})) {
            queue.push({ node: child, nodeSlug: childSlug });
          }
        }
      }
    } finally {
      scanningLoaded = false;
    }
  }

  async function applyFix(targetSlug: string, patch: DiagnosticPatch) {
    fixError = undefined;
    fixingSlugs.add(targetSlug);
    try {
      if (!appState.tree.getReactiveNode(targetSlug)) {
        const ancestors = getParentSlugs(targetSlug);
        let startIdx = 0;
        for (let i = ancestors.length - 1; i >= 0; i--) {
          if (appState.tree.getReactiveNode(ancestors[i]!)) {
            startIdx = i;
            break;
          }
        }
        for (const parentSlug of ancestors.slice(startIdx)) {
          await appState.fetchChildren(parentSlug);
        }
      }

      if (!appState.tree.getReactiveNode(targetSlug)) {
        const fallback = dbElements[targetSlug];
        const parentSlug = getParentSlug(targetSlug);
        if (fallback && parentSlug !== undefined && appState.tree.getReactiveNode(parentSlug)) {
          appState.tree.integrateNodeIntoTree({ feature: fallback }, targetSlug, parentSlug);
        }
      }

      if (!appState.tree.getReactiveNode(targetSlug)) {
        fixError = `Could not load "${targetSlug}" to apply this fix.`;
        return;
      }

      appState.applyTagPatch(targetSlug, patch);
    } catch (error) {
      fixError = error instanceof Error ? error.message : "Could not apply fix.";
    } finally {
      fixingSlugs.delete(targetSlug);
    }
  }

  function featureHref(entrySlug: string, feature: OsmFeature, tab: "diagnostics" | "osm") {
    return `${getItemUrl(getParentSlug(entrySlug) ?? "", feature)}&tab=${tab}`;
  }
</script>

<div class="flex flex-col gap-4">
  <div class="flex flex-wrap items-center justify-between gap-2">
    <div class="text-sm text-muted-foreground">
      {#if loadingSubtree}
        Scanning area...
      {:else if counts.total === 0}
        No tagging issues detected.
      {:else}
        {counts.total} issue{counts.total === 1 ? "" : "s"} across {allEntries.length}
        feature{allEntries.length === 1 ? "" : "s"}
        ({counts.errors} error{counts.errors === 1 ? "" : "s"}, {counts.warnings}
        warning{counts.warnings === 1 ? "" : "s"}).
        {#if dbTruncated}
          <span>Showing first 2,000 elements.</span>
        {/if}
      {/if}
    </div>

    {#if isAreaLike && !localDb.ready}
      <Button size="xs" variant="outline" disabled={scanningLoaded} onclick={scanUnloadedSubtree}>
        <span class="icon-[lucide--search] shrink-0 size-4"></span>
        {scanningLoaded ? "Scanning sub-areas..." : "Scan all sub-areas"}
      </Button>
    {/if}
  </div>

  {#if allEntries.length > 0}
    <div class="flex flex-wrap items-center gap-2">
      <div class="flex gap-1">
        <Button
          size="xs"
          variant={severityFilter === "all" ? "default" : "outline"}
          onclick={() => (severityFilter = "all")}
        >
          All ({counts.total})
        </Button>
        <Button
          size="xs"
          variant={severityFilter === "error" ? "default" : "outline"}
          onclick={() => (severityFilter = "error")}
        >
          Errors ({counts.errors})
        </Button>
        <Button
          size="xs"
          variant={severityFilter === "warning" ? "default" : "outline"}
          onclick={() => (severityFilter = "warning")}
        >
          Warnings ({counts.warnings})
        </Button>
        <Button size="xs" variant={fixableOnly ? "default" : "outline"} onclick={() => (fixableOnly = !fixableOnly)}>
          With fixes ({counts.fixable})
        </Button>
      </div>

      {#if categories.length > 1}
        <Select aria-label="Filter by issue type" class="w-auto max-w-xs" bind:value={categoryFilter}>
          <option value="all">All issue types</option>
          {#each categories as [id, title] (id)}
            <option value={id}>{title}</option>
          {/each}
        </Select>
      {/if}
    </div>
  {/if}

  {#if !appState.osmUser.loggedIn && counts.total > 0}
    <p class="text-xs text-muted-foreground">Log in with OpenStreetMap to apply quick fixes and publish a changeset.</p>
  {/if}
  {#if fixError}
    <p class="text-xs text-destructive">{fixError}</p>
  {/if}

  {#if counts.total === 0 && !loadingSubtree}
    <div class="flex items-center gap-2 rounded-md border p-4 text-sm text-muted-foreground">
      <span aria-hidden="true" class="icon-[lucide--check-circle-2] shrink-0 size-4 text-emerald-600"></span>
      <span>All scanned tags look good.</span>
    </div>
  {:else}
    <div class="flex flex-col gap-3">
      {#each filteredEntries as entry (entry.slug)}
        {@const featureName = getLocalizedName(entry.feature) || "Unnamed"}
        {@const typeLabel =
          featureToType(entry.feature) === "area"
            ? getAreaKindLabel(entry.feature)
            : (featureToType(entry.feature) ?? entry.feature.type)}
        <div class="rounded-md border p-3 flex flex-col gap-2">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="flex flex-wrap items-center gap-2 text-sm">
              <a
                href={featureHref(entry.slug, entry.feature, "diagnostics")}
                class="font-medium underline underline-offset-2"
              >
                {featureName}
              </a>
              <span class="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground capitalize"
                >{typeLabel}</span
              >
              {#if entry.slug !== slug}
                <span class="text-xs text-muted-foreground">{entry.slug}</span>
              {/if}
            </div>
            <a
              href={featureHref(entry.slug, entry.feature, "osm")}
              class="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              Edit OSM tags
            </a>
          </div>

          <ul class="flex flex-col gap-2">
            {#each entry.diagnostics as diag (diag.id)}
              <li class="rounded border bg-muted/30 p-2.5 text-sm flex flex-col gap-1.5">
                <div class="flex items-center gap-2 font-medium">
                  {#if diag.severity === "error"}
                    <span
                      aria-hidden="true"
                      class="icon-[lucide--circle-alert] shrink-0 size-4 shrink-0 text-destructive"
                    ></span>
                  {:else}
                    <span
                      aria-hidden="true"
                      class="icon-[lucide--triangle-alert] shrink-0 size-4 shrink-0 text-amber-600 dark:text-amber-400"
                    ></span>
                  {/if}
                  <span>{diag.title}</span>
                </div>
                <p class="text-xs text-muted-foreground">{diag.description}</p>
                {#if appState.osmUser.loggedIn && diag.fixes && diag.fixes.length > 0}
                  <div class="flex flex-wrap gap-1.5 pt-1">
                    {#each diag.fixes as fix (fix.label)}
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={fixingSlugs.has(entry.slug)}
                        onclick={() => applyFix(entry.slug, fix.patch)}
                      >
                        <span class="icon-[lucide--wrench] shrink-0 size-4"></span>
                        {fix.label}
                      </Button>
                    {/each}
                  </div>
                {/if}
              </li>
            {/each}
          </ul>
        </div>
      {/each}
    </div>
  {/if}
</div>
