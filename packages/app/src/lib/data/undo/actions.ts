import { getStaticIdentifier } from "@bloknote/common";
import type { DataTree } from "#lib/types.js";
import type { Key, OsmFeature, OsmNode, OsmRelation } from "osm-api";
import type { Undoable } from "./types";
import type { OsmUser } from "../network/osm.svelte";
import { snapshot } from "#lib/helpers/svelte.svelte.js";
import { reversed } from "#lib/helpers/iterators.js";
import { dataClient } from "../network/data-client.js";
import type { AppDataTree } from "../app-data-tree.svelte.js";
import { getCoordinates } from "../parse/osm-tags.js";

/** An undoable action can be done and undone. */
export class OsmUndoable {
  osmUser: OsmUser;
  constructor(osmUser: OsmUser) {
    this.osmUser = osmUser;
  }
}

/**
 * An undoable for editing a single osm tag from an element.
 * Set the value to undefined to delete the tag.
 */
export class UndoableTagChange extends OsmUndoable implements Undoable {
  previousValue: string | undefined;
  newValue: string | undefined;
  tagKey: Key;
  targetFeature: OsmFeature;
  targetFeatureSlug: string;

  constructor(
    osmUser: OsmUser,
    targetFeature: OsmFeature,
    targetFeatureSlug: string,
    tagKey: Key,
    newValue: string | undefined,
  ) {
    super(osmUser);
    this.targetFeature = targetFeature;
    this.targetFeatureSlug = targetFeatureSlug;
    this.tagKey = tagKey;
    this.newValue = newValue;
    this.previousValue = targetFeature.tags?.[tagKey];
  }

  do() {
    if (this.previousValue === this.newValue) return;

    const featureBefore = snapshot(this.targetFeature);

    if (this.newValue === undefined) {
      delete this.targetFeature.tags?.[this.tagKey];
    } else {
      this.targetFeature.tags ??= {};
      this.targetFeature.tags[this.tagKey] = this.newValue;
    }

    this.osmUser.markAsDirty(featureBefore, this.targetFeatureSlug, this.targetFeature);
  }

  undo() {
    const featureBefore = snapshot(this.targetFeature);

    if (this.previousValue === undefined) {
      delete this.targetFeature.tags?.[this.tagKey];
    } else {
      this.targetFeature.tags ??= {};
      this.targetFeature.tags[this.tagKey] = this.previousValue;
    }

    this.osmUser.markAsDirty(featureBefore, this.targetFeatureSlug, this.targetFeature);
  }
}

/** An undoable for moving a node. */
export class UndoableMove extends OsmUndoable implements Undoable {
  previous: { lat: number; lon: number };

  constructor(
    osmUser: OsmUser,
    private targetFeature: OsmNode,
    private targetFeatureSlug: string,
    private next: { lat: number; lon: number },
  ) {
    super(osmUser);
    this.previous = { lat: targetFeature.lat, lon: targetFeature.lon };
  }

  #set(position: { lat: number; lon: number }) {
    const featureBefore = snapshot(this.targetFeature);
    this.targetFeature.lat = position.lat;
    this.targetFeature.lon = position.lon;
    this.osmUser.markAsDirty(featureBefore, this.targetFeatureSlug, this.targetFeature);
  }

  do() {
    this.#set(this.next);
  }

  undo() {
    this.#set(this.previous);
  }
}

/** Reorder the members of an OSM relation. */
export class UndoableRelationMembersSet extends OsmUndoable implements Undoable {
  previous: OsmRelation["members"];

  constructor(
    osmUser: OsmUser,
    private item: DataTree<OsmRelation>,
    private featureSlug: string,
    private next: OsmRelation["members"],
  ) {
    super(osmUser);
    this.previous = snapshot(item.feature.members);
  }

  #set(members: OsmRelation["members"]) {
    const featureBefore = snapshot(this.item.feature);
    this.item.feature.members = snapshot(members);
    this.osmUser.markAsDirty(featureBefore, this.featureSlug, this.item.feature);
  }

  do() {
    this.#set(this.next);
  }

  undo() {
    this.#set(this.previous);
  }
}

