import { createContext } from "svelte";
import type { AppDataTree } from "./app-data-tree.svelte";
import { dataClient } from "./network/data-client";
import type { BreadcrumbSegment, DataTree } from "#lib/types.js";
import type { FromCurrent } from "#components/shell/providers/types.js";
import { UndoManager } from "./undo/undo-stack";
import {
  UndoableAreaCreate,
  UndoableFeatureSet,
  UndoableGroup,
  UndoableMove,
  UndoableNodeDelete,
  UndoablePromoteAreaToRelation,
  UndoableRelationMembersSet,
  UndoableReparentNode,
  UndoableRouteCreate,
  UndoableTagChange,
  UndoableTagDelete,
} from "./undo/actions";
import { getParentSlug } from "#lib/helpers/slug.js";
import { convertGrade, getScale, type ScaleId } from "@bloknote/holy-grade";
import { getGrade, scaleIdToTag } from "./parse/osm-tags.js";
import { OsmUser } from "./network/osm.svelte";
import type { Coordinates } from "@bloknote/climbing-data-gen";
import type { Key, OsmFeature, OsmRelation } from "osm-api";
import { getStaticIdentifier, type BasicOsmType } from "@bloknote/common";
import { featureToType } from "./parse/data.js";

export interface Breadcrumbs {
  slugs: string[];
  items: BreadcrumbSegment[];
}

export class AppState {
  tree: AppDataTree;
  breadcrumbs: Breadcrumbs;
  currentNode: FromCurrent<DataTree>;

  osmUser = new OsmUser();

  undoStack = new UndoManager();

  constructor(tree: AppDataTree, breadcrumbs: Breadcrumbs, currentNode: FromCurrent<DataTree>) {
    this.tree = tree;
    this.breadcrumbs = breadcrumbs;
    this.currentNode = currentNode;
  }

  async fetchStats(targetSlug: string): Promise<void> {
    const node = this.tree.getReactiveNode(targetSlug);
    if (node) {
      if (node.stats) return;

      const stats = await dataClient.getStats(targetSlug);
      if (stats) node.stats = stats;
    }
  }

  #childrenInFlight = new Map<string, Promise<void>>();

  fetchChildren(targetSlug: string): Promise<void> {
    const node = this.tree.getReactiveNode(targetSlug);
    // Abort if children are already marked as fetched
    if (!node || node.childrenFetched) return Promise.resolve();

    let pending = this.#childrenInFlight.get(targetSlug);
    if (!pending) {
      pending = this.#fetchChildren(targetSlug).finally(() => this.#childrenInFlight.delete(targetSlug));
      this.#childrenInFlight.set(targetSlug, pending);
    }
    return pending;
  }

  async #fetchChildren(targetSlug: string): Promise<void> {
    const node = this.tree.getReactiveNode(targetSlug);
    if (!node || node.childrenFetched) return;

    const childrenData = await dataClient.getChildren(targetSlug);
    if (!childrenData) return;

    node.children ??= {};
    for (const [childSlug, data] of Object.entries(childrenData)) {
      if (!node.children[childSlug]) {
        const reactiveChild = this.tree.getReactiveNode(childSlug);
        // If the node was partially loaded (only some children, not all), then the child might already be present in the parent.
        // We then don't need to create a new child, we reuse the existing one.
        // In the other case, we create it and add it to node.children. When we get it back from node.children, it is reactive.
        if (reactiveChild) {
          node.children[childSlug] = reactiveChild;
        } else {
          node.children[childSlug] = { feature: data };
          this.tree.setReactiveNode(childSlug, node.children[childSlug]);
        }
      }
    }

