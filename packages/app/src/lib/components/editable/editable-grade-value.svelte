<script lang="ts">
  import { getAppState } from "#lib/data/app-state.js";
  import type { WithSourceTag } from "#lib/data/parse/osm-tags.js";
  import type { Grade } from "#lib/types.js";
  import HolyGrade from "#components/grade/holy-grade.svelte";
  import Button from "#components/ui/button/button.svelte";
  import * as DropdownMenu from "#components/ui/dropdown-menu/index.ts";
  import { getScale } from "@climbhub/holy-grade";
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
  <DropdownMenu.Content class="max-h-[50vh] w-48 overflow-y-auto">
    <DropdownMenu.Label>
      Change Grade
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
    <DropdownMenu.Item
      class="text-destructive focus:text-destructive focus:bg-destructive/10 cursor-pointer flex items-center"
      onclick={deleteGrade}
    >
      <Trash2Icon class="mr-2 size-4" />
      Delete Grade
    </DropdownMenu.Item>
  </DropdownMenu.Content>
</DropdownMenu.Root>
