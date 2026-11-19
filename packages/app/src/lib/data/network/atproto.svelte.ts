import { browser } from "$app/env";
import type { AscentStyle, OsmElementRef, ReviewRecord, StarRecord, TickRecord } from "@bloknote/common";
import {
  BrowserOAuthClient,
  TokenInvalidError,
  TokenRefreshError,
  TokenRevokedError,
  type OAuthSession,
} from "@atproto/oauth-client-browser";
import type { OsmFeature } from "osm-api";

const BASE = "/bloknote";
const SESSION_STORAGE_KEY = "bloknote:atproto-session";
const TICKS_STORAGE_KEY = "bloknote:atproto-ticks";
const STARS_STORAGE_KEY = "bloknote:atproto-stars";
const REVIEWS_STORAGE_KEY = "bloknote:atproto-reviews";

const TICK_COLLECTION = "org.bloknote.logbook.tick";
const STAR_COLLECTION = "org.openstreetmap.star";
const REVIEW_COLLECTION = "org.openstreetmap.review";

/**
 * The `client_id` of the deployed app: it points to the client metadata hosted
 * at static/client-metadata.json, which the OAuth server fetches to validate
 * the client. It must stay in sync with that file.
 */
const PRODUCTION_CLIENT_ID = "https://ecstrema.github.io/bloknote/client-metadata.json";
/** Full repository access on the user's PDS (ticks, stars, reviews, profile) */
const OAUTH_SCOPE = "atproto transition:generic";

export interface AtProtoSession {
  did: string;
  handle?: string;
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
  const raw = readJson<AtProtoSession | null>(SESSION_STORAGE_KEY, null);
  if (raw && typeof raw.did === "string") return raw;
  return undefined;
}

export function sameElementRef(a: OsmElementRef, b: OsmElementRef): boolean {
  return a.type === b.type && a.id === b.id;
}

function createOAuthClient(): Promise<BrowserOAuthClient> {
  const redirectUri = `${location.origin}${BASE}/settings`;
  // Loopback clients (localhost dev) use the special hardcoded client_id, while
  // the deployed app points to its hosted client-metadata.json
  const clientId = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)
    ? `http://localhost?redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(OAUTH_SCOPE)}`
    : PRODUCTION_CLIENT_ID;
  return BrowserOAuthClient.load({ clientId, handleResolver: "https://bsky.social" });
}

interface ListRecordsResponse<T> {
  records?: { uri: string; value: T }[];
  cursor?: string;
}

class AtProtoClient {
  session = $state<AtProtoSession | undefined>(loadSession());
  ticks = $state<LocalTickEntry[]>(readJson<LocalTickEntry[]>(TICKS_STORAGE_KEY, []));
  stars = $state<LocalStarEntry[]>(readJson<LocalStarEntry[]>(STARS_STORAGE_KEY, []));
  reviews = $state<LocalReviewEntry[]>(readJson<LocalReviewEntry[]>(REVIEWS_STORAGE_KEY, []));

  #client?: BrowserOAuthClient;
  #oauthSession?: OAuthSession;
  #ready?: Promise<void>;

  constructor() {
    if (browser) {
      // Drop legacy app-password sessions: logging in now requires the full
      // OAuth flow and no longer uses credentials stored in localStorage
      const legacy = localStorage.getItem(SESSION_STORAGE_KEY);
      if (legacy && legacy.includes("accessJwt")) localStorage.removeItem(SESSION_STORAGE_KEY);
      this.#start();
    }
  }

  get configured(): boolean {
    return !!this.session;
  }

