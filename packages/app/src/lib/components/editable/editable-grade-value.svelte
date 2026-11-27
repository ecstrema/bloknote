<script lang="ts">
  import { getAppState } from "#lib/data/app-state.js";
  import { gradingScales } from "#lib/data/grading-scales.svelte.js";
  import { getRelatedGradeScales, scaleIdToTag, type WithSourceTag } from "#lib/data/parse/osm-tags.js";
  import { getDefaultGradingScales } from "#lib/data/parse/region-grading.js";
  import type { Grade } from "#lib/types.js";
  import HolyGrade from "#components/grade/holy-grade.svelte";
  import { Button } from "#components/ui/button/index.js";
  import * as Popover from "#components/ui/popover/index.js";
  import { convertGrade, getGradeFromReference, getScale, type ScaleId } from "@bloknote/holy-grade";
  import type { OsmFeature } from "osm-api";

  const {
    grade,
    feature,
    featureSlug,
    gradedProject = false,
  }: {
    grade: WithSourceTag<Grade> | undefined;
    feature: OsmFeature;
    featureSlug: string;
    gradedProject?: boolean;
  } = $props();

  const appState = getAppState();

  let open = $state(false);
  let choosingScale = $state(false);
  let draftScaleId = $state<ScaleId>();

  const tags = $derived(feature.tags || {});
  const relatedScales = $derived(getRelatedGradeScales(tags, grade?.v.scale));
  const regionDefaults = $derived(getDefaultGradingScales(featureSlug));

  const defaultScaleId = $derived.by((): ScaleId => {
    const first = relatedScales[0];
    if (first?.gradeType === "boulder") {
      return (gradingScales.preferred("boulder") as ScaleId) ?? regionDefaults.boulder;
    }
    if (first?.gradeType === "route") {
      return (gradingScales.preferred("route") as ScaleId) ?? regionDefaults.route;
    }
    return first?.id ?? regionDefaults.route;
  });

  const activeScaleId = $derived(
    grade && grade.v.scale !== "unknown" ? grade.v.scale : (draftScaleId ?? defaultScaleId),
  );
  const activeScale = $derived(getScale(activeScaleId) ?? relatedScales[0]!);
  const gradeTagKey = $derived(grade?.source || scaleIdToTag(activeScale.id) || "climbing:grade:yds_class");
  const currentGradeValue = $derived(grade ? (tags[gradeTagKey] ?? grade.v.v) : undefined);

  function selectGrade(value: string) {
    appState.setTag(featureSlug, gradeTagKey, value);
  }

  function changeGradingScale(targetScaleId: ScaleId) {
    choosingScale = false;
    draftScaleId = targetScaleId;
    if (!grade) return;

    const scaleToConvertTo = getScale(targetScaleId);
    const newGradeKey = scaleIdToTag(targetScaleId);
    if (!scaleToConvertTo || !newGradeKey) return;

    const newGrade =
      grade.v.scale === "unknown"
        ? getGradeFromReference(50, scaleToConvertTo)
        : convertGrade(grade.v.v, grade.v.scale, scaleToConvertTo);
    if (!newGrade) return;

    appState.deleteTag(featureSlug, grade.source);
    appState.setTag(featureSlug, newGradeKey, newGrade);
  }

  function deleteGrade() {
    if (!grade) return;
    appState.deleteTag(featureSlug, grade.source);
    if (grade.source !== "climbing:grade" && tags["climbing:grade"]) {
      appState.deleteTag(featureSlug, "climbing:grade");
    }
    open = false;
  }

  function scrollIfSelected(node: HTMLElement, isSelected: boolean) {
    if (isSelected) requestAnimationFrame(() => node.scrollIntoView({ block: "center" }));
    return {
      update(selected: boolean) {
        if (selected) requestAnimationFrame(() => node.scrollIntoView({ block: "center" }));
      },
    };
  }
</script>

<Popover.Root
  bind:open
  onOpenChange={(isOpen) => {
    if (!isOpen) choosingScale = false;
  }}
>
  <Popover.Trigger disabled={!appState.osmUser.loggedIn}>
    {#snippet child({ props })}
      {#if grade}
        <div class="group/gradewarning relative inline-flex">
          <Button {...props} variant="ghost" class={gradedProject ? "opacity-70 grayscale" : undefined}>
            <HolyGrade class="font-semibold text-sm" grade={grade.v} />
          </Button>
          {#if gradedProject}
            <div
              class="pointer-events-none absolute top-full left-0 z-50 mt-1 hidden w-72 rounded-md border bg-popover p-3 text-popover-foreground shadow-md group-hover/gradewarning:pointer-events-auto group-hover/gradewarning:block"
            >
              <p class="text-sm">
                This route is named as a project but has a grade assigned ({grade.v.v}). Projects are typically
                unclimbed and ungraded.
              </p>
              <Button size="sm" variant="outline" class="mt-2" onclick={deleteGrade}>Remove grade</Button>
            </div>
          {/if}
        </div>
      {:else}
        <Button {...props} class="text-muted-foreground" variant="outline">Add Grade</Button>
      {/if}
    {/snippet}
  </Popover.Trigger>

  <Popover.Content class="w-auto p-2">
    <div class="flex items-start gap-2">
      <div class="flex max-h-60 min-w-28 flex-col gap-0.5 overflow-y-auto pr-1" role="listbox" aria-label="Grades">
        {#each activeScale.gradeMapping.keys() as name (name)}
          {@const selected = currentGradeValue === name}
          <Button
            variant={selected ? "secondary" : "ghost"}
            size="sm"
            class="w-full justify-between px-2 font-normal"
            role="option"
            aria-selected={selected}
            onclick={() => selectGrade(name)}
          >
            <span use:scrollIfSelected={selected}>
              <HolyGrade grade={{ v: name, scale: activeScale.id }} convert={true} />
            </span>
            {#if selected}
              <span class="icon-[lucide--check] shrink-0 size-3.5 text-muted-foreground"></span>
            {/if}
          </Button>
        {/each}
      </div>

      <div class="flex min-w-36 flex-col gap-1.5 border-l pl-2">
        <Button
          variant="outline"
          size="sm"
          class="w-full justify-between gap-2"
          aria-expanded={choosingScale}
          onclick={() => (choosingScale = !choosingScale)}
        >
          <span>{activeScale.id}</span>
          <span class="icon-[lucide--chevrons-up-down] shrink-0 size-3.5 text-muted-foreground"></span>
        </Button>

        {#if choosingScale}
          <div
            class="flex max-h-40 flex-col gap-0.5 overflow-y-auto rounded-md border p-1"
            role="listbox"
            aria-label="Grading systems"
          >
            {#each relatedScales as s (s.id)}
              <Button
                variant={s.id === activeScale.id ? "secondary" : "ghost"}
                size="xs"
                class="w-full justify-start"
                onclick={() => changeGradingScale(s.id)}
              >
                {s.id}
              </Button>
            {/each}
          </div>
        {/if}

        <Button
          variant="outline"
          size="sm"
          class="w-full justify-start gap-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
          disabled={!grade}
          onclick={deleteGrade}
        >
          <span class="icon-[lucide--trash-2] shrink-0 size-3.5"></span>
          <span>Delete</span>
        </Button>
      </div>
    </div>
  </Popover.Content>
</Popover.Root>
