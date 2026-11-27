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
    'Date,Route,Rating,Notes,URL,Pitches,Location,"Avg Stars","Your Stars",Style,"Lead Style","Route Type","Your Rating",Length,"Rating Code"',
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
        area: "International > North America > Canada > Alberta > Bow Valley > Grotto Canyon > Hemingway Wall",
        routeType: "Sport",
        style: "flash",
        date: "2026-07-26T00:00:00.000Z",
        notes: undefined,
      },
      {
        routeName: "Xanadu",
        grade: "5.10a",
        cragName: "The Narrows",
        location: "International > North America > Canada > Alberta > Bow Valley > Grotto Canyon > The Narrows",
        area: "International > North America > Canada > Alberta > Bow Valley > Grotto Canyon > The Narrows",
        routeType: "Sport",
        style: "onsight",
        date: "2026-07-24T00:00:00.000Z",
        notes: undefined,
      },
      {
        routeName: "Some Project",
        grade: "5.13a",
        cragName: "Baffin",
        location: "International > Canada > Baffin",
        area: "International > Canada > Baffin",
        routeType: "Sport",
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
      {
        routeName: "Solar impulse (L1)",
        grade: "7b",
        cragName: "La Balme",
        area: "La Balme - Cathédrale: Sector 5 & 6",
        routeType: "Sport",
        style: "onsight",
      },
      {
        routeName: "Globetrotter",
        grade: "7A",
        cragName: "Chironico",
        area: "Chironico - Boogalagga - Blocco 11",
        routeType: "Boulder",
        style: "redpoint",
      },
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

  const eightANu = [
    "route_boulder,name,location_name,sector_name,area_name,country_code,date,type,sub_type,rating,project,tries,repeats,difficulty,perceived_hardness,comment,height,recommended,sits",
    'BOULDER,Globetrotter,Chironico,Boogalagga,Ticino,CH,2024-08-04 12:00:00,rp,,4,0,20,0,7A,0,"",,0,',
    'ROUTE,Remember Wadi Rum ***,Ghost Kitchen,Ghost Kitchen main,Kalymnos,GR,2024-08-31 12:00:00,os,"",5,0,1,0,6c,0,,25,0,0',
  ].join("\n");

  it("parses 8a.nu exports with crag/sector locations and abbreviated styles", () => {
    const parsed = parseTickCsv(eightANu);
    expect(parsed?.format).toBe("8anu");
    expect(parsed?.errors).toEqual([]);
    expect(parsed?.ticks).toEqual([
      {
        routeName: "Globetrotter",
        grade: "7A",
        cragName: "Chironico",
        area: "Boogalagga",
        location: "CH > Ticino > Chironico > Boogalagga",
        routeType: "BOULDER",
        style: "redpoint",
        date: "2024-08-04T00:00:00.000Z",
        notes: undefined,
      },
      {
        routeName: "Remember Wadi Rum ***",
        grade: "6c",
        cragName: "Ghost Kitchen",
        area: "Ghost Kitchen main",
        location: "GR > Kalymnos > Ghost Kitchen > Ghost Kitchen main",
        routeType: "ROUTE",
        style: "onsight",
        date: "2024-08-31T00:00:00.000Z",
        notes: undefined,
      },
    ]);
  });

  const sendage = [
    '"These climbs were exported from Sendage Climbing.",http://sendage.com',
    "L,2023-06-01",
    "",
    'Date,"Send Type",Climb,"Climb Type",Grade,Area,Country,Rating,Comments',
    '2023-06-01,flash,"Death Chute",boulder,V4,"The Crops",,,',
    ',redpoint,"Dazed and Confused",boulder,V8,"The Crops",,,',
  ].join("\n");

  it("parses Sendage exports with their preamble and carried-down dates", () => {
    const parsed = parseTickCsv(sendage);
    expect(parsed?.format).toBe("sendage");
    expect(parsed?.errors).toEqual([]);
    expect(parsed?.ticks).toEqual([
      {
        routeName: "Death Chute",
        grade: "V4",
        cragName: "The Crops",
        area: "The Crops",
        location: "The Crops",
        routeType: "boulder",
        style: "flash",
        date: "2023-06-01T00:00:00.000Z",
        notes: undefined,
      },
      {
        routeName: "Dazed and Confused",
        grade: "V8",
        cragName: "The Crops",
        area: "The Crops",
        location: "The Crops",
        routeType: "boulder",
        style: "redpoint",
        date: "2023-06-01T00:00:00.000Z",
        notes: undefined,
      },
    ]);
  });

  const ukc = [
    "Name,Grade,Style,Partner(empty),Notes,Date,Crag,County,Region,Country,Pitches,Type",
    '"Five Gallon Buckets",5.8,Lead,,,31/May/23,"Smith Rock","OR Smith Rocks",Oregon,USA,1,Sport',
    '"Lion\'s Jaw",5.8,TR,,,02/Jun/23,"Squared Ledge",Essex,Massachusetts,USA,1,Trad',
  ].join("\n");

  it("parses UKClimbing exports with dd/Mon/yy dates", () => {
    const parsed = parseTickCsv(ukc);
    expect(parsed?.format).toBe("ukclimbing");
    expect(parsed?.errors).toEqual([]);
    expect(parsed?.ticks).toEqual([
      {
        routeName: "Five Gallon Buckets",
        grade: "5.8",
        cragName: "Smith Rock",
        area: "Smith Rock",
        location: "USA > Oregon > OR Smith Rocks > Smith Rock",
        routeType: "Sport",
        style: "redpoint",
        date: "2023-05-31T00:00:00.000Z",
        notes: undefined,
      },
      {
        routeName: "Lion's Jaw",
        grade: "5.8",
        cragName: "Squared Ledge",
        area: "Squared Ledge",
        location: "USA > Massachusetts > Essex > Squared Ledge",
        routeType: "Trad",
        style: "hangdog",
        date: "2023-06-02T00:00:00.000Z",
        notes: undefined,
      },
    ]);
  });

  const openClimbing = [
    "date,route_name,route_grade,grade_system,my_grade,style,note,crag,area,route_short_id,route_lon,route_lat",
    '"2026-11-27T13:45:27.385Z","Le Matin des Magiciens","5.12a","original","","OS","","Ligne Jaune","Mont Larose / Weir","n8088532936","-74.53008","45.945646"',
    '"2026-11-20T10:00:00.000Z","Another Route","6b+","original","","RP","crux runout","Some Crag","Some Area","w123","1.0","2.0"',
  ].join("\n");

  it("parses OpenClimbing exports with abbreviated styles", () => {
    const parsed = parseTickCsv(openClimbing);
    expect(parsed?.format).toBe("openclimbing");
    expect(parsed?.errors).toEqual([]);
    expect(parsed?.ticks).toEqual([
      {
        routeName: "Le Matin des Magiciens",
        grade: "5.12a",
        cragName: "Ligne Jaune",
        area: "Ligne Jaune",
        location: "Mont Larose / Weir > Ligne Jaune",
        routeType: undefined,
        style: "onsight",
        date: "2026-11-27T13:45:27.385Z",
        notes: undefined,
      },
      {
        routeName: "Another Route",
        grade: "6b+",
        cragName: "Some Crag",
        area: "Some Crag",
        location: "Some Area > Some Crag",
        routeType: undefined,
        style: "redpoint",
        date: "2026-11-20T10:00:00.000Z",
        notes: "crux runout",
      },
    ]);
  });
});
