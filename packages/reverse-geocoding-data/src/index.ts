import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

export * from "./shared.ts";

export interface BoundingBox {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/**
 * A node of hierarchy-index.json. The other keys are the children, by slug. A node without
 * children is a leaf: its boundary is `data/<path>.geojson`.
 */
export interface IndexNode {
  _bbox: BoundingBox;
  [key: string]: any;
}

/** Committed boundaries of the whole world. See the readme. */
export const DATA_DIR = resolve(import.meta.dirname, "../data");
export const OUTPUT_DIR = resolve(import.meta.dirname, "../output");
export const HIERARCHY_INDEX = resolve(OUTPUT_DIR, "hierarchy-index.json");
export const USER_AGENT = "bloknote/1.0";

export function ensureDirExists(dir: string): void {
  mkdirSync(dir, { recursive: true });
}
