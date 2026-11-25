<script lang="ts">
  import { resolve } from "$app/paths";
  import { Button } from "#components/ui/button/index.js";
  import { Input } from "#components/ui/input/index.js";
  import { Select } from "#components/ui/select/index.js";
  import { atproto, type LocalTickEntry } from "#lib/data/network/atproto.svelte.js";
  import { localDb } from "#lib/data/db/local-db.svelte.js";
  import { dataClient } from "#lib/data/network/data-client.js";
  import { getGrade, getGradeReference } from "#lib/data/parse/osm-tags.js";
  import { getName } from "#lib/data/parse/data.js";
  import { extractRouteStyle, ROUTE_STYLE_LABELS } from "#lib/data/parse/route-styles.js";
  import HolyGrade from "#components/grade/holy-grade.svelte";
  import type { Grade } from "#lib/types.js";
  import type { AscentStyle } from "@bloknote/common";
  import { getFeature, type OsmFeature, type Tags } from "osm-api";
  import TickOsmDialog from "#lib/components/tick-osm-dialog.svelte";

  type SortMode = "places" | "recent" | "name" | "grade";
  const sortModes: { value: SortMode; label: string }[] = [
    { value: "places", label: "Places" },
    { value: "recent", label: "Recent" },
    { value: "name", label: "Name" },
    { value: "grade", label: "Grade" },
  ];
  let sortMode = $state<SortMode>("places");

  /** Distinct color per ascent style */
  const STYLE_BADGE_CLASSES: Record<AscentStyle, string> = {
    onsight: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    flash: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300",
    redpoint: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
    attempt: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  };

  /** Ticks pointing at an OSM element: subject-less ticks (routes not on OSM yet) are excluded */
  const osmTicks = $derived(atproto.ticks.filter((t) => t.subject));

  /** Ticks and stars resolved against the local database: the route's slug, name, grade, style */
  interface ResolvedRef {
    slug?: string;
    name?: string;
    grade?: Grade;
    gradeRef?: number;
    style?: string;
    /** Checked against a ready local database and absent from it: no need to re-check for a slug */
    notInDataset?: boolean;
    /** The dataset version the absence was checked against: a newer dataset may contain the element */
    datasetVersion?: string;
  }
  let resolved = $state<Record<string, ResolvedRef>>({});
  /** Bumped to re-run the resolution after a failed database lookup */
  let resolveAttempt = $state(0);

  /** Route candidates found again in the OSM data for subject-less ticks, by local tick id */
  let rematch = $state<Record<string, { candidates: { slug: string; name: string; grade?: string; feature: OsmFeature }[] }>>({});

  let busy = $state(false);
  let error = $state<string>();

  /** Live OSM fallback for elements missing from the local dataset (routes added after it was built) */
  async function resolveFromOsm(ref: string): Promise<ResolvedRef> {
    const [type, id] = ref.split("-");
    try {
      const [feature] = await getFeature(type as "node" | "way" | "relation", Number(id));
      const tags = feature?.tags ?? {};
      return {
        name: tags.name,
        grade: getGrade(tags)?.v,
        gradeRef: getGradeReference(tags),
        style: extractRouteStyle(tags),
      };
    } catch {
      return {};
    }
  }

  $effect(() => {
    const refs = [
      ...new Set([
        ...osmTicks.map((t) => `${t.subject!.type}-${t.subject!.id}`),
        ...atproto.stars.map((s) => `${s.subject.type}-${s.subject.id}`),
      ]),
    ];
    void resolveAttempt;
    const ready = localDb.ready;
    const datasetVersion = localDb.dataVersion;
    const missing = refs.filter((ref) => {
      const entry = resolved[ref];
      if (entry === undefined) return true;
      // Entries whose absence was checked against an older dataset are re-checked after an update
      return ready && !entry.slug && (!entry.notInDataset || entry.datasetVersion !== datasetVersion);
    });
    if (missing.length === 0) return;
    let cancelled = false;
    // While the database is still opening the names are resolved live from the OSM API instead,
    // without a slug, then re-checked against the database once it becomes ready
    localDb
      .getByOsmRefs(ready ? missing : [])
      .then(async (entries) => {
        const next = { ...resolved };
        for (const ref of missing) {
          const entry = entries[ref];
          const tags = (entry?.data as OsmFeature | undefined)?.tags ?? {};
          if (tags.name) {
            next[ref] = {
              slug: entry?.slug,
              name: tags.name,
              grade: getGrade(tags)?.v,
              gradeRef: getGradeReference(tags),
              style: extractRouteStyle(tags),
            };
          } else if (!cancelled) {
            // Locally created elements (not yet pushed to OSM) are resolved from memory: the
            // ticks list can place them under their parent right after the creation, without
            // waiting for the database mirror or the changeset push
            const local = dataClient.getLocalNodeByOsmRef(ref);
            if (local) {
              const tags = local.feature.tags ?? {};
              next[ref] = {
                slug: local.slug,
                name: tags.name,
                grade: getGrade(tags)?.v,
                gradeRef: getGradeReference(tags),
                style: extractRouteStyle(tags),
              };
            } else {
              const fromOsm = await resolveFromOsm(ref);
              // The absence is only cached when the lookup really ran against a ready database:
              // a data update may have started since the effect ran (the lookup then returned
              // nothing at all), and the refreshed dataset may contain the element after all.
              // Reading the readiness now instead of reusing the effect-run value keeps the flag
              // off in that window, so the element is re-checked once the database is back.
              next[ref] =
                ready && localDb.ready
                  ? { ...fromOsm, notInDataset: true, datasetVersion: localDb.dataVersion }
                  : fromOsm;
            }
          }
        }
        // Merge instead of replacing: later effect runs may have resolved more refs while this
        // one was still waiting for the live OSM fallbacks
        if (!cancelled) resolved = { ...resolved, ...next };
      })
      .catch(() => {
        // Leave the refs unresolved and retry shortly: a failed lookup (database busy or
        // rebuilding) must not park the ticks outside of their places for the whole session
        if (cancelled || resolveAttempt >= 5) return;
        setTimeout(() => (resolveAttempt = resolveAttempt + 1), 3000);
      });
    return () => {
      cancelled = true;
    };
  });

  $effect(() => {
    // Re-check subject-less ticks against the OSM data: routes may have been added since (issue #154)
    const unmatched = atproto.ticks.filter((t) => !t.subject && t.name && t.localId);
    const toCheck = unmatched.filter((t) => rematch[t.localId!] === undefined);
    if (toCheck.length === 0 || !localDb.ready) return;
    let cancelled = false;
    (async () => {
      for (let start = 0; start < toCheck.length; start += 20) {
        const batch = toCheck.slice(start, start + 20);
        const matches = await localDb.matchTicks(batch.map((t) => ({ name: t.name!, area: t.locationHint })));
        if (cancelled) return;
        rematch = { ...rematch };
        matches.forEach((found, index) => {
          const entry = batch[index]!;
          rematch[entry.localId!] = {
            candidates: found.map((m) => ({
              slug: m.slug,
              name: (m.data as OsmFeature).tags?.name ?? "Unnamed",
              grade: getGrade((m.data as OsmFeature).tags ?? {})?.v.v,
              feature: m.data as OsmFeature,
            })),
          };
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  });

  function labelFor(tick: LocalTickEntry): string {
    if (tick.subject) {
      return (
        tick.label ||
        resolved[`${tick.subject.type}-${tick.subject.id}`]?.name ||
        `${tick.subject.type}/${tick.subject.id}`
      );
    }
    return tick.name ?? "Unnamed route";
  }

  /** Grade reference used by the "Grade" sort: OSM data first, else the logbook grade string */
  function gradeRefFor(tick: LocalTickEntry): number {
    if (tick.subject) {
      return resolved[`${tick.subject.type}-${tick.subject.id}`]?.gradeRef ?? 0;
    }
    if (!tick.grade) return 0;
    return getGradeReference({ "climbing:grade": tick.grade } as Tags) ?? 0;
  }

  const sortedTicks = $derived.by(() => {
    const ticks = [...atproto.ticks];
    switch (sortMode) {
      case "name":
        return ticks.sort((a, b) => labelFor(a).localeCompare(labelFor(b)));
      case "grade":
        return ticks.sort((a, b) => gradeRefFor(b) - gradeRefFor(a));
      default:
        return ticks.sort((a, b) => (b.climbedAt ?? "").localeCompare(a.climbedAt ?? ""));
    }
  });

  /** Names of the places along the resolved slugs, for the "Places" tree */
  let placeNames = $state<Record<string, string>>({});

  /** A node of the "Places" tree: a place in the slug hierarchy with the ticks attached to it */
  interface PlaceNode {
    /** Full slug path; absent for the invisible root and the unlinked bucket */
    slug?: string;
    name: string;
    children: PlaceNode[];
    ticks: LocalTickEntry[];
    total: number;
  }

  /** Groups the ticks under the places of their slug hierarchy (default "Places" mode) */
  const placeTree = $derived.by(() => {
    if (sortMode !== "places") return undefined;
    const root: PlaceNode = { name: "", children: [], ticks: [], total: 0 };
    const nodes = new Map<string, PlaceNode>([["", root]]);
    const ensure = (slug: string): PlaceNode => {
      const existing = nodes.get(slug);
      if (existing) return existing;
      const node: PlaceNode = {
        slug,
        name: placeNames[slug] ?? slug.split("/").at(-1)!.replaceAll("-", " "),
        children: [],
        ticks: [],
        total: 0,
      };
      nodes.set(slug, node);
      ensure(slug.includes("/") ? slug.slice(0, slug.lastIndexOf("/")) : "").children.push(node);
      return node;
    };
    for (const tick of sortedTicks) {
      const info = tick.subject ? resolved[`${tick.subject.type}-${tick.subject.id}`] : undefined;
      if (info?.slug) {
        ensure(info.slug).ticks.push(tick);
        continue;
      }
      // Ticks without a place in the tree. Both kinds belong to the same bucket: subject-less
      // ticks are not on OSM at all yet (issue #154), while ticks with a subject exist on OSM
      // but are missing from the local dataset snapshot (e.g. routes just added to the map).
      // The tick rows themselves tell the two cases apart (OSM link vs "Add to OSM").
      const bucketName = "Not in the map data";
      let bucket = nodes.get(bucketName);
      if (!bucket) {
        bucket = { name: bucketName, children: [], ticks: [], total: 0 };
        nodes.set(bucketName, bucket);
        root.children.push(bucket);
      }
      bucket.ticks.push(tick);
    }
    const order = (node: PlaceNode): number => {
      node.children.sort((a, b) => a.name.localeCompare(b.name));
      node.total = node.ticks.length + node.children.reduce((sum, child) => sum + order(child), 0);
      return node.total;
    };
    order(root);
    return root;
  });

  $effect(() => {
    if (sortMode !== "places" || !localDb.ready) return;
    const slugs = new Set<string>();
    const walk = (node: PlaceNode) => {
      if (node.slug && placeNames[node.slug] === undefined) slugs.add(node.slug);
      node.children.forEach(walk);
    };
    walk(placeTree!);
    if (slugs.size === 0) return;
    Promise.all([...slugs].map(async (slug) => [slug, await localDb.getNode(slug)] as const)).then((entries) => {
      // Geographic places keep their name at the top level, OSM elements in their tags (see getName)
      placeNames = {
        ...placeNames,
        ...Object.fromEntries(entries.map(([slug, node]) => [slug, (node && getName(node)) || slug])),
      };
    });
  });

  /** Inline edits are pushed to the PDS after a short delay, so typing stays smooth */
  const SAVE_DELAY_MS = 2500;
  const saveTimers: Record<string, ReturnType<typeof setTimeout>> = {};
  let saving = $state<Record<string, boolean>>({});

  function scheduleSave(tick: LocalTickEntry) {
    const id = tick.localId!;
    clearTimeout(saveTimers[id]);
    saving = { ...saving, [id]: true };
    saveTimers[id] = setTimeout(() => {
      delete saveTimers[id];
      atproto
        .pushTick(tick)
        .catch((err) => (error = err instanceof Error ? err.message : "Could not save the tick."))
        .finally(() => {
          saving = { ...saving, [id]: false };
        });
    }, SAVE_DELAY_MS);
  }

  function setStyle(tick: LocalTickEntry, style: AscentStyle) {
    tick.style = style;
    scheduleSave(tick);
  }

  function setDate(tick: LocalTickEntry, value: string) {
    if (!value) return;
    tick.climbedAt = new Date(`${value}T12:00:00Z`).toISOString();
    scheduleSave(tick);
  }

  function setComment(tick: LocalTickEntry, value: string) {
    const trimmed = value.trim();
    if (trimmed) tick.comment = trimmed;
    else delete tick.comment;
    scheduleSave(tick);
  }

  async function onDelete(tick: LocalTickEntry) {
    clearTimeout(saveTimers[tick.localId!]);
    busy = true;
    error = undefined;
    try {
      await atproto.deleteTick(tick);
    } catch (err) {
      error = err instanceof Error ? err.message : "Could not delete the tick.";
    } finally {
      busy = false;
    }
  }

  async function onLink(tick: LocalTickEntry, slug: string) {
    const candidate = rematch[tick.localId!]?.candidates.find((c) => c.slug === slug);
    if (!candidate) return;
    busy = true;
    error = undefined;
    try {
      await atproto.linkTick(tick, { type: candidate.feature.type, id: candidate.feature.id }, candidate.feature.tags?.name);
      const { [tick.localId!]: _removed, ...rest } = rematch;
      rematch = rest;
    } catch (err) {
      error = err instanceof Error ? err.message : "Could not link the tick.";
    } finally {
      busy = false;
    }
  }

  /** The tick currently going through the "Add to OSM" dialog, shown over the ticks list (issue #201) */
  let addOsmTick = $state<LocalTickEntry | undefined>();
</script>

<section class="flex flex-col gap-3 rounded-md border p-3.5" aria-label="Your ticks">
  <div class="flex flex-wrap items-center justify-between gap-2">
    <h2 class="text-sm font-semibold">Your ticks ({sortedTicks.length})</h2>
    <Select aria-label="Sort ticks" class="w-auto" bind:value={sortMode}>
      {#each sortModes as mode (mode.value)}
        <option value={mode.value}>{mode.label}</option>
      {/each}
    </Select>
  </div>

  {#if error}
    <p class="text-xs text-destructive">{error}</p>
  {/if}

  {#snippet tickRow(tick: LocalTickEntry)}
        {@const linked = rematch[tick.localId!]?.candidates ?? []}
        {@const info = tick.subject ? resolved[`${tick.subject.type}-${tick.subject.id}`] : undefined}
        <li class="flex flex-col gap-1 rounded border p-2">
          <div class="flex flex-wrap items-center gap-2">
            {#if tick.subject}
              <a
                href={info?.slug
                  ? resolve("/world/[...slug]", { slug: info.slug })
                  : `https://www.openstreetmap.org/${tick.subject.type}/${tick.subject.id}`}
                target={info?.slug ? undefined : "_blank"}
                rel="noreferrer"
                class="font-medium underline underline-offset-2"
              >
                {labelFor(tick)}
              </a>
            {:else}
              <span class="font-medium">{labelFor(tick)}</span>
            {/if}
            {#if info?.grade}
              <HolyGrade class="text-xs font-semibold" grade={info.grade} />
            {:else if tick.grade}
              <span class="text-xs text-muted-foreground">{tick.grade}</span>
            {/if}
            {#if info?.style}
              <span class="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                {ROUTE_STYLE_LABELS[info.style] ?? info.style}
              </span>
            {/if}
            <span class="ms-auto flex flex-wrap items-center gap-2">
              {#if saving[tick.localId!]}
                <span class="text-[11px] text-muted-foreground">Saving…</span>
              {:else if !tick.uri}
                <span class="rounded border px-1.5 py-0.5 text-[11px] text-muted-foreground">Pending sync</span>
              {/if}
              <Select
                aria-label="Ascent style of {labelFor(tick)}"
                class={`w-auto rounded px-1.5 py-0.5 text-[11px] font-medium capitalize ${STYLE_BADGE_CLASSES[tick.style]}`}
                value={tick.style}
                onchange={(e) => setStyle(tick, (e.target as HTMLSelectElement).value as AscentStyle)}
              >
                <option value="onsight">Onsight</option>
                <option value="flash">Flash</option>
                <option value="redpoint">Redpoint</option>
                <option value="attempt">Attempt</option>
              </Select>
              <Input
                type="date"
                class="w-auto text-xs"
                value={tick.climbedAt.slice(0, 10)}
                aria-label="Ascent date of {labelFor(tick)}"
                onchange={(e) => setDate(tick, (e.target as HTMLInputElement).value)}
              />
              <Button
                size="icon-xs"
                variant="ghost"
                title="Delete tick"
                aria-label="Delete tick"
                disabled={busy}
                onclick={() => onDelete(tick)}
              >
                <span aria-hidden="true" class="icon-[lucide--trash-2] size-3.5"></span>
              </Button>
            </span>
          </div>
          <Input
            class="w-full text-xs"
            value={tick.comment ?? ""}
            placeholder="Comment"
            aria-label="Comment on {labelFor(tick)}"
            oninput={(e) => setComment(tick, (e.target as HTMLInputElement).value)}
          />

          {#if !tick.subject}
            <p class="text-xs text-muted-foreground">
              Not on OpenStreetMap{tick.locationHint ? ` · ${tick.locationHint}` : ""}
            </p>

            {#if linked.length > 0}
              <div class="flex flex-wrap items-center gap-2 text-xs">
                <span class="text-muted-foreground">Found in the OSM data:</span>
                <Select
                  aria-label="Matching OSM route for {labelFor(tick)}"
                  class="w-auto max-w-56"
                  value={linked[0]!.slug}
                  onchange={(e) => onLink(tick, (e.target as HTMLSelectElement).value)}
                >
                  {#each linked as candidate (candidate.slug)}
                    <option value={candidate.slug}>
                      {candidate.name}{candidate.grade ? ` (${candidate.grade})` : ""}
                    </option>
                  {/each}
                </Select>
                <span class="text-muted-foreground">Changing the route links the tick to it.</span>
              </div>
            {:else}
              <div class="flex flex-wrap items-center gap-2">
                <Button size="xs" variant="outline" onclick={() => (addOsmTick = tick)}>
                  <span class="icon-[lucide--map-pin-plus] shrink-0 size-4"></span>
                  Add to OSM
                </Button>
              </div>
            {/if}
          {/if}
        </li>
  {/snippet}

  {#snippet placeNode(node: PlaceNode)}
    <li>
      <details open>
        <summary class="cursor-pointer select-none text-xs font-medium text-muted-foreground">
          {node.name} ({node.total})
        </summary>
        <ul class="ms-2 flex flex-col gap-1 border-s ps-3 pt-1">
          {#each node.children as child (child.slug ?? child.name)}
            {@render placeNode(child)}
          {/each}
          {#each node.ticks as tick (tick.localId)}
            {@render tickRow(tick)}
          {/each}
        </ul>
      </details>
    </li>
  {/snippet}

  {#if sortedTicks.length === 0}
    <p class="text-xs text-muted-foreground">No ticks yet. Log them on a route page, or import a logbook above.</p>
  {:else if sortMode === "places"}
    <ul class="flex flex-col gap-1 text-sm">
      {#each placeTree!.children as node (node.slug ?? node.name)}
        {@render placeNode(node)}
      {/each}
    </ul>
  {:else}
    <ul class="flex flex-col gap-2 text-sm">
      {#each sortedTicks as tick (tick.localId)}
        {@render tickRow(tick)}
      {/each}
    </ul>
  {/if}
</section>

{#if addOsmTick}
  <TickOsmDialog tick={addOsmTick} onClose={() => (addOsmTick = undefined)} />
{/if}
