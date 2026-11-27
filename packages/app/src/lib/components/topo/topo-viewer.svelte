<script lang="ts">
  import HolyGrade from "#components/grade/holy-grade.svelte";
  import { Button } from "#components/ui/button/index.js";
  import * as Dialog from "#components/ui/dialog/index.js";
  import { Select } from "#components/ui/select/index.js";
  import { getAppState } from "#lib/data/app-state.js";
  import type { Key } from "osm-api";
  import {
    findMatchingImageTag,
    findNextImageTagKey,
    formatPath,
    parsePath,
    type CommonsImage,
    type ResolvedImage,
    type RouteOverlayPath,
    type RoutePoint,
    type TreeRouteInfo,
  } from "./topo-helpers.js";
  import TopoOverlay from "./topo-overlay.svelte";

  let {
    image = $bindable<CommonsImage | undefined>(undefined),
    imageData,
    ratio = $bindable<number | undefined>(undefined),
    featureSlug,
    featureName,
    canRemoveOwnImage = false,
    treeRoutes = [],
    overlayPaths = [],
  }: {
    image: CommonsImage | undefined;
    imageData: ResolvedImage | undefined;
    ratio?: number;
    featureSlug: string;
    featureName: string;
    canRemoveOwnImage?: boolean;
    treeRoutes: TreeRouteInfo[];
    overlayPaths: RouteOverlayPath[];
  } = $props();

  const appState = getAppState();

  let editingRouteSlug = $state<string>();
  let draftPoints = $state<RoutePoint[]>([]);
  let selectedPoint = $state<number>();
  let draggingPoint = $state<number>();
  let editError = $state("");

  const isOpen = $derived(Boolean(image));
  const editingRoute = $derived(treeRoutes.find((r) => r.slug === editingRouteSlug));

  function resetEditing() {
    editingRouteSlug = undefined;
    draftPoints = [];
    selectedPoint = undefined;
    draggingPoint = undefined;
    editError = "";
  }

  function startEditingRoute(routeSlug: string, initialPoint?: { x: number; y: number }) {
    if (!image || !appState.osmUser.loggedIn) return;
    const route = treeRoutes.find((r) => r.slug === routeSlug);
    if (!route) return;
    const match = findMatchingImageTag(route.feature.tags, image.title);
    const existing = match ? parsePath(route.feature.tags?.[match.pathKey]) : [];
    editingRouteSlug = routeSlug;
    draftPoints = initialPoint
      ? existing.length === 0
        ? [{ ...initialPoint, marker: "", dottedAfter: false }]
        : [...existing, { ...initialPoint, marker: "", dottedAfter: false }]
      : existing;
    selectedPoint = draftPoints.length > 0 ? draftPoints.length - 1 : undefined;
    editError = "";
  }

  function saveEdit() {
    if (!image || !editingRouteSlug) return;
    const route = treeRoutes.find((r) => r.slug === editingRouteSlug);
    if (!route) return;

    const value = formatPath(draftPoints);
    if (value.length > 255) {
      editError = "The path exceeds the 255-character OSM tag limit.";
      return;
    }

    const match = findMatchingImageTag(route.feature.tags, image.title);
    if (match) {
      appState.setTag(editingRouteSlug, match.pathKey as Key, value || undefined);
    } else if (value) {
      const nextKey = findNextImageTagKey(route.feature.tags);
      appState.setTag(editingRouteSlug, nextKey, image.title);
      appState.setTag(editingRouteSlug, `${nextKey}:path` as Key, value);
    }
    resetEditing();
  }

  function removeOwnImage() {
    if (!image || !canRemoveOwnImage) return;
    appState.deleteTag(featureSlug, image.key as Key);
    appState.deleteTag(featureSlug, image.pathKey as Key);
    image = undefined;
    resetEditing();
  }

  function eventPosition(clientX: number, clientY: number, target: HTMLElement) {
    const bounds = target.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (clientY - bounds.top) / bounds.height)),
    };
  }

  function startPointDrag(event: PointerEvent) {
    const target = event.currentTarget as HTMLButtonElement;
    const position = eventPosition(event.clientX, event.clientY, target);
    const hitRadius = event.pointerType === "touch" ? 0.055 : 0.035;
    let nearest = -1;
    let nearestDistance = hitRadius;
    for (let index = 0; index < draftPoints.length; index++) {
      const point = draftPoints[index]!;
      const distance = Math.hypot(point.x - position.x, point.y - position.y);
      if (distance < nearestDistance) {
        nearest = index;
        nearestDistance = distance;
      }
    }

    event.preventDefault();
    if (nearest >= 0) {
      selectedPoint = nearest;
      draggingPoint = nearest;
    } else {
      draftPoints = [...draftPoints, { ...position, marker: "", dottedAfter: false }];
      selectedPoint = draftPoints.length - 1;
      draggingPoint = selectedPoint;
    }
    target.setPointerCapture(event.pointerId);
  }

  function movePoint(event: PointerEvent) {
    if (draggingPoint === undefined) return;
    const position = eventPosition(event.clientX, event.clientY, event.currentTarget as HTMLButtonElement);
    draftPoints = draftPoints.map((point, index) => (index === draggingPoint ? { ...point, ...position } : point));
  }

  function finishPointDrag() {
    draggingPoint = undefined;
  }

  function handleImageDrop(event: DragEvent) {
    if (!appState.osmUser.loggedIn) return;
    event.preventDefault();
    const routeSlug = event.dataTransfer?.getData("text/plain");
    if (!routeSlug || !treeRoutes.some((r) => r.slug === routeSlug)) return;
    const pos = eventPosition(event.clientX, event.clientY, event.currentTarget as HTMLElement);
    startEditingRoute(routeSlug, pos);
  }

  function setSelectedMarker(event: Event) {
    if (selectedPoint === undefined) return;
    const marker = (event.currentTarget as HTMLSelectElement).value;
    draftPoints = draftPoints.map((point, index) => (index === selectedPoint ? { ...point, marker } : point));
  }

  function toggleSelectedDotted() {
    if (selectedPoint === undefined) return;
    draftPoints = draftPoints.map((point, index) =>
      index === selectedPoint ? { ...point, dottedAfter: !point.dottedAfter } : point,
    );
  }

  function removeSelectedPoint() {
    if (selectedPoint === undefined) return;
    draftPoints = draftPoints.filter((_, index) => index !== selectedPoint);
    selectedPoint = draftPoints.length > 0 ? Math.min(selectedPoint, draftPoints.length - 1) : undefined;
  }

  function undoLastPoint() {
    if (draftPoints.length === 0) return;
    draftPoints = draftPoints.slice(0, -1);
    selectedPoint = draftPoints.length > 0 ? draftPoints.length - 1 : undefined;
  }

  function stepPoint(delta: number) {
    if (draftPoints.length === 0) return;
    selectedPoint = selectedPoint === undefined ? 0 : (selectedPoint + delta + draftPoints.length) % draftPoints.length;
  }

  const displayedPaths = $derived.by((): RouteOverlayPath[] => {
    if (!ratio) return [];
    const base = overlayPaths.filter((p) => p.slug !== editingRouteSlug).map((p) => ({ ...p, active: false }));
    if (editingRouteSlug) {
      base.push({
        slug: editingRouteSlug,
        label: editingRoute?.name ?? "",
        points: draftPoints,
        active: true,
        selectedPoint,
      });
    }
    return base;
  });

  const isSelectedDotted = $derived(selectedPoint !== undefined && Boolean(draftPoints[selectedPoint]?.dottedAfter));
