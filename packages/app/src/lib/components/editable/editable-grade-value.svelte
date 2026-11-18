<script lang="ts">
  import { getAppState } from "#lib/data/app-state.js";
  import { type WithSourceTag, scaleIdToTag } from "#lib/data/parse/osm-tags.js";
  import type { Grade } from "#lib/types.js";
  import HolyGrade from "#components/grade/holy-grade.svelte";
  import Button from "#components/ui/button/button.svelte";
  import * as DropdownMenu from "#components/ui/dropdown-menu/index.ts";
  import { allRouteScales, convertGrade, getGradeFromReference, getScale, type ScaleId } from "@bloknote/holy-grade";
  import type { OsmFeature } from "osm-api";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";

  const {
    grade,
    feature,
    featureSlug,
  }: {
    grade: WithSourceTag<Grade>;
    feature: OsmFeature;
    featureSlug: string;
  } = $props();

  const appState = getAppState();

  const scale = $derived.by(() => {
    if (!grade || grade.v.scale === "unknown") return;

    return getScale(grade.v.scale);
  });

  const tags = $derived(feature.tags || {});

  const gradeTagKey = $derived(grade.source || "climbing:grade:yds_class");

  function changeGradingScale(targetScaleId: string) {
    const scaleToConvertTo = getScale(targetScaleId as ScaleId);
    if (!scaleToConvertTo) return;

    const newGradeKey = scaleIdToTag(targetScaleId as ScaleId);
    if (!newGradeKey) return;

    if (grade.v.scale === "unknown") {
      appState.deleteTag(featureSlug, grade.source);
      appState.setTag(featureSlug, newGradeKey, getGradeFromReference(50, scaleToConvertTo));
      return;
    }

    const currentScale = getScale(grade.v.scale);
    if (!currentScale) return;

    const newGrade = convertGrade(grade.v.v, currentScale, scaleToConvertTo);
    if (!newGrade) return;

    appState.deleteTag(featureSlug, grade.source);
    appState.setTag(featureSlug, newGradeKey, newGrade);
  }

  function deleteGrade() {
    appState.deleteTag(featureSlug, grade.source);
    if (grade.source !== "climbing:grade" && tags["climbing:grade"]) {
      appState.deleteTag(featureSlug, "climbing:grade");
    }
  }

  function scrollIfSelected(node: HTMLElement, isSelected: boolean) {
    if (isSelected) {
      requestAnimationFrame(() => {
        node.scrollIntoView({ block: "center" });
      });
    }
    return {
      update(selected: boolean) {
        if (selected) {
          requestAnimationFrame(() => {
            node.scrollIntoView({ block: "center" });
          });
        }
      },
    };
  }
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger disabled={!appState.osmUser.loggedIn}>
    {#snippet child({ props })}
      <Button {...props} variant="ghost">
        <HolyGrade class="font-semibold text-sm" grade={grade?.v} />
      </Button>
    {/snippet}
  </DropdownMenu.Trigger>
  <DropdownMenu.Content class="max-h-[50vh] w-56 overflow-y-auto">
    <DropdownMenu.Label class="text-xs text-muted-foreground">
      Select Grade ({grade.v.scale || "Unknown"})
    </DropdownMenu.Label>
    <DropdownMenu.RadioGroup bind:value={() => tags[gradeTagKey], (v) => appState.setTag(featureSlug, gradeTagKey, v)}>
      {#each scale?.gradeMapping.keys() as name (name)}
        <DropdownMenu.RadioItem value={name} class="whitespace-nowrap">
          {#snippet children({ checked })}
            <span class="w-full" use:scrollIfSelected={checked}>
              <HolyGrade grade={{ v: name, scale: scale?.id || "YDS" }} convert={true} />
            </span>
          {/snippet}
        </DropdownMenu.RadioItem>
      {/each}
    </DropdownMenu.RadioGroup>

    <DropdownMenu.Separator />

    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger class="cursor-pointer">
        <span>Change scale ({grade.v.scale || "None"})</span>
      </DropdownMenu.SubTrigger>
      <DropdownMenu.SubContent class="max-h-[50vh] w-48 overflow-y-auto">
        <DropdownMenu.RadioGroup onValueChange={changeGradingScale} value={grade.v.scale}>
          <DropdownMenu.GroupHeading>Grading Scale</DropdownMenu.GroupHeading>
          {#each allRouteScales as s (s.id)}
            <DropdownMenu.RadioItem value={s.id} class="whitespace-nowrap">
              {s.id}
            </DropdownMenu.RadioItem>
          {/each}
        </DropdownMenu.RadioGroup>
      </DropdownMenu.SubContent>
    </DropdownMenu.Sub>

    <DropdownMenu.Separator />

    <DropdownMenu.Item
      class="text-destructive focus:text-destructive focus:bg-destructive/10 cursor-pointer flex items-center"
      onclick={deleteGrade}
    >
      <Trash2Icon class="mr-2 size-4" />
      Delete Grade
    </DropdownMenu.Item>
  </DropdownMenu.Content>
</DropdownMenu.Root>
