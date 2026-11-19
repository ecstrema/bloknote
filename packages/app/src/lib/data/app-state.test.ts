import { describe, expect, it } from "vitest";
import type { OsmNode, OsmRelation } from "osm-api";
import { AppDataTree } from "./app-data-tree.svelte.js";
import { AppState, commonParentSlug } from "./app-state.js";

function makeRoute(id: number, name: string): OsmNode {
  return {
    type: "node",
    id,
    version: 1,
    lat: 48.4,
    lon: 2.6,
    changeset: 1,
    timestamp: "2026-01-01T00:00:00Z",
    uid: 1,
    user: "tester",
    tags: { sport: "climbing", climbing: "route_bottom", name },
  };
}

function makeRelation(id: number, name: string, members: OsmRelation["members"] = []): OsmRelation {
  return {
    type: "relation",
    id,
    version: 1,
    changeset: 1,
    timestamp: "2026-01-01T00:00:00Z",
    uid: 1,
    user: "tester",
    members,
    tags: { sport: "climbing", climbing: "area", name },
  };
}

function makeState() {
  const r1 = makeRoute(101, "Route 1");
  const r2 = makeRoute(102, "Route 2");
  const crag = makeRelation(201, "Crag A", [
    { type: "node", ref: 101, role: "" },
    { type: "node", ref: 102, role: "" },
  ]);

  const tree = new AppDataTree({
    feature: { type: "geographic", name: "world" },
    childrenFetched: true,
    children: {
      "europe/france/fontainebleau": {
        feature: { type: "geographic", name: "fontainebleau" },
        childrenFetched: true,
        children: {
          "europe/france/fontainebleau/crag-a": {
            feature: crag,
            childrenFetched: true,
            children: {
              "europe/france/fontainebleau/crag-a/r1": { feature: r1 },
              "europe/france/fontainebleau/crag-a/r2": { feature: r2 },
            },
          },
        },
      },
    },
  });

  // Register nodes into #parentMap via integrateNodeIntoTree
  const region = tree.root.children!["europe/france/fontainebleau"]!;
  tree.integrateNodeIntoTree(region, "europe/france/fontainebleau", "");
  const cragNode = region.children!["europe/france/fontainebleau/crag-a"]!;
  tree.integrateNodeIntoTree(cragNode, "europe/france/fontainebleau/crag-a", "europe/france/fontainebleau");

  const state = new AppState(
    tree,
    { slugs: [], items: [] },
    { current: tree.root },
  );
  return { state, tree, cragNode };
}

describe("commonParentSlug", () => {
  it("computes the longest common parent path of selected slugs", () => {
    expect(commonParentSlug(["a/b/c/1", "a/b/c/2"])).toBe("a/b/c");
    expect(commonParentSlug(["a/b/c/1", "a/b/d/2"])).toBe("a/b");
    expect(commonParentSlug(["a/1", "b/2"])).toBe("");
    expect(commonParentSlug([])).toBeUndefined();
  });
});

describe("AppState.createSectorWithItems", () => {
  it("creates a new sector, moves selected routes into it, and supports undo/redo", () => {
    const { state, tree, cragNode } = makeState();
    const s1 = "europe/france/fontainebleau/crag-a/r1";
    const s2 = "europe/france/fontainebleau/crag-a/r2";

    const sectorSlug = state.createSectorWithItems([s1, s2], "New Sector");
    expect(sectorSlug).toBeDefined();
    expect(sectorSlug!.startsWith("europe/france/fontainebleau/crag-a/")).toBe(true);

    const sectorNode = tree.getReactiveNode(sectorSlug!);
    expect(sectorNode).toBeDefined();
    expect(sectorNode!.feature.type).toBe("relation");
    expect((sectorNode!.feature as OsmRelation).tags?.name).toBe("New Sector");
    expect((sectorNode!.feature as OsmRelation).members.map((m) => m.ref)).toEqual([101, 102]);
    expect(Object.keys(sectorNode!.children ?? {})).toEqual([`${sectorSlug}/r1`, `${sectorSlug}/r2`]);

    // Old parent no longer contains the moved routes, and holds the new sector
    const cragRel = cragNode.feature as OsmRelation;
    expect(cragNode.children![s1]).toBeUndefined();
    expect(cragNode.children![s2]).toBeUndefined();
    expect(cragRel.members.map((m) => m.ref)).toEqual([(sectorNode!.feature as OsmRelation).id]);

    // Undo restores original state completely
    state.undoStack.undo();
    expect(tree.getReactiveNode(sectorSlug!)).toBeUndefined();
    expect(cragNode.children![s1]).toBeDefined();
    expect(cragNode.children![s2]).toBeDefined();
    expect(cragRel.members.map((m) => m.ref)).toEqual([101, 102]);
    expect(state.osmUser.changes.size).toBe(0);

    // Redo reapplies the move
    state.undoStack.redo();
    expect(tree.getReactiveNode(sectorSlug!)).toBeDefined();
    expect(cragNode.children![s1]).toBeUndefined();
    expect(cragNode.children![s2]).toBeUndefined();
  });

  it("supports bulk grading scale conversion, climbing type change, move, and delete with undo", () => {
    const { state, tree, cragNode } = makeState();
    const s1 = "europe/france/fontainebleau/crag-a/r1";
    const s2 = "europe/france/fontainebleau/crag-a/r2";
    state.setTag(s1, "climbing:grade:french", "6a");
    state.setTag(s2, "climbing:grade:french", "7a");

    expect(state.bulkChangeGradingScale([s1, s2], "YDS")).toBe(2);
    expect((tree.getReactiveNode(s1)!.feature as OsmNode).tags).toMatchObject({ "climbing:grade:yds_class": "5.10a" });
    expect((tree.getReactiveNode(s2)!.feature as OsmNode).tags).toMatchObject({ "climbing:grade:yds_class": "5.11d" });
    expect((tree.getReactiveNode(s1)!.feature as OsmNode).tags?.["climbing:grade:french"]).toBeUndefined();

    expect(state.bulkSetClimbingType([s1, s2], "trad")).toBe(2);
    expect((tree.getReactiveNode(s1)!.feature as OsmNode).tags?.["climbing:trad"]).toBe("yes");

    state.moveItemsToParent([s1], "europe/france/fontainebleau");
    expect(tree.getReactiveNode("europe/france/fontainebleau/r1")).toBeDefined();
    expect(cragNode.children![s1]).toBeUndefined();

    state.deleteNodes([s2]);
    expect(tree.getReactiveNode(s2)).toBeUndefined();
    expect(state.osmUser.changes.get(s2)?.final).toBeUndefined();

    state.undoStack.undo();
    expect(tree.getReactiveNode(s2)).toBeDefined();
  });
});