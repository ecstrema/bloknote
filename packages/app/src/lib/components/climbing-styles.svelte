<script lang="ts">
  import type { Key, OsmFeature } from "osm-api";
  import { getAppState } from "#lib/data/app-state.js";
  import { getClimbingStyles, isMultipitchRoute } from "#lib/data/parse/osm-tags.js";
  import * as Popover from "#components/ui/popover/index.js";
  import { Button } from "#components/ui/button/index.js";
  import { Input } from "#components/ui/input/index.js";
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
  const isMultipitch = $derived(isMultipitchRoute(feature.tags));
  const rawPitches = $derived(feature.tags?.["climbing:pitches"]?.trim() ?? "");

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

  /** Toggles the multipitch flag, clearing the pitch count when the route is no longer one */
  function setMultipitch(multipitch: boolean) {
    if (!featureSlug) return;
    appState.undoStack.beginGroup();
    if (multipitch) {
      appState.setTag(featureSlug, "climbing:multipitch", "yes");
    } else {
      appState.deleteTag(featureSlug, "climbing:multipitch");
      appState.deleteTag(featureSlug, "climbing:pitches");
    }
    appState.undoStack.endGroup();
  }

  function setPitches(input: string) {
    if (!featureSlug) return;
    const value = input.trim();
    if (value && !/^[1-9]\d*$/.test(value)) return;
    appState.setTag(featureSlug, "climbing:pitches", value || undefined);
    if (value && Number(value) > 1) appState.setTag(featureSlug, "climbing:multipitch", "yes");
  }
</script>

{#if canEdit}
  <Popover.Root>
    <Popover.Trigger
      class={cn(
        "cursor-pointer rounded-sm text-sm hover:outline-1 hover:outline-offset-2 hover:outline-ring/50 focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ring",
        styles.length === 0 && "text-muted-foreground",
      )}
      aria-label="Climbing style"
    >
      {styles.map((s) => s.label).join(", ") || "Style"}
    </Popover.Trigger>
    <Popover.Content class="w-auto p-2">
      <div class="flex items-start gap-2">
        <div class="flex max-h-60 min-w-28 flex-col gap-0.5 overflow-y-auto pr-1" role="listbox" aria-label="Climbing styles">
          {#each STYLE_OPTIONS as [key, label] (key)}
            <Button
              variant={key === selected ? "secondary" : "ghost"}
              size="sm"
              class="w-full justify-between px-2 font-normal"
              role="option"
              aria-selected={key === selected}
              onclick={() => setStyle(key)}
            >
              {label}
              {#if key === selected}
                <span class="icon-[lucide--check] shrink-0 size-3.5 text-muted-foreground"></span>
              {/if}
            </Button>
          {/each}
        </div>

        {#if selected && selected !== "boulder"}
          <div class="flex min-w-36 flex-col gap-1.5 border-l pl-2">
            {#if !isMultipitch}
              <Button variant="outline" size="sm" class="w-full justify-start" onclick={() => setMultipitch(true)}>
                Set as multipitch
              </Button>
            {:else}
              <label class="flex flex-col gap-1 text-xs text-muted-foreground">
                Number of pitches
                <!-- svelte-ignore a11y_label_has_associated_control -->
                <Input
                  type="number"
                  min="1"
                  class="h-7 text-sm"
                  value={rawPitches}
                  placeholder="Pitches"
                  oninput={(event) => setPitches(event.currentTarget.value)}
                />
              </label>
              <Button
                variant="outline"
                size="sm"
                class="w-full justify-start"
                title="Remove the multipitch flag and pitch count"
                onclick={() => setMultipitch(false)}
              >
                Not a multipitch
              </Button>
            {/if}
          </div>
        {/if}
      </div>
    </Popover.Content>
  </Popover.Root>
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

