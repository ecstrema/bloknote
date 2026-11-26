if (!Map.prototype.getOrInsertComputed) {
  Map.prototype.getOrInsertComputed = function (key, callback) {
    if (this.has(key)) {
      return this.get(key);
    }
    const value = callback(key);
    this.set(key, value);
    return value;
  };
}
if (!Map.prototype.getOrInsert) {
  Map.prototype.getOrInsert = function (key, value) {
    if (this.has(key)) {
      return this.get(key);
    }
    this.set(key, value);
    return value;
  };
}

import { existsSync } from "fs";
import { rm } from "fs/promises";
import { CLIFFS_DATA_FILE, CLIMBING_DATA_FILE, OUT_DIR } from "./config.ts";
import { downloadCliffsData, generateCliffFiles } from "./cliffs.ts";
import { downloadClimbingData } from "./download.ts";
import { generateStaticAPI } from "./static-api-generator.ts";

import { DATA_DIR as REVERSE_GEOCODING_DATA_DIR, HIERARCHY_INDEX } from "@bloknote/reverse-geocoding-data";

const climbingDataFile = await downloadClimbingData(CLIMBING_DATA_FILE, {
  force: process.argv.includes("--refresh"),
});

// Keep the current API available if downloading the source data fails.
if (existsSync(OUT_DIR)) {
  console.log(`Deleting existing output directory at ${OUT_DIR}`);
  await rm(OUT_DIR, { recursive: true, force: true });
}

await generateStaticAPI({
  geoIndexFile: HIERARCHY_INDEX,
  osmDataFiles: [climbingDataFile],
  outApiDirectory: OUT_DIR,
  reverseGeocodingDataDirectory: REVERSE_GEOCODING_DATA_DIR,
});

// Cliffs are auxiliary data (issue #55): a failed download must not break the climbing API,
// which was already generated above.
try {
  const cliffsDataFile = await downloadCliffsData(CLIFFS_DATA_FILE, {
    force: process.argv.includes("--refresh-cliffs"),
  });
  await generateCliffFiles({
    geoIndexFile: HIERARCHY_INDEX,
    reverseGeocodingDataDirectory: REVERSE_GEOCODING_DATA_DIR,
    cliffsDataFile,
    outApiDirectory: OUT_DIR,
  });
} catch (e) {
  console.warn(`Skipping the cliffs files (issue #55): ${e instanceof Error ? e.message : e}`);
}
