import { describe, expect, it } from "vitest";
import { getClimbingProviderLinks } from "./climbing-providers.js";
import type { OsmNode, OsmRelation } from "osm-api";

function node(tags: Partial<Record<string, string>>, id = 123): OsmNode {
  return {
    type: "node",
    id,
    version: 1,
    tags: tags as OsmNode["tags"],
    changeset: 0,
    lat: 48,
    lon: 2,
    timestamp: "",
    uid: 1,
    user: "",
  };
}

function relation(tags: Partial<Record<string, string>>, id = 456): OsmRelation {
  return {
    type: "relation",
    id,
    version: 1,
    tags: tags as OsmRelation["tags"],
    changeset: 0,
    members: [],
    timestamp: "",
    uid: 1,
    user: "",
  };
}

describe("climbing-providers", () => {
  it("offers a direct OpenClimbing link and search links for named features", () => {
    const links = getClimbingProviderLinks(node({ name: "95.2" }));
    expect(links).toHaveLength(3);

    const [openclimbing, theCrag, mp] = links;
    expect(openclimbing).toMatchObject({
      id: "openclimbing",
      href: "https://openclimbing.org/en/node/123",
      direct: true,
    });
    expect(theCrag).toMatchObject({
      id: "thecrag",
      href: "https://www.thecrag.com/en/search?q=95.2",
      direct: false,
    });
    expect(mp).toMatchObject({
      id: "mountainproject",
      href: "https://www.mountainproject.com/search?q=95.2",
      direct: false,
    });
  });

  it("links directly to a provider when the OSM data already references it", () => {
    const links = getClimbingProviderLinks(relation({ name: "Franchard", website: "thecrag.com/en/crag/1234" }));
    const theCrag = links.find((link) => link.id === "thecrag")!;
    expect(theCrag).toMatchObject({
      href: "https://thecrag.com/en/crag/1234",
      direct: true,
    });

    const mpLinks = getClimbingProviderLinks(
      node({ name: "Slope", "contact:website": "https://www.mountainproject.com/route/105748840" }),
    );
    const mp = mpLinks.find((link) => link.id === "mountainproject")!;
    expect(mp).toMatchObject({ href: "https://www.mountainproject.com/route/105748840", direct: true });
    expect(mpLinks.find((link) => link.id === "thecrag")?.direct).toBe(false);
  });

  it("returns nothing for locally created features", () => {
    expect(getClimbingProviderLinks(node({ name: "New route" }, -1970643255))).toEqual([]);
  });
});