/** An undoable for deleting a single osm tag from an element. */
export class UndoableTagDelete extends UndoableTagChange {
  constructor(osmUser: OsmUser, targetFeature: OsmFeature, targetFeatureSlug: string, tagKey: Key) {
    super(osmUser, targetFeature, targetFeatureSlug, tagKey, undefined);
  }
}

/** Several undoables applied as a single step */
export class UndoableGroup implements Undoable {
  undoables: Undoable[];

  constructor(undoables: Undoable[]) {
    this.undoables = undoables;
  }

  do() {
    for (const undoable of this.undoables) undoable.do();
  }

  undo() {
    for (const undoable of reversed(this.undoables)) undoable.undo();
  }
}

let nextTempOsmId = -Math.floor(Date.now() / 1000);
function createTempOsmId(): number {
  return --nextTempOsmId;
}

/** Add a node to the parent DataTree. Extended by {@link UndoableRouteCreate} and {@link UndoableAreaCreate} */
export class UndoableNodeCreate extends OsmUndoable implements Undoable {
  tree: AppDataTree;
  parent: DataTree;
  parentSlug: string;
  slug: string;
  item: DataTree<OsmFeature>;
  #hadParentMember = false;

  constructor(osmUser: OsmUser, tree: AppDataTree, feature: OsmFeature, parent: DataTree, parentSlug: string) {
    super(osmUser);
    this.tree = tree;
    this.item = {
      feature: feature,
      children: {},
      childrenFetched: true,
    };
    this.parent = parent;
    this.parentSlug = parentSlug;
    this.slug = parentSlug ? `${parentSlug}/${crypto.randomUUID()}` : crypto.randomUUID();
  }

  do() {
    this.parent.children ??= {};
    this.parent.children[this.slug] = this.item;
    const reactiveNode = this.parent.children[this.slug]!;
    this.tree.setReactiveNode(this.slug, reactiveNode);
    dataClient.registerLocalNode(this.slug, reactiveNode);
    if (this.parent.childrenFetched) dataClient.registerLocalNode(this.parentSlug, this.parent);

    this.osmUser.markAsDirty(undefined, this.slug, this.item.feature);

    if (this.parent.feature.type === "relation") {
      const feature = this.parent.feature;
      const member = { type: this.item.feature.type, ref: this.item.feature.id, role: "" };
      this.#hadParentMember = feature.members.some((m) => m.type === member.type && m.ref === member.ref);
      if (!this.#hadParentMember) {
        const before = snapshot(feature);
        feature.members = [...feature.members, member];
        this.osmUser.markAsDirty(before, this.parentSlug, feature);
      }
    }
  }

  undo() {
    if (this.parent.feature.type === "relation" && !this.#hadParentMember) {
      const feature = this.parent.feature;
      const before = snapshot(feature);
      feature.members = feature.members.filter(
        (m) => !(m.type === this.item.feature.type && m.ref === this.item.feature.id),
      );
      this.osmUser.markAsDirty(before, this.parentSlug, feature);
    }

    dataClient.unregisterLocalNode(this.slug);
    this.tree.deleteReactiveNode(this.slug);
    if (this.parent.children) {
      delete this.parent.children[this.slug];
      this.osmUser.markAsDirty(this.item.feature, this.slug, undefined);
    }
  }
}

/** Add a new route to the parent DataTree */
export class UndoableRouteCreate extends UndoableNodeCreate {
  constructor(
    osmUser: OsmUser,
    tree: AppDataTree,
    parent: DataTree,
    parentSlug: string,
    coordinates: { lat: number; lon: number } = { lat: 0, lon: 0 },
    name?: string,
  ) {
    const newRoute: OsmNode = {
      type: "node",
      id: createTempOsmId(),
      version: 0,
      tags: {
        sport: "climbing",
        climbing: "route_bottom",
        ...(name ? { name } : {}),
      },
      changeset: 0,
      lat: coordinates.lat,
      lon: coordinates.lon,
      timestamp: "-1",
      uid: -1,
      user: "",
    };
    super(osmUser, tree, newRoute, parent, parentSlug);
  }
}

