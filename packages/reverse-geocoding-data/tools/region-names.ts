// Writes output/region-names.json: the name of every region of the hierarchy in each language, taken
// from the OSM tags kept in data/ (leaves) and Intl.DisplayNames (countries). `bun run region-names`.
// The position in the array is the id of the region (`nameId` in the static API), keep the order.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BOUNDARY_EXTENSION, DATA_DIR, HIERARCHY_INDEX, OUTPUT_DIR, slugify } from "../src/index.ts";

export const LANGUAGES = ["en", "de", "fr", "es", "it", "pt"] as const;
export type RegionName = { path: string } & Record<(typeof LANGUAGES)[number], string>;

const CONTINENTS: Record<string, Record<string, string>> = {
  "americas/north": {
    en: "North America",
    de: "Nordamerika",
    fr: "Amérique du Nord",
    es: "Norteamérica",
    it: "America del Nord",
    pt: "América do Norte",
  },
  "americas/south": {
    en: "South America",
    de: "Südamerika",
    fr: "Amérique du Sud",
    es: "Sudamérica",
    it: "America del Sud",
    pt: "América do Sul",
  },
  "americas/central": {
    en: "Central America",
    de: "Mittelamerika",
    fr: "Amérique centrale",
    es: "Centroamérica",
    it: "America centrale",
    pt: "América Central",
  },
  "americas/antilles": {
    en: "Antilles",
    de: "Antillen",
    fr: "Antilles",
    es: "Antillas",
    it: "Antille",
    pt: "Antilhas",
  },
  world: { en: "World", de: "Welt", fr: "Monde", es: "Mundo", it: "Mondo", pt: "Mundo" },
  africa: { en: "Africa", de: "Afrika", fr: "Afrique", es: "África", it: "Africa", pt: "África" },
  americas: { en: "Americas", de: "Amerika", fr: "Amériques", es: "América", it: "Americhe", pt: "Américas" },
  asia: { en: "Asia", de: "Asien", fr: "Asie", es: "Asia", it: "Asia", pt: "Ásia" },
  europe: { en: "Europe", de: "Europa", fr: "Europe", es: "Europa", it: "Europa", pt: "Europa" },
  oceania: { en: "Oceania", de: "Ozeanien", fr: "Océanie", es: "Oceanía", it: "Oceania", pt: "Oceania" },
};
const displayNames = Object.fromEntries(LANGUAGES.map((l) => [l, new Intl.DisplayNames(l, { type: "region" })]));

const countryCodeBySlug = new Map<string, string>();
for (let a = 65; a <= 90; a++) {
  for (let b = 65; b <= 90; b++) {
    const code = String.fromCharCode(a, b);
    const name = displayNames.en!.of(code);
    if (name && name !== code) countryCodeBySlug.set(slugify(name), code);
  }
}

type Tags = Record<string, string>;
/** Without the other languages of bilingual names ("Cymru / Wales") */
const first = (name: string | undefined) => name?.split("/")[0]?.trim() || undefined;

function walk(node: Record<string, any>, path: string[], out: string[]) {
  for (const key of Object.keys(node)) {
    if (key === "_bbox") continue;
    out.push([...path, key].join("/"));
    walk(node[key], [...path, key], out);
  }
}

function leafTags(path: string): Tags | undefined {
  const file = `${DATA_DIR}/${path}${BOUNDARY_EXTENSION}`;
  if (!existsSync(file)) return;
  const features: any[] = JSON.parse(readFileSync(file, "utf8")).features;
  return features.find((f) => f.properties?.name)?.properties;
}

function findDescendantCountryCode(dir: string): string | undefined {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isFile() && entry.name.endsWith(BOUNDARY_EXTENSION)) {
      const props = JSON.parse(readFileSync(fullPath, "utf8")).features?.[0]?.properties as Tags | undefined;
      const iso2 = props?.["ISO3166-2"]?.split("-")[0];
      if (iso2 && /^[A-Z]{2}$/.test(iso2)) return iso2;
    } else if (entry.isDirectory()) {
      const code = findDescendantCountryCode(fullPath);
      if (code) return code;
    }
  }
}

const title = (slug: string) => slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

function nameOf(path: string): RegionName {
  const slug = path.split("/").at(-1)!;
  const continent = CONTINENTS[path.replace(/^world\//, "")];
  if (continent) return { path, ...continent } as RegionName;

  const tags = leafTags(path) ?? {};
  const isCountryLevel =
    path.startsWith("world/americas/") ? path.split("/").length === 4 : path.split("/").length === 3;
  const country =
    (tags["ISO3166-1"] && /^[A-Z]{2}$/.test(tags["ISO3166-1"]) ? tags["ISO3166-1"] : undefined) ||
    (isCountryLevel ? countryCodeBySlug.get(slug) ?? findDescendantCountryCode(`${DATA_DIR}/${path}`) : undefined);

  const result: Record<string, string> = {};
  for (const lang of LANGUAGES) {
    result[lang] =
      (country && displayNames[lang]!.of(country)) ||
      first(tags[`name:${lang}`]) ||
      (lang === "en" ? first(tags.int_name) || first(tags.name) : undefined) ||
      result.en ||
      title(slug);
  }
  return { path, ...result } as RegionName;
}

const index = JSON.parse(readFileSync(HIERARCHY_INDEX, "utf8"));
const paths: string[] = [];
walk(index, [], paths);
const names = paths.map(nameOf);
writeFileSync(`${OUTPUT_DIR}/region-names.json`, JSON.stringify(names));
console.log(`${names.length} regions written`);