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

/**
 * Runs one Overpass query, retrying up to `GLOBAL_RETRIES` times with `GLOBAL_RETRY_DELAY`
 * between attempts. Returns the parsed JSON of a valid response.
 */
export async function postOverpassWithRetries(
  query: string,
  { subject, onRetry }: { subject: string; onRetry?: (error: string) => void } = { subject: "Overpass data" },
): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await postOverpass(query, (result) => {
        if (result.remark) {
          throw new Error(`Overpass returned an incomplete result: ${result.remark}`);
        }
      });
      return JSON.parse(response);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (attempt >= GLOBAL_RETRIES) throw new Error(`Failed to download ${subject}: ${message}`);
      const warning = `Overpass failed (${message.slice(0, 300)}), retrying in ${GLOBAL_RETRY_DELAY / 1000} s (${GLOBAL_RETRIES - attempt} tries left)`;
      console.warn(warning);
      onRetry?.(warning);
      await sleep(GLOBAL_RETRY_DELAY);
    }
  }
}

/** Downloads and caches one worldwide Overpass result instead of splitting it into tiles. */
export async function downloadOverpassData(
  query: string,
  outputFilePath: string,
  { force = false, onRetry, subject }: { force?: boolean; onRetry?: (error: string) => void; subject: string },
): Promise<string> {
  if (!force && existsSync(outputFilePath)) {
    const cached = JSON.parse(await readFile(outputFilePath, "utf8"));
    if (Array.isArray(cached.elements)) {
      console.log(`Using cached ${subject} from ${outputFilePath}`);
      return outputFilePath;
    }
    throw new Error(`Invalid ${subject} cache: ${outputFilePath}`);
  }

  console.log(`Downloading worldwide ${subject} in one Overpass query...`);
  const data = await postOverpassWithRetries(query, { subject, onRetry });

  await mkdir(dirname(outputFilePath), { recursive: true });
  const temporaryPath = `${outputFilePath}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(data));
  await rename(temporaryPath, outputFilePath);
  console.log(`Saved ${data.elements.length} elements to ${outputFilePath}`);
  return outputFilePath;
}

/** Downloads and caches one worldwide Overpass result instead of splitting it into tiles. */
export async function downloadClimbingData(
  outputFilePath: string,
  { force = false, onRetry }: { force?: boolean; onRetry?: (error: string) => void } = {},
): Promise<string> {
  return downloadOverpassData(WORLD_CLIMBING_QUERY, outputFilePath, {
    force,
    onRetry,
    subject: "climbing data",
  });
}