/** Add a new area to the parent DataTree */
export class UndoableAreaCreate extends UndoableNodeCreate {
  constructor(
    osmUser: OsmUser,
    tree: AppDataTree,
    parent: DataTree,
    parentSlug: string,
    name?: string,
    climbing: "area" | "crag" = "area",
  ) {
    const newArea: OsmRelation = {
      type: "relation",
      id: createTempOsmId(),
      version: 0,
      tags: {
        sport: "climbing",
        climbing,
        ...(name ? { name } : {}),
      },
      changeset: 0,
      members: [],
      timestamp: "-1",
      uid: -1,
      user: "",
    };
    super(osmUser, tree, newArea, parent, parentSlug);
  }
}

const PRESERVE_NON_CLIMBING_KEYS = new Set([
  "natural",
  "tourism",
  "leisure",
  "amenity",
  "historic",
  "man_made",
  "highway",
  "landuse",
  "boundary",
  "waterway",
  "place",
  "building",
]);

/**
 * Converts a node/way climbing area into an OSM site relation so it can hold member routes/sectors.
 * Non-climbing landmarks or ways are preserved (with climbing tags stripped) as members of the new relation;
 * standalone climbing crag nodes are deleted and replaced by the relation.
 */
export class UndoablePromoteAreaToRelation extends OsmUndoable implements Undoable {
  #oldFeature: OsmFeature;
  #newRelation: OsmRelation & { center?: { lat: number; lon: number } };
  #keptFeature: OsmFeature | undefined;
  #replacedChangeKey: string | undefined;
  #prevNodeChange: { initial: OsmFeature | undefined; final: OsmFeature | undefined } | undefined;
  #prevChildrenFetched: true | undefined;
  #grandParentMemberIndex = -1;
  #oldGrandParentMember: OsmRelation["members"][number] | undefined;