  /** Completes the OAuth callback / restores the last session, then hydrates records from the PDS */
  async #start(): Promise<void> {
    this.#ready ??= (async () => {
      this.#client ??= await createOAuthClient();
      const result = await this.#client.init();
      if (result) await this.#activate(result.session);
    })();
    try {
      await this.#ready;
    } catch (error) {
      console.error("ATProto session initialization failed", error);
      this.#oauthSession = undefined;
      this.session = undefined;
    }
  }

  async #activate(oauthSession: OAuthSession) {
    this.#oauthSession = oauthSession;
    const stored = loadSession();
    const handle =
      stored?.did === oauthSession.did ? stored.handle : await this.#fetchHandle(oauthSession.did);
    this.session = { did: oauthSession.did, handle };
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(this.session));
    await this.#hydrate();
  }

  async #fetchHandle(did: string): Promise<string | undefined> {
    try {
      const res = await this.#xrpc(`/xrpc/com.atproto.repo.describeRepo?repo=${encodeURIComponent(did)}`);
      if (!res.ok) return undefined;
      const data = (await res.json()) as { handle?: string };
      return data.handle || undefined;
    } catch {
      return undefined;
    }
  }

  #clearSession() {
    this.#oauthSession = undefined;
    this.session = undefined;
    if (browser) localStorage.removeItem(SESSION_STORAGE_KEY);
  }

  /** XRPC call against the user's PDS via the DPoP-bound OAuth session */
  async #xrpc(path: string, init?: RequestInit): Promise<Response> {
    const session = this.#oauthSession;
    if (!session) throw new Error("ATProto is not configured");
    try {
      return await session.fetchHandler(path, init);
    } catch (error) {
      if (error instanceof TokenRevokedError || error instanceof TokenInvalidError || error instanceof TokenRefreshError) {
        this.#clearSession();
        throw new Error("Your ATProto session has expired, please log in again");
      }
      throw error;
    }
  }

  /** Pulls the records stored in the user's ATProto repository (PDS): it is the source of truth */
  async #hydrate() {
    const session = this.#oauthSession;
    if (!session) return;
    try {
      const [remoteTicks, remoteStars, remoteReviews] = await Promise.all([
        this.#listRemote<TickRecord>(TICK_COLLECTION),
        this.#listRemote<StarRecord>(STAR_COLLECTION),
        this.#listRemote<ReviewRecord>(REVIEW_COLLECTION),
      ]);
      // Keep the cached labels and the local-only entries (never uploaded), then let the PDS win
      const merge = <T extends { uri?: string; label?: string }>(local: T[], remote: T[]): T[] => {
        const labels = new Map(local.filter((e) => e.uri).map((e) => [e.uri!, e.label]));
        const localOnly = local.filter((e) => !e.uri);
        return [...remote, ...localOnly].map((e) => ({ ...e, label: e.label ?? (e.uri ? labels.get(e.uri) : undefined) }));
      };
      this.ticks = merge(this.ticks, remoteTicks as LocalTickEntry[]);
      this.stars = merge(this.stars, remoteStars as LocalStarEntry[]);
      this.reviews = merge(this.reviews, remoteReviews as LocalReviewEntry[]);
      this.#persistTicks();
      this.#persistStars();
      this.#persistReviews();
    } catch (error) {
      console.error("Could not load ATProto records from the PDS", error);
    }
  }

  async #listRemote<T>(collection: string): Promise<T[]> {
    const session = this.#oauthSession;
    if (!session) throw new Error("ATProto is not configured");
    const out: T[] = [];
    let cursor: string | undefined;
    do {
      const query = new URLSearchParams({ repo: session.did, collection, limit: "100" });
      if (cursor) query.set("cursor", cursor);
      const res = await this.#xrpc(`/xrpc/com.atproto.repo.listRecords?${query}`);
      if (!res.ok) throw new Error(`Could not list ${collection} (HTTP ${res.status})`);
      const data = (await res.json()) as ListRecordsResponse<T>;
      for (const record of data.records ?? []) out.push(record.value);
      cursor = data.cursor;
    } while (cursor);
    return out;
  }

  /** Starts the ATProto OAuth flow: the user is redirected to their data server to authorize the app */
  async signIn(handle: string): Promise<void> {
    await this.#start();
    const cleaned = handle.trim().replace(/^@/, "");
    if (!cleaned) throw new Error("Enter your ATProto handle or DID");
    if (!this.#client) throw new Error("ATProto is only available in the browser");
    // Never resolves on success: the browser navigates away, and the session is
    // activated by #start() once the OAuth server redirects back to /settings
    await this.#client.signIn(cleaned);
  }

  async disconnect(): Promise<void> {
    await this.#start();
    const session = this.#oauthSession;
    this.#oauthSession = undefined;
    this.session = undefined;
    localStorage.removeItem(SESSION_STORAGE_KEY);
    if (session) await session.signOut().catch(() => {});
  }

  async #createRemoteRecord(collection: string, record: object): Promise<string> {
    const session = this.#oauthSession;
    if (!session) throw new Error("ATProto is not configured");
    const res = await this.#xrpc("/xrpc/com.atproto.repo.createRecord", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repo: session.did,
        collection,
        record: { $type: collection, ...record },
      }),
    });
    if (!res.ok) throw new Error(`Could not save the record to your ATProto repository (HTTP ${res.status})`);
    const data = (await res.json()) as { uri?: string };
    if (!data.uri) throw new Error("Your ATProto repository did not return a record URI");
    return data.uri;
  }

  async #deleteRemoteRecord(collection: string, uri: string) {
    const session = this.#oauthSession;
    if (!session) throw new Error("ATProto is not configured");
    const rkey = uri.split("/").at(-1);
    if (!rkey) throw new Error(`Invalid record URI: ${uri}`);
    const res = await this.#xrpc("/xrpc/com.atproto.repo.deleteRecord", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo: session.did, collection, rkey }),
    });
    if (!res.ok) throw new Error(`Could not delete the record from your ATProto repository (HTTP ${res.status})`);
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
      record.uri = await this.#createRemoteRecord(TICK_COLLECTION, {
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
      if (existing.uri) await this.#deleteRemoteRecord(STAR_COLLECTION, existing.uri);
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
      entry.uri = await this.#createRemoteRecord(STAR_COLLECTION, {
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
      entry.uri = await this.#createRemoteRecord(REVIEW_COLLECTION, {
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