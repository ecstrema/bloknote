<script lang="ts">
  import type { Key, OsmFeature } from "osm-api";
  import { getAppState } from "#lib/data/app-state.js";
  import { getClimbingStyles } from "#lib/data/parse/osm-tags.js";
  import * as DropdownMenu from "#components/ui/dropdown-menu/index.js";
  import { cn } from "#lib/utils.js";

  let {
    feature,
    featureSlug,
    editable = false,
  }: { feature: OsmFeature; featureSlug?: string; editable?: boolean } = $props();
  const appState = getAppState();

  const styles = $derived(feature.tags ? getClimbingStyles(feature.tags) : []);
  const canEdit = $derived(editable && !!featureSlug && !!appState.osmUser.loggedIn);

  /** Primary climbing styles that can be set on a feature, as OSM tags */
  const STYLE_OPTIONS = [
    ["sport", "Sport"],
    ["trad", "Trad"],
    ["boulder", "Boulder"],
    ["toprope", "Top rope"],
    ["aid", "Aid"],
    ["ice", "Ice"],
    ["mixed", "Mixed"],
    ["dry", "Dry tooling"],
    ["deepwater", "Deep-water solo"],
  ] as const;

  const selected = $derived(styles.find((s) => STYLE_OPTIONS.some(([key]) => key === s.key))?.key);

  /** Replaces the primary climbing style in a single undoable step */
  function setStyle(styleKey: string) {
    if (!featureSlug) return;
    const patch: { set?: Partial<Record<Key, string>>; remove?: Key[] } = {
      set: { [`climbing:${styleKey}`]: "yes" },
    };
    const remove = STYLE_OPTIONS.map(([key]) => `climbing:${key}` as Key).filter(
      (key) => key !== `climbing:${styleKey}` && feature.tags?.[key] !== undefined,
    );
    if (remove.length > 0) patch.remove = remove;
    appState.applyTagPatch(featureSlug, patch);
  }
</script>

{#if canEdit}
  <DropdownMenu.Root>
    <DropdownMenu.Trigger
      class={cn(
        "cursor-pointer rounded-sm text-sm hover:outline-1 hover:outline-offset-2 hover:outline-ring/50 focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ring",
        styles.length === 0 && "text-muted-foreground",
      )}
      aria-label="Climbing style"
    >
      {styles.map((s) => s.label).join(", ") || "Style"}
    </DropdownMenu.Trigger>
    <DropdownMenu.Content align="start">
      <DropdownMenu.RadioGroup value={selected} onValueChange={setStyle}>
        {#each STYLE_OPTIONS as [key, label] (key)}
          <DropdownMenu.RadioItem value={key}>{label}</DropdownMenu.RadioItem>
        {/each}
      </DropdownMenu.RadioGroup>
    </DropdownMenu.Content>
  </DropdownMenu.Root>
{:else if styles.length > 0}
  <ul class="flex flex-wrap gap-1.5" aria-label="Climbing styles">
    {#each styles as style (style.key)}
      <li class="inline-flex items-center gap-1.5 rounded-sm border border-border px-2 py-1 text-xs font-medium">
        {style.label}
        {#if style.count !== undefined}
          <span class="text-muted-foreground">{style.count} {style.count === 1 ? "route" : "routes"}</span>
        {/if}
      </li>
    {/each}
  </ul>
{/if}