</script>

<Dialog.Root
  open={isOpen}
  onOpenChange={(next) => {
    if (!next) {
      image = undefined;
      resetEditing();
    }
  }}
>
  <Dialog.Content class="flex max-h-[92vh] w-[95vw] max-w-5xl flex-col gap-3 overflow-y-auto p-3 sm:max-w-5xl sm:p-4">
    <Dialog.Header>
      <Dialog.Title>{featureName || "Image"}</Dialog.Title>
    </Dialog.Header>

    {#if image && imageData}
      <div
        class="relative flex w-full items-center justify-center overflow-hidden rounded-md bg-muted/40"
        ondragover={(e) => {
          if (appState.osmUser.loggedIn) e.preventDefault();
        }}
        ondrop={handleImageDrop}
        role="region"
        aria-label="Expanded image"
      >
        <div
          class="relative w-full"
          style:aspect-ratio={ratio}
          style:max-width={ratio ? `calc(65vh * ${ratio})` : undefined}
        >
          <img
            src={imageData.src}
            alt={featureName}
            class="block h-full w-full select-none"
            onload={(event) => {
              const { naturalWidth, naturalHeight } = event.currentTarget as HTMLImageElement;
              if (naturalWidth && naturalHeight) ratio = naturalWidth / naturalHeight;
            }}
          />
          {#if ratio}
            <TopoOverlay {ratio} paths={displayedPaths} />
          {/if}
          {#if editingRouteSlug && ratio}
            <button
              type="button"
              class="absolute inset-0 h-full w-full cursor-crosshair touch-none bg-transparent p-0"
              aria-label="Tap or drag to add or move route points"
              onpointerdown={startPointDrag}
              onpointermove={movePoint}
              onpointerup={finishPointDrag}
              onpointercancel={finishPointDrag}
            ></button>
          {/if}
        </div>
      </div>

      {#if appState.osmUser.loggedIn && editingRouteSlug}
        <div class="flex flex-wrap items-center gap-1.5 rounded-md border bg-muted/30 p-2">
          <Button size="sm" onclick={saveEdit}
            ><span class="icon-[lucide--check] shrink-0 size-4"></span> Save path</Button
          >
          <Button size="sm" variant="outline" onclick={undoLastPoint} disabled={draftPoints.length === 0}>
            <span class="icon-[lucide--undo-2] shrink-0 size-4"></span> Undo
          </Button>
          <Button
            size="icon-sm"
            variant="outline"
            title="Previous point"
            onclick={() => stepPoint(-1)}
            disabled={draftPoints.length < 2}
          >
            <span class="icon-[lucide--chevron-left] shrink-0 size-4"></span>
          </Button>
          <Button
            size="icon-sm"
            variant="outline"
            title="Next point"
            onclick={() => stepPoint(1)}
            disabled={draftPoints.length < 2}
          >
            <span class="icon-[lucide--chevron-right] shrink-0 size-4"></span>
          </Button>
          <Button size="sm" variant="outline" onclick={removeSelectedPoint} disabled={selectedPoint === undefined}>
            <span class="icon-[lucide--trash-2] shrink-0 size-4"></span> Remove point
          </Button>
          <Select
            class="h-8 w-auto px-2 text-xs"
            value={selectedPoint === undefined ? "" : draftPoints[selectedPoint]?.marker}
            onchange={setSelectedMarker}
            disabled={selectedPoint === undefined}
            aria-label="Point marker"
          >
            <option value="">No marker</option>
            <option value="B">Bolt / ring</option>
            <option value="A">Anchor</option>
            <option value="P">Piton</option>
            <option value="S">Fixed sling</option>
            <option value="U">Unfinished</option>
          </Select>
          <Button
            size="sm"
            variant={isSelectedDotted ? "secondary" : "outline"}
            disabled={selectedPoint === undefined || selectedPoint === draftPoints.length - 1}
            onclick={toggleSelectedDotted}
          >
            Dotted
          </Button>
          <Button size="icon-sm" variant="ghost" title="Cancel" onclick={resetEditing}
            ><span class="icon-[lucide--x] shrink-0 size-4"></span></Button
          >
        </div>
        {#if editError}
          <p class="text-sm text-destructive">{editError}</p>
        {/if}
      {:else if appState.osmUser.loggedIn}
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div>
            {#if treeRoutes.some((r) => r.slug === featureSlug)}
              <Button size="sm" variant="outline" onclick={() => startEditingRoute(featureSlug)}>
                <span class="icon-[lucide--pencil] shrink-0 size-4"></span> Edit path
              </Button>
            {/if}
          </div>
          {#if canRemoveOwnImage}
            <Button size="sm" variant="ghost" class="text-destructive hover:text-destructive" onclick={removeOwnImage}>
              <span class="icon-[lucide--trash-2] shrink-0 size-4"></span> Remove image
            </Button>
          {/if}
        </div>
      {/if}
      {#if appState.osmUser.loggedIn && treeRoutes.length > 0}
        <div class="flex flex-col gap-1.5 border-t pt-2">
          <p class="text-xs text-muted-foreground">
            {editingRouteSlug
              ? `Drawing: ${editingRoute?.name}. Tap on the image to add points, drag points to adjust.`
              : "Drag a route onto the image to place its start, or tap a route to draw its path:"}
          </p>
          <div class="flex flex-wrap gap-1.5">
            {#each treeRoutes as route (route.slug)}
              {@const isEditing = editingRouteSlug === route.slug}
              {@const hasPath = overlayPaths.some((p) => p.slug === route.slug && p.points.length > 0)}
              <Button
                size="xs"
                variant={isEditing ? "default" : hasPath ? "secondary" : "outline"}
                draggable={true}
                ondragstart={(e) => {
                  e.dataTransfer?.setData("text/plain", route.slug);
                }}
                onclick={() => startEditingRoute(route.slug)}
              >
                <span>{route.name}</span>
                {#if route.grade}
                  <HolyGrade grade={route.grade} class="text-xs font-semibold" />
                {/if}
              </Button>
            {/each}
          </div>
        </div>
      {/if}
    {:else}
      <p class="text-sm text-muted-foreground">Loading image…</p>
    {/if}
  </Dialog.Content>
</Dialog.Root>
