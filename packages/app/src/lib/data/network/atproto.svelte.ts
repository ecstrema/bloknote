import { browser } from "$app/env";
import type { AscentStyle, OsmElementRef, ReviewRecord, StarRecord, TickRecord } from "@bloknote/common";
import type { OsmFeature } from "osm-api";

const STORAGE_KEY = "bloknote:atproto-session";
const TICKS_STORAGE_KEY = "bloknote:atproto-ticks";
const STARS_STORAGE_KEY = "bloknote:atproto-stars";
const REVIEWS_STORAGE_KEY = "bloknote:atproto-reviews";

export interface AtProtoSession {
  did: string;
  pdsUrl: string;
  handle?: string;
  accessJwt?: string;
  refreshJwt?: string;
}

export interface LocalStarEntry extends StarRecord {
  uri?: string;
  label?: string;
}

export interface LocalTickEntry extends TickRecord {
  uri?: string;
  label?: string;
}

export interface LocalReviewEntry extends ReviewRecord {
  uri?: string;
  author?: string;
  label?: string;
}

function readJson<T>(key: string, fallback: T): T {
  if (!browser) return fallback;
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? "null");
    return raw ?? fallback;
  } catch {
    return fallback;
  }
}

function loadSession(): AtProtoSession | undefined {
  const raw = readJson<AtProtoSession | null>(STORAGE_KEY, null);
  if (raw && typeof raw.did === "string" && typeof raw.pdsUrl === "string") return raw;
  return undefined;
}

export function sameElementRef(a: OsmElementRef, b: OsmElementRef): boolean {
  return a.type === b.type && a.id === b.id;
}

async function resolveDidFromHandle(handle: string): Promise<string> {
  const cleaned = handle.trim().replace(/^@/, "");
  if (cleaned.startsWith("did:")) return cleaned;
  const res = await fetch(
    `https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(cleaned)}`,
  );
  if (!res.ok) throw new Error(`Could not resolve ATProto handle "${cleaned}"`);
  const data = (await res.json()) as { did?: string };
  if (!data.did) throw new Error(`No DID returned for "${cleaned}"`);
  return data.did;
}

async function resolvePdsFromDid(did: string): Promise<string> {
  if (did.startsWith("did:plc:")) {
    const res = await fetch(`https://plc.directory/${encodeURIComponent(did)}`);
    if (!res.ok) throw new Error(`Could not resolve PDS for ${did}`);
    const doc = (await res.json()) as { service?: { id?: string; type?: string; serviceEndpoint?: string }[] };
    const svc = doc.service?.find((s) => s.type === "AtprotoPersonalDataServer" || s.id === "#atproto_pds");
    if (svc?.serviceEndpoint) return svc.serviceEndpoint.replace(/\/$/, "");
  } else if (did.startsWith("did:web:")) {
    const domain = did.slice("did:web:".length).replaceAll(":", "/");
    const res = await fetch(`https://${domain}/.well-known/did.json`);
    if (res.ok) {
      const doc = (await res.json()) as { service?: { id?: string; type?: string; serviceEndpoint?: string }[] };
      const svc = doc.service?.find((s) => s.type === "AtprotoPersonalDataServer" || s.id === "#atproto_pds");
      if (svc?.serviceEndpoint) return svc.serviceEndpoint.replace(/\/$/, "");
    }
  }
  throw new Error(`Could not locate ATProto PDS for ${did}`);
}

class AtProtoClient {
  session = $state<AtProtoSession | undefined>(loadSession());
  ticks = $state<LocalTickEntry[]>(readJson<LocalTickEntry[]>(TICKS_STORAGE_KEY, []));
  stars = $state<LocalStarEntry[]>(readJson<LocalStarEntry[]>(STARS_STORAGE_KEY, []));
  reviews = $state<LocalReviewEntry[]>(readJson<LocalReviewEntry[]>(REVIEWS_STORAGE_KEY, []));

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

