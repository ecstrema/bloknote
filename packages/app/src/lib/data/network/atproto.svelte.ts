import { browser } from "$app/env";
import type { AscentStyle, TickRecord } from "@bloknote/common";
import type { OsmFeature } from "osm-api";

const STORAGE_KEY = "bloknote:atproto-session";
const TICKS_STORAGE_KEY = "bloknote:atproto-ticks";

export interface AtProtoSession {
  did: string;
  pdsUrl: string;
  handle?: string;
}

function loadSession(): AtProtoSession | undefined {
  if (!browser) return undefined;
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (raw && typeof raw.did === "string" && typeof raw.pdsUrl === "string") return raw;
  } catch {
    // Ignore invalid storage
  }
  return undefined;
}

class AtProtoClient {
  session = $state<AtProtoSession | undefined>(loadSession());

  get configured(): boolean {
    return !!this.session;
  }

  setSession(session: AtProtoSession | undefined) {
    this.session = session;
    if (!browser) return;
    if (session) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  async addBulkTicks(features: OsmFeature[], style: AscentStyle, comment?: string): Promise<TickRecord[]> {
    if (!this.session) throw new Error("ATProto is not configured");
    const now = new Date().toISOString();
    const records: TickRecord[] = features
      .filter((f) => f.id > 0)
      .map((f) => ({
        subject: { type: f.type, id: f.id },
        style,
        climbedAt: now,
        createdAt: now,
        ...(comment?.trim() ? { comment: comment.trim() } : {}),
      }));

    if (browser && records.length > 0) {
      const existing: TickRecord[] = JSON.parse(localStorage.getItem(TICKS_STORAGE_KEY) ?? "[]");
      localStorage.setItem(TICKS_STORAGE_KEY, JSON.stringify([...existing, ...records]));
    }
    return records;
  }
}

export const atproto = new AtProtoClient();