<script lang="ts">
  import type { OsmFeature } from "osm-api";
  import { ROUTE_STYLE_LABELS } from "@bloknote/osm-climbing";
  import * as Popover from "#components/ui/popover/index.js";
  import { Button } from "#components/ui/button/index.js";
  import TickButton from "#lib/components/tick-button.svelte";
  import type { MapElementFeature } from "#lib/data/db/types.js";
  import { cn } from "#lib/utils.js";

  let {
    properties,
    feature,
    onclose,
    class: className,
  }: {
    properties: MapElementFeature["properties"];
    /** Full OSM feature, for the description and the tick button */
    feature?: OsmFeature;
    onclose?: () => void;
    class?: string;
  } = $props();

  const FIELDS_KEY = "bloknote:map-info-box-fields";

  type InfoField = "name" | "grade" | "description" | "tick";
  const ALL_FIELDS: { key: InfoField; label: string }[] = [
    { key: "name", label: "Name" },
    { key: "grade", label: "Grade" },
    { key: "description", label: "Description" },
    { key: "tick", label: "Tick button" },
  ];
  const DEFAULT_FIELDS: InfoField[] = ["name", "grade", "description", "tick"];

  /** Fields shown in the box, toggled from the edit menu and persisted (issue #196) */
  let enabled = $state<InfoField[]>(DEFAULT_FIELDS);

  $effect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(FIELDS_KEY) ?? "") as InfoField[];
      if (Array.isArray(saved) && saved.length > 0) {
        enabled = saved.filter((f) => DEFAULT_FIELDS.includes(f));
      }
    } catch {
      // No saved setting: keep the defaults
    }
  });

  function toggle(key: InfoField) {
    const next = enabled.includes(key) ? enabled.filter((f) => f !== key) : [...enabled, key];
    if (next.length === 0) return; // never leave the box empty
    enabled = next;
    localStorage.setItem(FIELDS_KEY, JSON.stringify(next));
  }

  const shown = $derived((key: InfoField) => enabled.includes(key));

  const typeLabel = $derived(
    properties.elementType === "route"
      ? `${ROUTE_STYLE_LABELS[properties.routeStyle ?? "unknown"] ?? "Route"} route`
      : properties.elementType === "cliff"
        ? "Cliff"
        : properties.elementType === "sector"
          ? "Sector"
          : properties.elementType === "gym"
            ? "Gym"
            : "Area / Crag",
  );

  const description = $derived(feature?.tags?.description);
</script>

<div
  class={cn("w-64 resize-y overflow-auto rounded-md border bg-popover text-popover-foreground shadow-md", className)}
  style="resize: vertical;"
  role="complementary"
  aria-label="Selected element information"
>
  <div class="sticky top-0 flex items-center gap-1 bg-popover px-2 py-1">
    {#if shown("name")}
      <span class="min-w-0 flex-1 truncate text-xs font-semibold">{properties.name || "Unnamed"}</span>
    {:else}
      <span class="flex-1"></span>
    {/if}
    <Popover.Root>
      <Popover.Trigger>
        {#snippet child({ props })}
          <Button
            {...props}
            size="icon-sm"
            variant="ghost"
            title="Choose what the box shows"
            aria-label="Edit the box contents"
          >
            <span aria-hidden="true" class="icon-[lucide--sliders-horizontal] shrink-0 size-3.5"></span>
          </Button>
        {/snippet}
      </Popover.Trigger>
      <Popover.Content class="w-44" align="start">
        <div class="flex flex-col gap-1.5 text-xs">
          {#each ALL_FIELDS as field (field.key)}
            <label class="flex items-center gap-2">
              <input
                type="checkbox"
                class="accent-primary"
                checked={shown(field.key)}
                onchange={() => toggle(field.key)}
              />
              {field.label}
            </label>
          {/each}
        </div>
      </Popover.Content>
    </Popover.Root>
    <Button
      size="icon-sm"
      variant="ghost"
      title="Close"
      aria-label="Close the information box"
      onclick={() => onclose?.()}
    >
      <span aria-hidden="true" class="icon-[lucide--x] shrink-0 size-3.5"></span>
    </Button>
  </div>

  <div class="flex flex-col gap-1.5 px-2 pb-2 text-xs">
    <div class="flex flex-wrap items-center gap-1.5">
      <span class="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{typeLabel}</span>
      {#if shown("grade") && properties.grade}
        <span class="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium">{properties.grade}</span>
      {/if}
    </div>
    {#if shown("description") && description}
      <p class="line-clamp-6 whitespace-pre-line text-muted-foreground">{description}</p>
    {/if}
    {#if shown("tick") && feature}
      <div class="flex items-center gap-1.5 border-t pt-1.5">
        <TickButton {feature} />
      </div>
    {/if}
  </div>
</div>
