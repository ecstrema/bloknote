<script lang="ts">
  import type { RouteScaleId } from "@bloknote/holy-grade";
  import { getPreferredRouteGradingScale } from "#components/shell/providers/settings.svelte.js";
  import { getColorFromGrade } from "#lib/data/network/grade.js";

  const DEFAULT_ROUTE_GRADES: Record<RouteScaleId, string[]> = {
    French: ["4a", "5a", "6a", "7a", "8a", "9a"],
    YDS: ["5.6", "5.8", "5.10a", "5.11a", "5.12a", "5.13a", "5.14a"],
    UIAA: ["IV", "V", "VI", "VII", "VIII", "IX", "X"],
    Ewbank: ["14", "16", "19", "22", "26", "29", "33"],
    Saxon: ["V", "VI", "VIIa", "VIIIa", "IXa", "Xa", "XIa"],
    Scandinavian: ["4", "5", "6-", "7-", "8-", "9-", "10-"],
    Polish: ["IV", "V", "VI+", "VI.2", "VI.4", "VI.6", "VI.7"],
    UKTech: ["4a", "4c", "5b", "6a", "6c", "7a", "7b"],
  };

  let {
    onColorMode,
    onElementTypeVisibility,
  }: {
    /** Called when the user picks another route coloring on the map */
    onColorMode?: (mode: "grade" | "type" | "both") => void;
    /** Called when the user toggles which element types are shown on the map (issue #173) */
    onElementTypeVisibility?: (hiddenTypes: string[]) => void;
  } = $props();

  let open = $state(false);
  let colorMode = $state<"grade" | "type" | "both">("both");
  let hiddenTypes = $state<string[]>([]);

  $effect(() => {
    onColorMode?.(colorMode);
  });

  $effect(() => {
    onElementTypeVisibility?.(hiddenTypes);
  });

  const TYPE_SWATCHES = [
    { label: "Sport", fill: "bg-blue-500", border: "border-blue-500" },
    { label: "Boulder", fill: "bg-purple-500", border: "border-purple-500" },
    { label: "Trad", fill: "bg-amber-500", border: "border-amber-500" },
    { label: "Aid", fill: "bg-red-500", border: "border-red-500" },
    { label: "Ice", fill: "bg-cyan-500", border: "border-cyan-500" },
    { label: "Top rope", fill: "bg-pink-500", border: "border-pink-500" },
  ];

  /** Element types the user can hide from the map, with their legend labels */
  const VISIBILITY_TOGGLES = [
    { type: "route", label: "Routes" },
    { type: "area", label: "Areas / Crags" },
    { type: "sector", label: "Sectors" },
    { type: "cliff", label: "Cliffs" },
    { type: "gym", label: "Gyms" },
  ];

  function toggleElementType(type: string, visible: boolean) {
    if (visible) hiddenTypes = hiddenTypes.filter((t) => t !== type);
    else hiddenTypes = [...hiddenTypes, type];
  }

  const preferredScale = $derived.by(() => {
    try {
      const pref = getPreferredRouteGradingScale?.()?.current;
      if (pref && pref !== "local") return pref;
    } catch {}
    return "French" as RouteScaleId;
  });

  const gradeReferences = $derived(DEFAULT_ROUTE_GRADES[preferredScale] ?? DEFAULT_ROUTE_GRADES.French);
</script>

