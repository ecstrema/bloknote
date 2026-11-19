import { existsSync, statSync } from "fs";
import { readFile } from "fs/promises";

import { downloadClimbingData, postOverpass } from "./download.ts";
import { parseWorldClimbingPoints, type WorldClimbingPoints } from "./world-points.ts";

export * from "./world-points.ts";
export { postOverpass };

/**
 * State shared by every instance of this module: Vite reloads it on each change during
 * development, and each reload must not start another download nor bypass the cache.
 */
interface SharedState {
  job?: DownloadJob;
  cached?: { filePath: string; mtimeMs: number; data: WorldClimbingPoints };
}
const shared: SharedState = ((globalThis as any).__bloknoteWorldClimbing ??= {});

export interface WorldDownloadStatus {
  /** ISO date at which the download started */
  startedAt: string;
  /** Last error, if the query is being retried */
  retrying?: string;
  /** Set when the download failed for good */
  error?: string;
}

interface DownloadJob {
  status: WorldDownloadStatus;
  promise: Promise<WorldClimbingPoints>;
}

async function readClimbingPoints(filePath: string): Promise<WorldClimbingPoints> {
  const mtimeMs = statSync(filePath).mtimeMs;
  if (shared.cached?.filePath === filePath && shared.cached.mtimeMs === mtimeMs) {
    return shared.cached.data;
  }
  const data = parseWorldClimbingPoints(JSON.parse(await readFile(filePath, "utf8")));
  shared.cached = { filePath, mtimeMs, data };
  return data;
}

/**
 * Returns the climbing places of the whole world derived from `climbingDataFile`. When it is not
 * cached yet (or with `force`), starts downloading it in the background, once whatever the
 * number of callers, and returns the progress instead.
 */
export async function getWorldClimbingPoints(
  climbingDataFile: string,
  { force = false } = {},
): Promise<{ data: WorldClimbingPoints } | { status: WorldDownloadStatus }> {
  const job = shared.job;
  if (job && !job.status.error) return { status: job.status };
  if (!force && !job && existsSync(climbingDataFile)) {
    return { data: await readClimbingPoints(climbingDataFile) };
  }

  const status: WorldDownloadStatus = { startedAt: new Date().toISOString() };
  const promise = (async () => {
    await downloadClimbingData(climbingDataFile, {
      force,
      onRetry: (error) => (status.retrying = error),
    });
    return readClimbingPoints(climbingDataFile);
  })();

  shared.job = { status, promise };
  promise.then(
    () => shared.job?.promise === promise && (shared.job = undefined),
    (e) => (status.error = e instanceof Error ? e.message : String(e)),
  );
  return { status };
}
