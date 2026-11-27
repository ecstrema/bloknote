<script lang="ts">
  import * as Breadcrumb from "#components/ui/breadcrumb/index.js";
  import * as DropdownMenu from "#components/ui/dropdown-menu/index.js";
  import { Button } from "#components/ui/button/index.js";
  import { getSidebarChildren } from "#components/shell/sidebar/utils.js";
  import { featureToType } from "#lib/data/parse/data.js";
  import { getLocalizedName } from "#lib/data/parse/localized-name.js";
  import { resolve } from "$app/paths";
  import type { BreadcrumbSegment } from "#lib/types.js";
  import { onMount, settled } from "svelte";
  import { getAppState } from "#lib/data/app-state.js";
  import { searchState } from "#lib/components/shell/sidebar/search-state.svelte.js";

  const appState = getAppState();
  const breadcrumbs = $derived.by(() => appState.breadcrumbs.items);

  $effect(() => {
    if (breadcrumbs.length > 0) {
      recomputeHiddenCount();
    }
  });

  let rootElement: HTMLElement | null = $state(null);
  let hidden = $state(0);

  async function recomputeHiddenCount() {
    if (!rootElement) return;
    hidden = 0;
    await settled();
    await computeHiddenCount();
  }

  async function computeHiddenCount() {
    if (!rootElement) return;

    const domRect = rootElement.getBoundingClientRect();
    if (domRect.height > 32 && hidden < 32) {
      hidden++;
      await settled();
      await computeHiddenCount();
    }
  }

  onMount(() => {
    if (!rootElement) return;

    let previousWidth = 0;
    const ro = new ResizeObserver((entry) => {
      const w = entry[0]?.contentRect.width;
      if (!w) return;

      const widthChanged = w !== previousWidth;
      previousWidth = w;
      if (widthChanged) {
        ro.unobserve(rootElement!);
        recomputeHiddenCount();
        ro.observe(rootElement!);
      }
    });
    ro.observe(rootElement);

    return () => ro.disconnect();
  });

  const shownBreadcrumbSegments = $derived.by(() => {
    return breadcrumbs.slice(hidden);
  });

  function getOrderedChildren(parentSlug: string) {
    const node = appState.tree.getReactiveNode(parentSlug);
    if (!node) return [];
    const sorted = getSidebarChildren(node, parentSlug);
    if (!sorted) return [];
    const slugs = [...sorted.geographic, ...sorted.area, ...sorted.gym, ...sorted.route, ...sorted.other];
    return slugs
      .map((childSlug) => {
        const child = node.children?.[childSlug];
        return child ? { slug: childSlug, name: getLocalizedName(child.feature) || "No name" } : undefined;
      })
      .filter((entry): entry is { slug: string; name: string } => !!entry);
  }

  function isFolderSegment(segment: BreadcrumbSegment): boolean {
    const feature = segment.data?.feature;
    if (!feature) return false;
    const type = featureToType(feature);
    return type === "geographic" || type === "area";
  }
</script>

{#if breadcrumbs.length > 0}
  <Breadcrumb.Root bind:ref={rootElement} class="w-full">
    {const lastElement = $derived(breadcrumbs.at(-1)!)}
    <Breadcrumb.List>
      <!-- display only the last breadcrumb with an ellipsis for parents -->
      {const ellipsisItems = $derived(breadcrumbs.slice(0, hidden))}
      {#if ellipsisItems.length > 0}
        <Breadcrumb.Item>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger>
              {#snippet child({ props })}
                <Button
                  {...props}
                  variant="ghost"
                  size="icon-sm"
                  class="focus-visible:ring-0 focus-visible:border-transparent"
                  aria-label="Show hidden breadcrumbs"
                >
                  <Breadcrumb.Ellipsis />
                </Button>
              {/snippet}
            </DropdownMenu.Trigger>
            <DropdownMenu.Content>
              <DropdownMenu.Group>
                {#each ellipsisItems as breadcrumb (breadcrumb.slug)}
                  <DropdownMenu.Item>
                    <a href={resolve("/world/[...slug]", { slug: breadcrumb.slug })} class="size-full">
                      {breadcrumb.data ? getLocalizedName(breadcrumb.data.feature) : ""}
                    </a>
                  </DropdownMenu.Item>
                {/each}
              </DropdownMenu.Group>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        </Breadcrumb.Item>
        <Breadcrumb.Separator />
      {/if}

      {#each shownBreadcrumbSegments as breadcrumb, index (breadcrumb.slug)}
        {@render breadcrumbFromDataJSON(breadcrumb, lastElement, shownBreadcrumbSegments[index + 1]?.slug)}
      {/each}

      {#if searchState.active}
        <!-- Very visible indicator that a search filters the content, one click to remove it (issue #166) -->
        <Breadcrumb.Item>
          <Button
            size="xs"
            variant="secondary"
            onclick={() => searchState.clear()}
            aria-label="Clear the active search"
          >
            <span class="icon-[lucide--search] shrink-0 size-3.5"></span>
            <span class="max-w-40 truncate">{searchState.filters.text.trim() || "Filters"}</span>
            <span class="icon-[lucide--x] shrink-0 size-3.5"></span>
          </Button>
        </Breadcrumb.Item>
      {/if}
    </Breadcrumb.List>
  </Breadcrumb.Root>
{/if}

{#snippet breadcrumbFromDataJSON(
  breadcrumb: BreadcrumbSegment,
  lastElement: BreadcrumbSegment,
  nextSlug: string | undefined,
)}
  {const name = $derived(breadcrumb.data ? getLocalizedName(breadcrumb.data.feature) : "")}
  {const showArrow = $derived(breadcrumb !== lastElement || isFolderSegment(breadcrumb))}

  <Breadcrumb.Item>
    {#if breadcrumb === lastElement}
      <Breadcrumb.Page>{name}</Breadcrumb.Page>
    {:else}
      <Breadcrumb.Link
        href={resolve("/world/[...slug]", {
          slug: breadcrumb.slug,
        })}
      >
        {name}
      </Breadcrumb.Link>
    {/if}
  </Breadcrumb.Item>
  {#if showArrow}
    <Breadcrumb.Separator>
      <DropdownMenu.Root
        onOpenChange={(open) => {
          if (open) void appState.fetchChildren(breadcrumb.slug);
        }}
      >
        <DropdownMenu.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              variant="ghost"
              size="icon-xs"
              class="focus-visible:ring-0 focus-visible:border-transparent"
              aria-label="Select child of {name || 'folder'}"
            >
              <span class="icon-[lucide--chevron-right] shrink-0 size-4"></span>
            </Button>
          {/snippet}
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="start" class="max-h-72 overflow-y-auto">
          {#each getOrderedChildren(breadcrumb.slug) as child (child.slug)}
            <DropdownMenu.Item class={child.slug === nextSlug ? "bg-accent font-medium" : undefined}>
              <a href={resolve("/world/[...slug]", { slug: child.slug })} class="size-full truncate">
                {child.name}
              </a>
            </DropdownMenu.Item>
          {:else}
            <DropdownMenu.Item disabled>No items</DropdownMenu.Item>
          {/each}
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </Breadcrumb.Separator>
  {/if}
{/snippet}
