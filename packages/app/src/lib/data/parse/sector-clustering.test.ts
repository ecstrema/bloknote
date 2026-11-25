import { describe, expect, it } from "vitest";
import type { OsmNode, OsmRelation, OsmWay } from "osm-api";
import { AppDataTree } from "../app-data-tree.svelte.js";
import { clusterRoutes, collectOrphanRoutes, describeClusterSize, type OrphanRoute } from "./sector-clustering.js";

// At latitude 48.4, one thousandth of degree is ~111 m of latitude and ~74 m of longitude
function route(id: number, name: string, lat: number, lon: number): OsmNode {
  return {
    type: "node",
    id,
    version: 1,
    lat,
    lon,
    changeset: 1,
    timestamp: "2026-01-01T00:00:00Z",
    uid: 1,
    user: "tester",
    tags: { sport: "climbing", climbing: "route_bottom", name },
  };
}

function orphan(slug: string, name: string | undefined, lat: number, lon: number): OrphanRoute {
  return { slug, name, coordinates: { lat, lon } };
}

describe("clusterRoutes", () => {
  it("returns no cluster without routes", () => {
    expect(clusterRoutes([], 100)).toEqual([]);
  });

  it("groups nearby routes and keeps singletons", () => {
    const clusters = clusterRoutes([orphan("a", "One", 48.4, 2.6), orphan("b", "Two", 48.4, 2.6008)], 100);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.slugs).toEqual(["a", "b"]);
    expect(clusters[0]!.names).toEqual(["One", "Two"]);
    // The whole cluster fits within the threshold around its center
    expect(clusters[0]!.radiusMeters).toBeLessThanOrEqual(100);
  });

  it("separates distant routes and sorts clusters biggest first", () => {
    const clusters = clusterRoutes(
      [
        orphan("solo", "Loner", 48.4, 2.6),
        orphan("a1", undefined, 48.41, 2.61),
        orphan("a2", undefined, 48.41, 2.6105),
        orphan("a3", undefined, 48.4104, 2.61),
      ],
      100,
    );
    expect(clusters).toHaveLength(2);
    expect(clusters[0]!.slugs).toEqual(["a1", "a2", "a3"]);
    expect(clusters[1]!.slugs).toEqual(["solo"]);
    expect(clusters[1]!.names).toEqual(["Loner"]);
  });

  it("keeps chains of nearby routes in one cluster (single-linkage)", () => {
    const clusters = clusterRoutes(
      [orphan("a", undefined, 48.4, 2.6), orphan("b", undefined, 48.4005, 2.6), orphan("c", undefined, 48.401, 2.6)],
      100,
    );
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.slugs).toEqual(["a", "b", "c"]);
  });

  it("adapts to the threshold", () => {
    const routes = [orphan("a", undefined, 48.4, 2.6), orphan("b", undefined, 48.4005, 2.6)];
    expect(clusterRoutes(routes, 100)).toHaveLength(1);
    expect(clusterRoutes(routes, 10)).toHaveLength(2);
  });
});

describe("describeClusterSize", () => {
  it("mentions the route count, and the spread for multi-route clusters", () => {
    const single = clusterRoutes([orphan("a", undefined, 48.4, 2.6)], 100)[0]!;
    expect(describeClusterSize(single)).toBe("1 route");
    const pair = clusterRoutes([orphan("a", undefined, 48.4, 2.6), orphan("b", undefined, 48.4, 2.6008)], 100)[0]!;
    expect(describeClusterSize(pair)).toMatch(/^2 routes · \d+ m$/);
  });
});

describe("collectOrphanRoutes", () => {
  it("collects the direct route children with coordinates, and ignores areas and unplaced routes", () => {
    const placed = route(101, "Placed", 48.4, 2.6);
    const area = {
      type: "relation",
      id: 201,
      version: 1,
      changeset: 1,
      timestamp: "2026-01-01T00:00:00Z",
      uid: 1,
      user: "tester",
      members: [],
      tags: { sport: "climbing", climbing: "area", name: "Sector" },
    } as OsmRelation;
    const unplaced = {
      type: "way",
      id: 301,
      version: 1,
      changeset: 1,
      timestamp: "2026-01-01T00:00:00Z",
      uid: 1,
      user: "tester",
      nodes: [],
      tags: { sport: "climbing", climbing: "route_bottom", name: "Unplaced" },
    } as OsmWay;

    const tree = new AppDataTree({
      feature: { type: "geographic", name: "world" },
      childrenFetched: true,
      children: {
        "europe/france/fontainebleau/crag-a": {
          feature: {
            type: "relation",
            id: 1,
            version: 1,
            changeset: 1,
            timestamp: "2026-01-01T00:00:00Z",
            uid: 1,
            user: "tester",
            members: [],
            tags: { sport: "climbing", climbing: "crag", name: "Crag A" },
          } as OsmRelation,
          childrenFetched: true,
          children: {
            "europe/france/fontainebleau/crag-a/placed": { feature: placed },
            "europe/france/fontainebleau/crag-a/sector": { feature: area },
            "europe/france/fontainebleau/crag-a/unplaced": { feature: unplaced },
          },
        },
      },
    });
    const parent = tree.root.children!["europe/france/fontainebleau/crag-a"]!;

    const { routes, unplaced: unplacedCount } = collectOrphanRoutes(parent);
    expect(unplacedCount).toBe(1);
    expect(routes).toHaveLength(1);
    expect(routes[0]).toMatchObject({ slug: "europe/france/fontainebleau/crag-a/placed", name: "Placed" });
  });
});