  async connect(identifier: string, appPassword?: string): Promise<AtProtoSession> {
    const trimmed = identifier.trim().replace(/^@/, "");
    if (!trimmed) throw new Error("Enter your ATProto handle or DID");
    const did = await resolveDidFromHandle(trimmed);
    const pdsUrl = await resolvePdsFromDid(did);
    let session: AtProtoSession = {
      did,
      pdsUrl,
      handle: trimmed.startsWith("did:") ? undefined : trimmed,
    };

    if (appPassword?.trim()) {
      const res = await fetch(`${pdsUrl}/xrpc/com.atproto.server.createSession`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: did, password: appPassword.trim() }),
      });
      const data = (await res.json()) as {
        accessJwt?: string;
        refreshJwt?: string;
        handle?: string;
        message?: string;
      };
      if (!res.ok || !data.accessJwt) {
        throw new Error(data.message ?? "Could not sign in to PDS");
      }
      session = {
        did,
        pdsUrl,
        handle: data.handle ?? session.handle,
        accessJwt: data.accessJwt,
        refreshJwt: data.refreshJwt,
      };
    }

    this.setSession(session);
    return session;
  }

  async #createRemoteRecord(collection: string, record: object): Promise<string | undefined> {
    if (!this.session?.accessJwt) return undefined;
    try {
      const res = await fetch(`${this.session.pdsUrl}/xrpc/com.atproto.repo.createRecord`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.session.accessJwt}`,
        },
        body: JSON.stringify({
          repo: this.session.did,
          collection,
          record: { $type: collection, ...record },
        }),
      });
      if (!res.ok) return undefined;
      const data = (await res.json()) as { uri?: string };
      return data.uri;
    } catch {
      return undefined;
    }
  }

  async #deleteRemoteRecord(collection: string, uri?: string) {
    if (!this.session?.accessJwt || !uri) return;
    const rkey = uri.split("/").at(-1);
    if (!rkey) return;
    try {
      await fetch(`${this.session.pdsUrl}/xrpc/com.atproto.repo.deleteRecord`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.session.accessJwt}`,
        },
        body: JSON.stringify({ repo: this.session.did, collection, rkey }),
      });
    } catch {
      // Best-effort remote delete
    }
  }

  #persistTicks() {
    if (browser) localStorage.setItem(TICKS_STORAGE_KEY, JSON.stringify(this.ticks));
  }

  #persistStars() {
    if (browser) localStorage.setItem(STARS_STORAGE_KEY, JSON.stringify(this.stars));
  }

  #persistReviews() {
    if (browser) localStorage.setItem(REVIEWS_STORAGE_KEY, JSON.stringify(this.reviews));
  }

  async addTick(feature: OsmFeature, style: AscentStyle, comment?: string): Promise<LocalTickEntry> {
    if (!this.session) throw new Error("ATProto is not configured");
    const now = new Date().toISOString();
    const record: LocalTickEntry = {
      subject: { type: feature.type, id: feature.id },
      style,
      climbedAt: now,
      createdAt: now,
      label: feature.tags?.name,
      ...(comment?.trim() ? { comment: comment.trim() } : {}),
    };
    if (feature.id > 0) {
      record.uri = await this.#createRemoteRecord("org.bloknote.logbook.tick", {
        subject: record.subject,
        style: record.style,
        climbedAt: record.climbedAt,
        createdAt: record.createdAt,
        ...(record.comment ? { comment: record.comment } : {}),
      });
    }
    this.ticks = [record, ...this.ticks];
    this.#persistTicks();
    return record;
  }

  async addBulkTicks(features: OsmFeature[], style: AscentStyle, comment?: string): Promise<TickRecord[]> {
    if (!this.session) throw new Error("ATProto is not configured");
    const created: LocalTickEntry[] = [];
    for (const feature of features.filter((f) => f.id > 0)) {
      created.push(await this.addTick(feature, style, comment));
    }
    return created;
  }

  isStarred(feature: OsmFeature): boolean {
    return this.stars.some((s) => sameElementRef(s.subject, { type: feature.type, id: feature.id }));
  }

  async toggleStar(feature: OsmFeature): Promise<boolean> {
    if (!this.session) throw new Error("ATProto is not configured");
    const ref: OsmElementRef = { type: feature.type, id: feature.id };
    const existing = this.stars.find((s) => sameElementRef(s.subject, ref));
    if (existing) {
      await this.#deleteRemoteRecord("org.openstreetmap.star", existing.uri);
      this.stars = this.stars.filter((s) => !sameElementRef(s.subject, ref));
      this.#persistStars();
      return false;
    }

    const entry: LocalStarEntry = {
      subject: ref,
      createdAt: new Date().toISOString(),
      label: feature.tags?.name,
    };
    if (feature.id > 0) {
      entry.uri = await this.#createRemoteRecord("org.openstreetmap.star", {
        subject: entry.subject,
        createdAt: entry.createdAt,
      });
    }
    this.stars = [entry, ...this.stars];
    this.#persistStars();
    return true;
  }

  async addReview(feature: OsmFeature, text: string, rating?: number): Promise<LocalReviewEntry> {
    if (!this.session) throw new Error("ATProto is not configured");
    const trimmed = text.trim();
    if (!trimmed && rating === undefined) throw new Error("Enter a comment or rating");
    const entry: LocalReviewEntry = {
      subject: { type: feature.type, id: feature.id },
      ...(trimmed ? { text: trimmed } : {}),
      ...(rating !== undefined ? { rating } : {}),
      createdAt: new Date().toISOString(),
      author: this.session.handle ?? this.session.did,
      label: feature.tags?.name,
    };
    if (feature.id > 0) {
      entry.uri = await this.#createRemoteRecord("org.openstreetmap.review", {
        subject: entry.subject,
        ...(entry.text ? { text: entry.text } : {}),
        ...(entry.rating !== undefined ? { rating: entry.rating } : {}),
        createdAt: entry.createdAt,
      });
    }
    this.reviews = [entry, ...this.reviews];
    this.#persistReviews();
    return entry;
  }
}

export const atproto = new AtProtoClient();