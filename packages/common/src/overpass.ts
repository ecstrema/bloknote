/**
 * Only the official Overpass instance is used: mirrors are not synchronized, so data
 * could go backwards between fetches (issue #149). The official instance can be slow
 * or busy — callers must retry instead of falling back to another server.
 */
export const OVERPASS_ENDPOINTS = ["https://overpass-api.de/api/interpreter"] as const;

export async function tryOverpassInstances<T>(request: (endpoint: string) => Promise<T>): Promise<T> {
  const failures: string[] = [];

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      return await request(endpoint);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error;
      failures.push(`${endpoint}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`Overpass failed. ${failures.join("; ")}`);
}
