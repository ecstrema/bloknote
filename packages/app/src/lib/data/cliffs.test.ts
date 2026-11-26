import { describe, expect, it, vi, afterEach } from "vitest";
import type { OsmNode } from "osm-api";
import { cliffIsPending, cliffPosition, getRegionCliffs, moveCliffNode, resetCliffsForTests } from "./cliffs.svelte.js";
import { OsmUser } from "./network/osm.svelte.js";
import { getFeature } from "osm-api";

vi.mock("osm-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("osm-api")>();
  return { ...actual, getFeature: vi.fn() };
});

function makeCliffNode(id: number, lat = 48.4, lon = 2.6): OsmNode {
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
    tags: { natural: "cliff" },
  };
}

afterEach(() => {
  resetCliffsForTests();
  vi.unstubAllGlobals();
  vi.mocked(getFeature).mockReset();
});

describe("getRegionCliffs", () => {
  it("fetches the deepest geographic ancestor holding a cliffs.json", async () => {
    const cliffs = { timestamp: "2026-01-01T00:00:00Z", cliffs: [{ id: "w1", lon: 2.6, lat: 48.4 }] };
    const fetched: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        fetched.push(url);
        // Only the country-level region holds a cliffs.json
        return Promise.resolve({
          ok: url.endsWith("europe/france/cliffs.json"),
          json: () => Promise.resolve(cliffs),
        });
      }),
    );

    const result = await getRegionCliffs("europe/france/fontainebleau/crag-a");
    expect(result?.cliffs).toEqual(cliffs.cliffs);
    // The deepest region without a cliffs.json is tried first, then the one holding the file
    expect(fetched).toEqual([
      expect.stringContaining("europe/france/fontainebleau/cliffs.json"),
      expect.stringContaining("europe/france/cliffs.json"),
    ]);
  });

  it("resolves to undefined when no region holds a cliffs.json", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) })),
    );
    expect(await getRegionCliffs("europe/france/fontainebleau/crag-a")).toBeUndefined();
  });
});

describe("cliff pending edits", () => {
  it("marks a moved cliff node as a dirty OSM change under a cliff slug", async () => {
    vi.mocked(getFeature).mockResolvedValue([makeCliffNode(123)]);
    const osmUser = new OsmUser();
    await moveCliffNode(osmUser, "n123", { lat: 48.5, lon: 2.7 });

    const change = osmUser.changes.get("cliff/n123");
    expect(change?.initial ? (change.initial as OsmNode).id : undefined).toBe(123);
    expect(change?.final ? (change.final as OsmNode).lat : undefined).toBe(48.5);
    expect(change?.final ? (change.final as OsmNode).lon : undefined).toBe(2.7);
    expect(cliffIsPending("n123")).toBe(true);

    // A second drag builds on the previous position, keeping the original initial version
    await moveCliffNode(osmUser, "n123", { lat: 48.6, lon: 2.8 });
    const updated = osmUser.changes.get("cliff/n123")!;
    expect((updated.initial as OsmNode).id).toBe(123);
    expect((updated.final as OsmNode).lat).toBe(48.6);
  });

  it("gives the pending position of a moved cliff", async () => {
    vi.mocked(getFeature).mockResolvedValue([makeCliffNode(123)]);
    const osmUser = new OsmUser();
    const point = { id: "n123", lon: 2.6, lat: 48.4 };
    expect(cliffPosition(point)).toEqual({ lon: 2.6, lat: 48.4 });

    await moveCliffNode(osmUser, "n123", { lat: 48.5, lon: 2.7 });
    expect(cliffPosition(point)).toEqual({ lon: 2.7, lat: 48.5 });
  });
});