    node.childrenFetched = true;
  }

  /**
   * Applies {@link UndoableTagChange}
   *
   * Set the value to `undefined` to remove the tag, or use {@link deleteTag}
   */
  setTag(targetSlug: string, tagKey: Key, newValue: string | undefined) {
    const node = this.tree.getReactiveNode(targetSlug);
    const feature = node?.feature;
    if (!feature || feature.type === "geographic") return;

    this.undoStack.do(new UndoableTagChange(this.osmUser, feature, targetSlug, tagKey, newValue));
  }

  /** Applies {@link UndoableMove}. Only nodes can be moved. */
  setCoordinates(targetSlug: string, position: { lat: number; lon: number }) {
    const node = this.tree.getReactiveNode(targetSlug);
    const feature = node?.feature;
    if (!feature || feature.type !== "node") return;

    this.undoStack.do(new UndoableMove(this.osmUser, feature, targetSlug, position));
  }

  /** Applies {@link UndoableTagDelete} to remove the tag completely */
  deleteTag(targetSlug: string, tagKey: Key) {
    const node = this.tree.getReactiveNode(targetSlug);
    const feature = node?.feature;
    if (!feature || feature.type === "geographic") return;

    this.undoStack.do(new UndoableTagDelete(this.osmUser, feature, targetSlug, tagKey));
  }

  /** Applies a multi-tag set/remove patch as a single undoable step. */
  applyTagPatch(targetSlug: string, patch: { set?: Partial<Record<Key, string>>; remove?: Key[] }) {
    const node = this.tree.getReactiveNode(targetSlug);
    const feature = node?.feature;
    if (!feature || feature.type === "geographic") return;

    this.undoStack.beginGroup();
    for (const [k, v] of Object.entries(patch.set ?? {})) {
      if (v !== undefined) this.setTag(targetSlug, k as Key, v);
    }
    for (const k of patch.remove ?? []) {
      this.deleteTag(targetSlug, k);
    }
    this.undoStack.endGroup();
  }

  /**
   * Applies {@link UndoableRouteCreate} to create a new route in the parent feature.
   */
  createRoute(parent: DataTree, parentSlug: string, coordinates?: Coordinates, name?: string) {
    const action = new UndoableRouteCreate(this.osmUser, this.tree, parent, parentSlug, coordinates, name);
    this.undoStack.do(action);
    return action.slug;
  }

  /** Applies {@link UndoableAreaCreate} to create a new area in the parent feature. */
  createArea(parent: DataTree, parentSlug: string, name?: string) {
    const action = new UndoableAreaCreate(this.osmUser, this.tree, parent, parentSlug, name);
    this.undoStack.do(action);
    return action.slug;
  }

  #buildPromoteAreaAction(parent: DataTree, parentSlug: string): UndoablePromoteAreaToRelation | undefined {
    if (parent.feature.type === "geographic" || parent.feature.type === "relation") return undefined;
    const grandParentSlug = getParentSlug(parentSlug);
    const grandParent = grandParentSlug !== undefined ? this.tree.getReactiveNode(grandParentSlug) : undefined;
    return new UndoablePromoteAreaToRelation(
      this.osmUser,
      parent as DataTree<OsmFeature>,
      parentSlug,
      grandParent,
      grandParentSlug,
    );
  }

  /** Moves an OSM node/area/gym to a different parent (geographic region or area relation). */
  reparentNode(itemSlug: string, newParentSlug: string): string | undefined {
    const oldParentSlug = getParentSlug(itemSlug);
    if (oldParentSlug === undefined || oldParentSlug === newParentSlug) return itemSlug;
    if (newParentSlug === itemSlug || newParentSlug.startsWith(`${itemSlug}/`)) return undefined;

    const node = this.tree.getReactiveNode(itemSlug);
    const oldParent = this.tree.getReactiveNode(oldParentSlug);
    const newParent = this.tree.getReactiveNode(newParentSlug);
    if (!node || !oldParent || !newParent || node.feature.type === "geographic") return undefined;

    const promote = this.#buildPromoteAreaAction(newParent, newParentSlug);
    const reparent = new UndoableReparentNode(
      this.osmUser,
      this.tree,
      node as DataTree<OsmFeature>,
      itemSlug,
      oldParent,
      oldParentSlug,
      newParent,
      newParentSlug,
    );
    this.undoStack.do(promote ? new UndoableGroup([promote, reparent]) : reparent);
    return reparent.newSlug;
  }

  /**
   * Creates a new sector under the common parent (or `targetParentSlug`) and moves all selected
   * OSM items into it as a single undoable operation.
   */
  createSectorWithItems(itemSlugs: string[], name?: string, targetParentSlug?: string): string | undefined {
    const topSlugs = itemSlugs
      .filter((slug) => {
        const node = this.tree.getReactiveNode(slug);
        if (!node || node.feature.type === "geographic") return false;
        return !itemSlugs.some((other) => other !== slug && slug.startsWith(`${other}/`));
      });
    if (topSlugs.length === 0) return undefined;

    const parentSlug = targetParentSlug ?? commonParentSlug(topSlugs);
    if (parentSlug === undefined) return undefined;
    const parent = this.tree.getReactiveNode(parentSlug);
    if (!parent) return undefined;

    this.undoStack.beginGroup();
    const sectorSlug = this.createArea(parent, parentSlug, name?.trim() || undefined);
    const sectorNode = this.tree.getReactiveNode(sectorSlug);
    if (sectorNode) {
      for (const slug of topSlugs) {
        this.reparentNode(slug, sectorSlug);
      }
    }
    this.undoStack.endGroup();
    return sectorSlug;
  }

  #filterTopLevelOsmSlugs(itemSlugs: string[]): string[] {
    return itemSlugs.filter((slug) => {
      const node = this.tree.getReactiveNode(slug);
      if (!node || node.feature.type === "geographic") return false;
      return !itemSlugs.some((other) => other !== slug && slug.startsWith(`${other}/`));
    });
  }

  /** Moves multiple selected OSM items into an existing target parent (geographic region or area). */
  moveItemsToParent(itemSlugs: string[], targetParentSlug: string): string[] {
    const topSlugs = this.#filterTopLevelOsmSlugs(itemSlugs);
    if (topSlugs.length === 0) return [];
    const targetParent = this.tree.getReactiveNode(targetParentSlug);
    if (!targetParent) return [];

    this.undoStack.beginGroup();
    const promote = this.#buildPromoteAreaAction(targetParent, targetParentSlug);
    if (promote) this.undoStack.do(promote);
    const moved: string[] = [];
    for (const slug of topSlugs) {
      const nextSlug = this.reparentNode(slug, targetParentSlug);
      if (nextSlug) moved.push(nextSlug);
    }
    this.undoStack.endGroup();
    return moved;
  }

  /** Deletes multiple selected OSM items as a single undoable step. */
  deleteNodes(itemSlugs: string[]) {
    const topSlugs = this.#filterTopLevelOsmSlugs(itemSlugs);
    if (topSlugs.length === 0) return;

    this.undoStack.beginGroup();
    for (const slug of topSlugs) {
      const parentSlug = getParentSlug(slug);
      if (parentSlug === undefined) continue;
      const node = this.tree.getReactiveNode(slug);
      const parent = this.tree.getReactiveNode(parentSlug);
      if (!node || !parent || node.feature.type === "geographic") continue;
      this.undoStack.do(
        new UndoableNodeDelete(this.osmUser, this.tree, node as DataTree<OsmFeature>, slug, parent, parentSlug),
      );
    }
    this.undoStack.endGroup();
  }

  /** Converts grades of all selected graded routes to `targetScaleId` in one undoable step. */
  bulkChangeGradingScale(itemSlugs: string[], targetScaleId: ScaleId): number {
    const targetScale = getScale(targetScaleId);
    const targetTagKey = scaleIdToTag(targetScaleId);
    if (!targetScale || !targetTagKey) return 0;

    let updated = 0;
    this.undoStack.beginGroup();
    for (const slug of itemSlugs) {
      const node = this.tree.getReactiveNode(slug);
      const feature = node?.feature;
      if (!feature || feature.type === "geographic" || !feature.tags) continue;
      const grade = getGrade(feature.tags);
      if (!grade || grade.v.scale === "unknown") continue;
      const converted = convertGrade(grade.v.v, grade.v.scale, targetScale);
      if (!converted) continue;

      if (grade.source !== targetTagKey) {
        this.deleteTag(slug, grade.source);
      }
      this.setTag(slug, targetTagKey, converted);
      updated++;
    }
    this.undoStack.endGroup();
    return updated;
  }

  /** Sets `climbing:<styleKey>=yes` (optionally replacing other primary climbing styles) across selected items. */
  bulkSetClimbingType(itemSlugs: string[], styleKey: string, replaceExisting = true): number {
    const primaryStyleKeys: Key[] = [
      "climbing:sport",
      "climbing:boulder",
      "climbing:trad",
      "climbing:aid",
      "climbing:ice",
      "climbing:mixed",
      "climbing:dry",
      "climbing:toprope",
      "climbing:deepwater",
    ];
    const targetKey = `climbing:${styleKey}` as Key;
    let updated = 0;

    this.undoStack.beginGroup();
    for (const slug of itemSlugs) {
      const node = this.tree.getReactiveNode(slug);
      const feature = node?.feature;
      if (!feature || feature.type === "geographic") continue;
      if (replaceExisting) {
        for (const k of primaryStyleKeys) {
          if (k !== targetKey && feature.tags?.[k] !== undefined) {
            this.deleteTag(slug, k);
          }
        }
      }
      this.setTag(slug, targetKey, "yes");
      updated++;
    }
    this.undoStack.endGroup();
    return updated;
  }

  findOsmItemById(id: string): { item: DataTree<OsmFeature>; slug: string } | undefined {
    const pending = [{ item: this.tree.root, slug: "" }];
    const visited = new Set<DataTree>();

    while (pending.length > 0) {
      const current = pending.pop()!;
      if (visited.has(current.item)) continue;
      visited.add(current.item);

      const feature = current.item.feature;
      if (feature.type !== "geographic" && `${feature.type}-${feature.id}` === id) {
        return { item: current.item as DataTree<OsmFeature>, slug: current.slug };
      }

      for (const [childSlug, child] of Object.entries(current.item.children ?? {})) {
        pending.push({ item: child, slug: childSlug });
      }
    }
  }

  reorderRelationChildren(parentSlug: string, type: "route" | "area", orderedSlugs: string[]) {
    const parent = this.tree.getReactiveNode(parentSlug);
    if (!parent || parent.feature.type !== "relation") return;
    const relation = parent.feature;

    const slugByIdentifier = new Map<string, string>();
    for (const [childSlug, child] of Object.entries(parent.children ?? {})) {
      if (child.feature.type !== "geographic" && featureToType(child.feature) === type) {
        slugByIdentifier.set(getStaticIdentifier(child.feature.type, child.feature.id), childSlug);
      }
    }

    const orderedSlugSet = new Set(orderedSlugs);
    const memberPositions: number[] = [];
    const membersBySlug = new Map<string, OsmRelation["members"]>();
    parent.feature.members.forEach((member, index) => {
      const childSlug = slugByIdentifier.get(getStaticIdentifier(member.type as BasicOsmType, member.ref));
      if (!childSlug || !orderedSlugSet.has(childSlug)) return;
      memberPositions.push(index);
      const members = membersBySlug.get(childSlug) ?? [];
      members.push(member);
      membersBySlug.set(childSlug, members);
    });

    const orderedMembers = orderedSlugs.flatMap((childSlug) => membersBySlug.get(childSlug) ?? []);
    if (memberPositions.length === 0 || memberPositions.length !== orderedMembers.length) return;

    const nextMembers = [...relation.members];
    memberPositions.forEach((position, index) => {
      nextMembers[position] = orderedMembers[index]!;
    });
    if (nextMembers.every((member, index) => sameRelationMember(member, relation.members[index]!))) return;

    this.undoStack.do(
      new UndoableRelationMembersSet(this.osmUser, parent as DataTree<OsmRelation>, parentSlug, nextMembers),
    );
  }

  /** Reset a feature to before it was modified by the user */
  resetFeature(targetSlug: string) {
    const node = this.tree.getReactiveNode(targetSlug);
    const feature = node?.feature;
    if (!feature || feature.type === "geographic") return;

    this.undoStack.do(new UndoableFeatureSet(this.osmUser, node as DataTree<OsmFeature>, targetSlug, undefined));
  }
}

function sameRelationMember(a: OsmRelation["members"][number], b: OsmRelation["members"][number]): boolean {
  return a.type === b.type && a.ref === b.ref && a.role === b.role;
}

export function commonParentSlug(slugs: string[]): string | undefined {
  const parentParts = slugs
    .map((slug) => getParentSlug(slug))
    .filter((p): p is string => p !== undefined)
    .map((p) => (p === "" ? [] : p.split("/")));
  if (parentParts.length === 0) return undefined;
  const first = parentParts[0]!;
  let shared = first.length;
  for (const parts of parentParts.slice(1)) {
    shared = Math.min(shared, parts.length);
    for (let i = 0; i < shared; i++) {
      if (parts[i] !== first[i]) {
        shared = i;
        break;
      }
    }
  }
  return first.slice(0, shared).join("/");
}

export const [getAppState, setAppState] = createContext<AppState>();
