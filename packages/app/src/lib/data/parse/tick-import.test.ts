import { describe, expect, it } from "vitest";
import { parseCsv, parseTickCsv } from "./tick-import.js";

describe("parseCsv", () => {
  it("handles quotes, escaped quotes, and newlines inside values", () => {
    const rows = parseCsv('a,"b,1","he said ""hi"""\r\n"x\ny",z');
    expect(rows).toEqual([
      ["a", "b,1", 'he said "hi"'],
      ["x\ny", "z"],
    ]);
  });
});

describe("parseTickCsv", () => {
  const mountainProject = [
    "Date,Route,Rating,Notes,URL,Pitches,Location,\"Avg Stars\",\"Your Stars\",Style,\"Lead Style\",\"Route Type\",\"Your Rating\",Length,\"Rating Code\"",
    '2026-07-26,"Death in the Afternoon",5.12a,,https://www.mountainproject.com/route/117337103/death-in-the-afternoon,1,"International > North America > Canada > Alberta > Bow Valley > Grotto Canyon > Hemingway Wall",2.8,-1,Lead,Flash,Sport,,50,6600',
    '2026-07-24,Xanadu,5.10a,,https://www.mountainproject.com/route/114252058/xanadu,1,"International > North America > Canada > Alberta > Bow Valley > Grotto Canyon > The Narrows",2.9,-1,Lead,Onsight,Sport,,,2600',
    '2026-07-20,Some Project,5.13a,crux is heady,https://www.mountainproject.com/route/1/some-project,1,"International > Canada > Baffin",2.9,-1,Lead,Redpoint,Sport,,,',
  ].join("\n");

  const theCrag = [
    "Route Name,Ascent Label,Ascent ID,Ascent Link,Ascent Type,Route Grade,Ascent Grade,Route Gear Style,Ascent Gear Style,Route Height,Ascent Height,# Ascents,Route Stars,Route ID,Route Link,Country,Country Link,Crag Name,Crag Link,Crag Path,With,Comment,Quality,Ascent Date,Log Date,Shot",
    "Solar impulse (L1),,15093692820,http://www.thecrag.com/ascent/15093692820,Onsight,7b,,Sport,Sport,25m,,1,**,2324861151,http://www.thecrag.com/route/2324861151,France,http://www.thecrag.com/area/11747155,La Balme,http://www.thecrag.com/area/563077002,La Balme - Cathédrale: Sector 5 & 6,,,,2026-11-08T00:00:00Z,2026-11-08T21:26:35Z,",
    "Globetrotter,,10082892903,http://www.thecrag.com/ascent/10082892903,Send,7A,,Boulder,Boulder,,,1,**,1041329673,http://www.thecrag.com/route/1041329673,Switzerland,http://www.thecrag.com/area/11747203,Chironico,http://www.thecrag.com/area/1033400739,Chironico - Boogalagga - Blocco 11,,,Very Good,2024-08-04T00:00:00Z,2024-08-04T19:33:04Z,",
  ].join("\n");

  it("parses MountainProject exports with mapped styles and crag names", () => {
    const parsed = parseTickCsv(mountainProject);
    expect(parsed?.format).toBe("mountainproject");
    expect(parsed?.errors).toEqual([]);
    expect(parsed?.ticks).toEqual([
      {
        routeName: "Death in the Afternoon",
        grade: "5.12a",
        cragName: "Hemingway Wall",
        location: "International > North America > Canada > Alberta > Bow Valley > Grotto Canyon > Hemingway Wall",
        style: "flash",
        date: "2026-07-26T00:00:00.000Z",
        notes: undefined,
      },
      {
        routeName: "Xanadu",
        grade: "5.10a",
        cragName: "The Narrows",
        location: "International > North America > Canada > Alberta > Bow Valley > Grotto Canyon > The Narrows",
        style: "onsight",
        date: "2026-07-24T00:00:00.000Z",
        notes: undefined,
      },
      {
        routeName: "Some Project",
        grade: "5.13a",
        cragName: "Baffin",
        location: "International > Canada > Baffin",
        style: "redpoint",
        date: "2026-07-20T00:00:00.000Z",
        notes: "crux is heady",
      },
    ]);
  });

  it("parses TheCrag exports with mapped styles", () => {
    const parsed = parseTickCsv(theCrag);
    expect(parsed?.format).toBe("thecrag");
    expect(parsed?.errors).toEqual([]);
    expect(parsed?.ticks).toMatchObject([
      { routeName: "Solar impulse (L1)", grade: "7b", cragName: "La Balme", style: "onsight" },
      { routeName: "Globetrotter", grade: "7A", cragName: "Chironico", style: "redpoint" },
    ]);
  });

  it("returns undefined for unknown formats", () => {
    expect(parseTickCsv("foo,bar\n1,2")).toBeUndefined();
  });

  it("reports rows without a route name as errors", () => {
    const parsed = parseTickCsv(`${theCrag}\n,,15093692820,,Onsight,7b,,,,,,,,,,,,,,,,,,,2026-11-08T00:00:00Z,,`);
    expect(parsed?.ticks).toHaveLength(2);
    expect(parsed?.errors).toHaveLength(1);
  });
});
