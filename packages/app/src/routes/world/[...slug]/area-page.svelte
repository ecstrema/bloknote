<script lang="ts">
  import EditableDescription from "#components/editable/editable-description.svelte";
  import ChildrenTable from "./children-table.svelte";
  import ClimbingStyles from "#components/climbing-styles.svelte";
  import CommonsTopo from "#lib/components/commons-topo.svelte";
  import { getAreaKindLabel } from "#lib/data/parse/diagnostics.js";
  import { buildTypstDocument } from "#lib/data/export/typst.js";
  import { Button } from "#components/ui/button/index.js";
  import Loader from "#components/ui/loader.svelte";
  import { localDb } from "#lib/data/db/local-db.svelte.js";
  import FileDownIcon from "@lucide/svelte/icons/file-down";
  import type { OsmFeature } from "osm-api";
  import type { DataTree } from "#lib/types.js";

  let {
    item = $bindable(),
    slug,
  }: {
    item: DataTree<OsmFeature>;
    slug: string;
  } = $props();

  const feature = $derived(item.feature);
  const kindLabel = $derived(getAreaKindLabel(feature));

  async function exportTypst() {
    const extra: OsmFeature[] = [];
    if (localDb.ready) {
      const sub = await localDb.getSubtreeElements(slug, 5000);
      for (const el of Object.values(sub.data)) {
        if (el.type !== "geographic") extra.push(el);
      }
    }
    const content = buildTypstDocument(item, slug, extra);
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug.split("/").at(-1) || "sector"}.typ`;
    a.click();
    URL.revokeObjectURL(url);
  }
</script>

<CommonsTopo {feature} featureSlug={slug} />

<div class="flex flex-wrap items-center justify-between gap-2">
  <div class="flex flex-wrap items-center gap-2">
    <span class="rounded bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{kindLabel}</span>
    <ClimbingStyles {feature} />
  </div>
  <Button size="xs" variant="outline" onclick={exportTypst}>
    <FileDownIcon />
    Export Typst
  </Button>
</div>
<EditableDescription {feature} featureSlug={slug} />

{#if item.stats?.totalRoutes}
  <p class="text-sm text-muted-foreground">{item.stats.totalRoutes} routes in total</p>
{/if}

{#await import("#lib/components/sector-stats.svelte")}
  <Loader class="h-24" />
{:then { default: SectorStats }}
  <SectorStats {item} {slug} />
{/await}

<ChildrenTable bind:item />
