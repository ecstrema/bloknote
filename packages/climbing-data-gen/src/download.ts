import { existsSync } from "fs";
import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { request } from "https";
import { dirname } from "path";
import { USER_AGENT } from "@bloknote/reverse-geocoding-data";
import { tryOverpassInstances } from "@bloknote/common";

import { WORLD_CLIMBING_QUERY } from "./world-points.ts";

const GLOBAL_RETRIES = 10;
const GLOBAL_RETRY_DELAY = 60_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * POSTs the query with `https` rather than `fetch`: `fetch` gives up when the response headers
 * take more than 5 minutes, and Overpass sends them only when the query is done.
 */
export function postOverpass(query: string, validateResponse?: (data: any) => void): Promise<string> {
  return tryOverpassInstances(async (endpoint) => {
    const body = await postOverpassToEndpoint(query, endpoint);
    const data = JSON.parse(body);
    if (!Array.isArray(data.elements) || data.remark?.toLowerCase().includes("error")) {
      throw new Error(data.remark || "Overpass returned an invalid response");
    }
    validateResponse?.(data);
    return body;
  });
}

function postOverpassToEndpoint(query: string, endpoint: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = request(
      endpoint,
      {
        method: "POST",
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/json",
          "Content-Type": "text/plain; charset=utf-8",
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("error", reject);
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          if (res.statusCode === 200) resolve(body);
          else reject(new Error(`${res.statusCode} ${res.statusMessage}: ${body.slice(0, 500)}`));
        });
      },
    );
    req.on("error", reject);
    req.end(query);
  });
}

/** Downloads and caches one worldwide Overpass result instead of splitting it into tiles. */
export async function downloadClimbingData(
  outputFilePath: string,
  { force = false, onRetry }: { force?: boolean; onRetry?: (error: string) => void } = {},
): Promise<string> {
  if (!force && existsSync(outputFilePath)) {
    const cached = JSON.parse(await readFile(outputFilePath, "utf8"));
    if (Array.isArray(cached.elements)) {
      console.log(`Using cached worldwide climbing data from ${outputFilePath}`);
      return outputFilePath;
    }
    throw new Error(`Invalid climbing data cache: ${outputFilePath}`);
  }

  console.log("Downloading worldwide climbing data in one Overpass query...");
  let data: any;
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await postOverpass(WORLD_CLIMBING_QUERY, (result) => {
        if (result.remark) {
          throw new Error(`Overpass returned incomplete climbing data: ${result.remark}`);
        }
      });
      data = JSON.parse(response);
      break;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (attempt >= GLOBAL_RETRIES) throw new Error(`Failed to download worldwide climbing data: ${message}`);
      const warning = `Overpass failed (${message.slice(0, 300)}), retrying in ${GLOBAL_RETRY_DELAY / 1000} s (${GLOBAL_RETRIES - attempt} tries left)`;
      console.warn(warning);
      onRetry?.(warning);
      await sleep(GLOBAL_RETRY_DELAY);
    }
  }

  await mkdir(dirname(outputFilePath), { recursive: true });
  const temporaryPath = `${outputFilePath}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(data));
  await rename(temporaryPath, outputFilePath);
  console.log(`Saved ${data.elements.length} elements to ${outputFilePath}`);
  return outputFilePath;
}