  constructor(
    osmUser: OsmUser,
    private node: DataTree<OsmFeature>,
    private slug: string,
    private grandParent?: DataTree,
    private grandParentSlug?: string,
  ) {
    super(osmUser);
    this.#oldFeature = snapshot(node.feature);
    const shouldKeepOriginal =
      this.#oldFeature.type === "way" ||
      Object.keys(this.#oldFeature.tags ?? {}).some((k) => PRESERVE_NON_CLIMBING_KEYS.has(k));

    const tags = { ...(this.#oldFeature.tags ?? {}) } as Record<string, string>;
    tags.type = "site";
    tags.site ??= "climbing";

    const coords = getCoordinates(this.#oldFeature);
    this.#newRelation = {
      type: "relation",
      id: createTempOsmId(),
      version: 0,
      changeset: 0,
      timestamp: "-1",
      uid: -1,
      user: "",
      members: shouldKeepOriginal ? [{ type: this.#oldFeature.type, ref: this.#oldFeature.id, role: "" }] : [],
      tags,
      ...(coords ? { center: coords } : {}),
    };

    if (shouldKeepOriginal) {
      const kept = snapshot(this.#oldFeature);
      if (kept.tags) {
        delete kept.tags.climbing;
        delete kept.tags.sport;
        delete kept.tags.type;
        delete kept.tags.site;
      }
      this.#keptFeature = kept;
      this.#replacedChangeKey = `${slug}#kept-${getStaticIdentifier(this.#oldFeature.type, this.#oldFeature.id)}`;
    } else if (this.#oldFeature.id > 0) {
      this.#replacedChangeKey = `${slug}#replaced-${getStaticIdentifier(this.#oldFeature.type, this.#oldFeature.id)}`;
    }
  }

  do() {
    this.#prevChildrenFetched = this.node.childrenFetched;
    const existingChange = this.osmUser.changes.get(this.slug);
    this.#prevNodeChange = existingChange
      ? { initial: snapshot(existingChange.initial), final: snapshot(existingChange.final) }
      : undefined;

    if (this.grandParent?.feature.type === "relation") {
      const rel = this.grandParent.feature;
      this.#grandParentMemberIndex = rel.members.findIndex(
        (m) => m.type === this.#oldFeature.type && m.ref === this.#oldFeature.id,
      );
      if (this.#grandParentMemberIndex !== -1) {
        const before = snapshot(rel);
        this.#oldGrandParentMember = rel.members[this.#grandParentMemberIndex];
        const nextMembers = [...rel.members];
        nextMembers[this.#grandParentMemberIndex] = {
          type: "relation",
          ref: this.#newRelation.id,
          role: this.#oldGrandParentMember!.role,
        };
        rel.members = nextMembers;
        this.osmUser.markAsDirty(before, this.grandParentSlug!, rel);
      }
    }

    this.node.feature = snapshot(this.#newRelation);
    this.node.children ??= {};
    this.node.childrenFetched = true;
    dataClient.registerLocalNode(this.slug, this.node);

    this.osmUser.changes.delete(this.slug);
    this.osmUser.markAsDirty(undefined, this.slug, this.node.feature);

    if (this.#replacedChangeKey) {
      const initialForReplaced = this.#prevNodeChange?.initial ?? this.#oldFeature;
      if (this.#keptFeature) {
        this.osmUser.markAsDirty(
          initialForReplaced?.id && initialForReplaced.id > 0 ? snapshot(initialForReplaced) : undefined,
          this.#replacedChangeKey,
          this.#keptFeature,
        );
      } else if (initialForReplaced && initialForReplaced.id > 0) {
        this.osmUser.markAsDirty(snapshot(initialForReplaced), this.#replacedChangeKey, undefined);
      }
    }
  }

  undo() {
    if (this.grandParent?.feature.type === "relation" && this.#oldGrandParentMember && this.#grandParentMemberIndex !== -1) {
      const rel = this.grandParent.feature;
      const before = snapshot(rel);
      const nextMembers = [...rel.members];
      nextMembers[this.#grandParentMemberIndex] = this.#oldGrandParentMember;
      rel.members = nextMembers;
      this.osmUser.markAsDirty(before, this.grandParentSlug!, rel);
    }

    this.node.feature = snapshot(this.#oldFeature);
    this.node.childrenFetched = this.#prevChildrenFetched;
    dataClient.registerLocalNode(this.slug, this.node);

    if (this.#replacedChangeKey) {
      this.osmUser.changes.delete(this.#replacedChangeKey);
    }
    this.osmUser.changes.delete(this.slug);
    if (this.#prevNodeChange) {
      this.osmUser.changes.set(this.slug, {
        initial: snapshot(this.#prevNodeChange.initial),
        final: snapshot(this.#prevNodeChange.final),
      });
    }
  }
}

/** Move an OSM node/area/gym from its current parent to a new parent (geographic region or relation). */
export class UndoableReparentNode extends OsmUndoable implements Undoable {
  readonly newSlug: string;
  #oldMemberIndex = -1;
  #removedMember: OsmRelation["members"][number] | undefined;
  #addedToNewParent = false;

  constructor(
    osmUser: OsmUser,
    private tree: AppDataTree,
    private node: DataTree<OsmFeature>,
    private oldSlug: string,
    private oldParent: DataTree,
    private oldParentSlug: string,
    private newParent: DataTree,
    private newParentSlug: string,
  ) {
    super(osmUser);
    const segment = oldSlug.slice(oldSlug.lastIndexOf("/") + 1);
    const candidate = newParentSlug ? `${newParentSlug}/${segment}` : segment;
    this.newSlug =
      newParent.children?.[candidate] && candidate !== oldSlug
        ? `${newParentSlug ? `${newParentSlug}/` : ""}${segment}-${crypto.randomUUID().slice(0, 6)}`
        : candidate;
  }

  #rekeySubtree(root: DataTree, fromPrefix: string, toPrefix: string) {
    if (!root.children) return;
    const updated: Record<string, DataTree> = {};
    for (const [oldChildSlug, child] of Object.entries(root.children)) {
      const nextChildSlug = oldChildSlug.startsWith(`${fromPrefix}/`)
        ? `${toPrefix}${oldChildSlug.slice(fromPrefix.length)}`
        : oldChildSlug;
      this.tree.deleteReactiveNode(oldChildSlug);
      dataClient.unregisterLocalNode(oldChildSlug);
      this.osmUser.renameChangeSlug(oldChildSlug, nextChildSlug);
      this.#rekeySubtree(child, fromPrefix, toPrefix);
      updated[nextChildSlug] = child;
    }
    root.children = updated;
    for (const [nextChildSlug, child] of Object.entries(root.children)) {
      this.tree.setReactiveNode(nextChildSlug, child);
      dataClient.registerLocalNode(nextChildSlug, child);
    }
  }

  #move(
    fromSlug: string,
    toSlug: string,
    fromParent: DataTree,
    fromParentSlug: string,
    toParent: DataTree,
    toParentSlug: string,
    isUndo: boolean,
  ) {
    if (fromParent === toParent && fromSlug === toSlug) return;

    if (fromParent.children) delete fromParent.children[fromSlug];
    this.tree.deleteReactiveNode(fromSlug);
    dataClient.unregisterLocalNode(fromSlug);

    this.#rekeySubtree(this.node, fromSlug, toSlug);

    toParent.children ??= {};
    toParent.children[toSlug] = this.node;
    const reactiveNode = toParent.children[toSlug]!;
    this.tree.setReactiveNode(toSlug, reactiveNode);
    dataClient.registerLocalNode(toSlug, reactiveNode);
    if (fromParent.childrenFetched) dataClient.registerLocalNode(fromParentSlug, fromParent);
    if (toParent.childrenFetched) dataClient.registerLocalNode(toParentSlug, toParent);
    this.osmUser.renameChangeSlug(fromSlug, toSlug);

    if (fromParent.feature.type === "relation") {
      const rel = fromParent.feature;
      const before = snapshot(rel);
      if (!isUndo) {
        this.#oldMemberIndex = rel.members.findIndex(
          (m) => m.type === this.node.feature.type && m.ref === this.node.feature.id,
        );
        if (this.#oldMemberIndex !== -1) {
          this.#removedMember = rel.members[this.#oldMemberIndex];
          rel.members = rel.members.filter((_, idx) => idx !== this.#oldMemberIndex);
          this.osmUser.markAsDirty(before, fromParentSlug, rel);
        }
      } else if (this.#addedToNewParent) {
        rel.members = rel.members.filter(
          (m) => !(m.type === this.node.feature.type && m.ref === this.node.feature.id),
        );
        this.osmUser.markAsDirty(before, fromParentSlug, rel);
      }
    }

    if (toParent.feature.type === "relation") {
      const rel = toParent.feature;
      const before = snapshot(rel);
      if (!isUndo) {
        const exists = rel.members.some(
          (m) => m.type === this.node.feature.type && m.ref === this.node.feature.id,
        );
        this.#addedToNewParent = !exists;
        if (!exists) {
          rel.members = [...rel.members, { type: this.node.feature.type, ref: this.node.feature.id, role: "" }];
          this.osmUser.markAsDirty(before, toParentSlug, rel);
        }
      } else if (this.#removedMember) {
        const nextMembers = [...rel.members];
        nextMembers.splice(Math.min(this.#oldMemberIndex, nextMembers.length), 0, this.#removedMember);
        rel.members = nextMembers;
        this.osmUser.markAsDirty(before, toParentSlug, rel);
      }
    }
  }

  do() {
    this.#move(
      this.oldSlug,
      this.newSlug,
      this.oldParent,
      this.oldParentSlug,
      this.newParent,
      this.newParentSlug,
      false,
    );
  }

  undo() {
    this.#move(
      this.newSlug,
      this.oldSlug,
      this.newParent,
      this.newParentSlug,
      this.oldParent,
      this.oldParentSlug,
      true,
    );
  }
}

/** Delete an existing or newly created node from the DataTree and mark it deleted in OSM. */
export class UndoableNodeDelete extends OsmUndoable implements Undoable {
  #featureBefore: OsmFeature;
  #memberIndex = -1;
  #removedMember: OsmRelation["members"][number] | undefined;

  constructor(
    osmUser: OsmUser,
    private tree: AppDataTree,
    private node: DataTree<OsmFeature>,
    private slug: string,
    private parent: DataTree,
    private parentSlug: string,
  ) {
    super(osmUser);
    this.#featureBefore = snapshot(node.feature);
  }

  #collectDescendants(root: DataTree): [string, DataTree][] {
    const entries: [string, DataTree][] = [];
    for (const [childSlug, child] of Object.entries(root.children ?? {})) {
      entries.push([childSlug, child], ...this.#collectDescendants(child));
    }
    return entries;
  }

  do() {
    if (this.parent.feature.type === "relation") {
      const rel = this.parent.feature;
      const before = snapshot(rel);
      this.#memberIndex = rel.members.findIndex(
        (m) => m.type === this.node.feature.type && m.ref === this.node.feature.id,
      );
      if (this.#memberIndex !== -1) {
        this.#removedMember = rel.members[this.#memberIndex];
        rel.members = rel.members.filter((_, idx) => idx !== this.#memberIndex);
        this.osmUser.markAsDirty(before, this.parentSlug, rel);
      }
    }

    for (const [descSlug] of this.#collectDescendants(this.node)) {
      this.tree.deleteReactiveNode(descSlug);
      dataClient.unregisterLocalNode(descSlug);
    }
    this.tree.deleteReactiveNode(this.slug);
    dataClient.unregisterLocalNode(this.slug);

    if (this.parent.children) {
      delete this.parent.children[this.slug];
      if (this.parent.childrenFetched) dataClient.registerLocalNode(this.parentSlug, this.parent);
    }

    this.osmUser.markAsDirty(this.#featureBefore, this.slug, undefined);
  }

  undo() {
    this.parent.children ??= {};
    this.parent.children[this.slug] = this.node;
    const reactiveNode = this.parent.children[this.slug]!;
    this.tree.setReactiveNode(this.slug, reactiveNode);
    dataClient.registerLocalNode(this.slug, reactiveNode);
    for (const [descSlug, descNode] of this.#collectDescendants(reactiveNode)) {
      this.tree.setReactiveNode(descSlug, descNode);
      dataClient.registerLocalNode(descSlug, descNode);
    }
    if (this.parent.childrenFetched) dataClient.registerLocalNode(this.parentSlug, this.parent);

    if (this.parent.feature.type === "relation" && this.#removedMember) {
      const rel = this.parent.feature;
      const before = snapshot(rel);
      const nextMembers = [...rel.members];
      nextMembers.splice(Math.min(this.#memberIndex, nextMembers.length), 0, this.#removedMember);
      rel.members = nextMembers;
      this.osmUser.markAsDirty(before, this.parentSlug, rel);
    }

    this.osmUser.markAsDirty(undefined, this.slug, this.#featureBefore);
  }
}

/** Completely replace a feature with another. Set the new feature to undefined to reset to initial. */
export class UndoableFeatureSet extends OsmUndoable implements Undoable {
  item: DataTree<OsmFeature>;
  featureSlug: string;
  newFeature: OsmFeature | undefined;
  featureBefore: OsmFeature | undefined;

  /**
   * @param newFeature Set this to undefined to reset the feature to its initial state.
   */
  constructor(osmUser: OsmUser, item: DataTree<OsmFeature>, featureSlug: string, newFeature: OsmFeature | undefined) {
    super(osmUser);
    this.item = item;
    this.featureSlug = featureSlug;
    this.newFeature = newFeature;
  }

  do() {
    this.featureBefore = this.item.feature;
    let newFeature = this.newFeature;
    if (!newFeature) {
      const savedFeature = this.osmUser.changes.get(this.featureSlug)?.initial;
      if (!savedFeature) {
        console.warn("Cannot reset feature with no changes saved in change list.");
        return;
      }
      this.osmUser.changes.delete(this.featureSlug);
      newFeature = savedFeature;
    } else {
      this.osmUser.markAsDirty(this.featureBefore, this.featureSlug, this.newFeature);
    }
    this.item.feature = newFeature;
  }

  undo() {
    if (this.featureBefore) {
      this.osmUser.markAsDirty(this.newFeature, this.featureSlug, this.featureBefore);
      this.item.feature = this.featureBefore;
      this.featureBefore = undefined;
    }
  }
}