<div class="map-legend max-w-[260px]">
  {#if !open}
    <button
      type="button"
      class="flex h-[29px] cursor-pointer items-center gap-1.5 rounded-md border border-black/10 bg-white px-2 text-[13px] font-medium text-slate-800 shadow-[0_0_0_2px_rgba(0,0,0,0.1)] transition-colors hover:bg-slate-100"
      onclick={() => (open = true)}
      aria-label="Show map legend"
    >
      <span class="inline-block size-2.5 rounded-full bg-blue-500"></span>
      Legend
    </button>
  {:else}
    <div
      class="max-h-72 overflow-y-auto rounded-md border border-black/10 bg-white p-3 text-xs text-slate-800 shadow-[0_0_0_2px_rgba(0,0,0,0.1)]"
    >
      <div class="flex items-center justify-between border-b border-black/10 pb-2">
        <span class="text-xs font-semibold uppercase tracking-wider text-slate-500">Map Legend</span>
        <button
          type="button"
          class="cursor-pointer px-1 text-xs font-bold text-slate-500 hover:text-slate-800"
          onclick={() => (open = false)}
          aria-label="Close legend"
        >
          ✕
        </button>
      </div>

      <!-- Mode Selector -->
      <div class="mt-2 flex items-center justify-between gap-2 border-b border-black/10 pb-2">
        <label for="legend-mode" class="text-[11px] font-medium text-slate-500">Color by</label>
        <select
          id="legend-mode"
          bind:value={colorMode}
          class="cursor-pointer rounded border border-black/15 bg-white px-2 py-0.5 text-xs font-medium text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="both">Both</option>
          <option value="grade">Grade</option>
          <option value="type">Type</option>
        </select>
      </div>

      <!-- Grade -->
      {#if colorMode === "grade" || colorMode === "both"}
        <div class="mt-2.5">
          <div class="mb-1.5 flex items-center justify-between text-[11px] font-medium text-slate-500">
            <span>{colorMode === "both" ? "Grade (fill)" : "Grade"}</span>
            <span class="text-[10px] opacity-70">({preferredScale})</span>
          </div>
          <div class="grid grid-cols-2 gap-x-2 gap-y-1 text-[11px]">
            {#each gradeReferences as g (g)}
              <div class="flex items-center gap-1.5">
                <span
                  class="size-2.5 rounded-full border border-black/20"
                  style:background={getColorFromGrade(g, preferredScale, false)}
                ></span>
                <span>{g}</span>
              </div>
            {/each}
            <div class="col-span-2 flex items-center gap-1.5">
              <span class="size-2.5 rounded-full border border-black/20 bg-slate-400"></span>
              <span>Ungraded</span>
            </div>
          </div>
        </div>
      {/if}

      <!-- Type -->
      {#if colorMode === "type" || colorMode === "both"}
        <div class="mt-2.5 border-t border-black/10 pt-2">
          <div class="mb-1.5 text-[11px] font-medium text-slate-500">
            {colorMode === "both" ? "Type (stroke)" : "Type"}
          </div>
          <div class="grid grid-cols-2 gap-x-2 gap-y-1 text-[11px]">
            {#each TYPE_SWATCHES as swatch (swatch.label)}
              <div class="flex items-center gap-1.5">
                {#if colorMode === "both"}
                  <span class="size-2.5 rounded-full border-2 {swatch.border} bg-white"></span>
                {:else}
                  <span class="size-2.5 rounded-full {swatch.fill}"></span>
                {/if}
                <span>{swatch.label}</span>
              </div>
            {/each}
            <div class="col-span-2 flex items-center gap-1.5">
              {#if colorMode === "both"}
                <span class="size-2.5 rounded-full border-2 border-emerald-600 bg-white"></span>
              {:else}
                <span class="size-2.5 rounded-full bg-emerald-600"></span>
              {/if}
              <span>Gym</span>
            </div>
          </div>
        </div>
      {/if}

      <!-- Visibility filters -->
      <div class="mt-2.5 border-t border-black/10 pt-2">
        <div class="mb-1.5 text-[11px] font-medium text-slate-500">Show on map</div>
        <div class="grid grid-cols-2 gap-x-2 gap-y-1 text-[11px]">
          {#each VISIBILITY_TOGGLES as toggle (toggle.type)}
            <label class="flex cursor-pointer items-center gap-1.5">
              <input
                type="checkbox"
                class="size-3 accent-blue-500"
                checked={!hiddenTypes.includes(toggle.type)}
                onchange={(e) => toggleElementType(toggle.type, e.currentTarget.checked)}
              />
              <span class={hiddenTypes.includes(toggle.type) ? "text-slate-400 line-through" : ""}>{toggle.label}</span>
            </label>
          {/each}
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  /* The legend lives in the MapLibre control stack, which stays white in every color mode */
</style>

