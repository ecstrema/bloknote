import { browser } from "$app/env";
import type { AscentStyle, CommentRecord, OsmElementRef, RatingRecord, StarRecord, TickRecord } from "@bloknote/common";
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
const COMMENTS_STORAGE_KEY = "bloknote:atproto-comments";
const RATINGS_STORAGE_KEY = "bloknote:atproto-ratings";
/** Pre-#163 combined review records, kept only to migrate old local caches */
const LEGACY_REVIEWS_STORAGE_KEY = "bloknote:atproto-reviews";

const TICK_COLLECTION = "org.bloknote.logbook.tick";
const STAR_COLLECTION = "org.openstreetmap.star";
const COMMENT_COLLECTION = "org.bloknote.comment";
const RATING_COLLECTION = "org.bloknote.rating";
/** Combined review collection used before #163: read-only, migrated into comments + ratings */
const LEGACY_REVIEW_COLLECTION = "org.openstreetmap.review";

/**
 * The `client_id` of the deployed app: it points to the client metadata hosted
 * at static/client-metadata.json, which the OAuth server fetches to validate
 * the client. It must stay in sync with that file.
 */
const PRODUCTION_CLIENT_ID = "https://ecstrema.github.io/bloknote/client-metadata.json";
/**
 * Minimal granular permissions: only create/delete records in the app's own
 * collections on the user's PDS (ticks, stars, comments, ratings). No broad repository
 * access, blobs, account, or identity permissions. Record listing
 * (com.atproto.repo.listRecords) is a public endpoint, so no read permission
 * is needed. Must stay in sync with static/client-metadata.json.
 */
const OAUTH_SCOPE =
  "atproto repo:org.bloknote.logbook.tick?action=create&action=delete repo:org.openstreetmap.star?action=create&action=delete repo:org.bloknote.comment?action=create&action=delete repo:org.bloknote.rating?action=create&action=delete";

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

export interface LocalCommentEntry extends CommentRecord {
  uri?: string;
  author?: string;
  label?: string;
}

export interface LocalRatingEntry extends RatingRecord {
  uri?: string;
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

/** Pre-#163 combined review record shape, used to migrate old local caches */
interface LegacyReviewEntry {
  subject: OsmElementRef;
  text?: string;
  rating?: number;
  createdAt: string;
  uri?: string;
  author?: string;
  label?: string;
}

function legacySignature(e: LegacyReviewEntry): string {
  return JSON.stringify({ subject: e.subject, text: e.text, rating: e.rating, createdAt: e.createdAt });
}

/**
 * One-time migration of the pre-#163 combined review caches (stars and comment shared a single
 * org.openstreetmap.review record) into the split comments and ratings stores. Each cached
 * review becomes a comment entry (when it has text) and/or a rating entry (when it has a
 * rating). Deduplicates against entries already migrated by a previous run.
 */
function migrateLegacyReviews<T extends LocalCommentEntry | LocalRatingEntry>(current: T[], part: "text" | "rating"): T[] {
  if (!browser) return current;
  const legacy = readJson<LegacyReviewEntry[]>(LEGACY_REVIEWS_STORAGE_KEY, []);
  if (legacy.length === 0) return current;
  const existing = new Set(current.map((e) => legacySignature(e)));
  const migrated = legacy
    .filter((r) => (part === "text" ? !!r.text : r.rating !== undefined))
    .map((r) =>
      part === "text"
        ? ({ subject: r.subject, text: r.text!, createdAt: r.createdAt, uri: r.uri, author: r.author, label: r.label } as T)
        : ({ subject: r.subject, rating: r.rating!, createdAt: r.createdAt, uri: r.uri, label: r.label } as T),
    )
    .filter((e) => !existing.has(legacySignature(e)));
  return migrated.length > 0 ? [...migrated, ...current] : current;
}

export function sameElementRef(a: OsmElementRef, b: OsmElementRef): boolean {
  return a.type === b.type && a.id === b.id;
}

function createOAuthClient(): Promise<BrowserOAuthClient> {
  // The OAuth server redirects back to this exact URI: it must stay registered in
  // static/client-metadata.json. The account route shows the newly connected account.
  const redirectUri = `${location.origin}${BASE}/settings/account`;
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

/** Extracts the human-readable error message from an XRPC error response body, if any */
async function xrpcErrorMessage(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { message?: string };
    return data.message ? `: ${data.message}` : "";
  } catch {
    return "";
  }
}

class AtProtoClient {
  session = $state<AtProtoSession | undefined>(loadSession());
  ticks = $state<LocalTickEntry[]>(readJson<LocalTickEntry[]>(TICKS_STORAGE_KEY, []));
  stars = $state<LocalStarEntry[]>(readJson<LocalStarEntry[]>(STARS_STORAGE_KEY, []));
  comments = $state<LocalCommentEntry[]>(
    migrateLegacyReviews(readJson<LocalCommentEntry[]>(COMMENTS_STORAGE_KEY, []), "text"),
  );
  ratings = $state<LocalRatingEntry[]>(
    migrateLegacyReviews(readJson<LocalRatingEntry[]>(RATINGS_STORAGE_KEY, []), "rating"),
  );

  #client?: BrowserOAuthClient;
  #oauthSession?: OAuthSession;
  #ready?: Promise<void>;
  /** Last successful #hydrate, used to rate-limit the background re-syncs */
  #lastHydrateAt = 0;
  #syncing?: Promise<void>;

  constructor() {
    if (browser) {
      // Drop legacy app-password sessions: logging in now requires the full
      // OAuth flow and no longer uses credentials stored in localStorage
      const legacy = localStorage.getItem(SESSION_STORAGE_KEY);
      if (legacy && legacy.includes("accessJwt")) localStorage.removeItem(SESSION_STORAGE_KEY);
      // The pre-#163 combined review cache has been split into the comments and ratings
      // stores by the field initializers above: the legacy key is now inert
      localStorage.removeItem(LEGACY_REVIEWS_STORAGE_KEY);
      this.#start();
      // Keep the local copies in sync with the PDS: records deleted upstream (e.g. from pds.ls)
      // must disappear from the app without requiring a manual reload.
      window.addEventListener("online", () => this.maybeSync(true));
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") this.maybeSync();
      });
    }
  }

  /** Time after which coming back to the tab triggers a new PDS sync */
  static #HYDRATE_INTERVAL = 5 * 60 * 1000;

  /**
   * Re-syncs the records from the PDS in the background: on connection regain, and when the tab
   * becomes visible again after {@link AtProtoClient.#HYDRATE_INTERVAL}. No-op when offline,
   * logged out, or when a sync already ran recently.
   */
  maybeSync(force = false) {
    if (!browser || !this.session || this.#syncing || !navigator.onLine) return;
    if (!force && Date.now() - this.#lastHydrateAt < AtProtoClient.#HYDRATE_INTERVAL) return;
    this.#syncing = this.#hydrate().finally(() => (this.#syncing = undefined));
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
    const handle = stored?.did === oauthSession.did ? stored.handle : await this.#fetchHandle(oauthSession.did);
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
      if (
        error instanceof TokenRevokedError ||
        error instanceof TokenInvalidError ||
        error instanceof TokenRefreshError
      ) {
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
      const [remoteTicks, remoteStars, remoteComments, remoteRatings, legacyReviews] = await Promise.all([
        this.#listRemote<LocalTickEntry>(TICK_COLLECTION),
        this.#listRemote<LocalStarEntry>(STAR_COLLECTION),
        this.#listRemote<LocalCommentEntry>(COMMENT_COLLECTION),
        this.#listRemote<LocalRatingEntry>(RATING_COLLECTION),
        // Reviews stored before #163 combined the comment text and the rating in one record:
        // they are kept visible by splitting them into comment and rating entries, pointing at
        // the legacy record uri. New records only go to the split collections.
        this.#listRemote<LegacyReviewEntry>(LEGACY_REVIEW_COLLECTION).catch(() => [] as LegacyReviewEntry[]),
      ]);
      // Keep the cached labels and the local-only entries (never uploaded), then let the PDS win.
      // Local entries carrying a uri that the PDS does not return anymore were deleted upstream
      // (e.g. from pds.ls) and are dropped: the PDS is the source of truth.
      const merge = <T extends { uri?: string; label?: string }>(local: T[], remote: T[]): T[] => {
        const labels = new Map(local.filter((e) => e.uri).map((e) => [e.uri!, e.label]));
        // Content signature used to drop stale local copies that duplicate a remote record
        // (caches written by older versions stored remote entries without their uri)
        const signature = (e: T) => JSON.stringify({ ...e, uri: undefined, label: undefined });
        const remoteSignatures = new Set(remote.map(signature));
        const localOnly = local.filter((e) => !e.uri && !remoteSignatures.has(signature(e)));
        // Defensive: dedupe remote entries by uri
        const seen = new Set<string>();
        const dedupedRemote = remote.filter((e) => {
          if (!e.uri) return true;
          if (seen.has(e.uri)) return false;
          seen.add(e.uri);
          return true;
        });
        return [...dedupedRemote, ...localOnly].map((e) => ({
          ...e,
          label: e.label ?? (e.uri ? labels.get(e.uri) : undefined),
        }));
      };
      const legacyComments = legacyReviews
        .filter((r) => typeof r.text === "string")
        .map((r) => ({ subject: r.subject, text: r.text!, createdAt: r.createdAt, uri: r.uri, label: r.label }));
      const legacyRatings = legacyReviews
        .filter((r) => typeof r.rating === "number")
        .map((r) => ({ subject: r.subject, rating: r.rating!, createdAt: r.createdAt, uri: r.uri, label: r.label }));
      this.ticks = merge(this.ticks, remoteTicks as LocalTickEntry[]);
      this.stars = merge(this.stars, remoteStars as LocalStarEntry[]);
      this.comments = merge(this.comments, [...(remoteComments as LocalCommentEntry[]), ...legacyComments]);
      this.ratings = merge(this.ratings, [...(remoteRatings as LocalRatingEntry[]), ...legacyRatings]);
      // Records logged offline were kept without a uri: push them to the PDS now that we are online
      await Promise.all([
        this.#uploadPending(TICK_COLLECTION, this.ticks),
        this.#uploadPending(STAR_COLLECTION, this.stars),
        this.#uploadPending(COMMENT_COLLECTION, this.comments),
        this.#uploadPending(RATING_COLLECTION, this.ratings),
      ]);
      this.#persistTicks();
      this.#persistStars();
      this.#persistComments();
      this.#persistRatings();
      this.#lastHydrateAt = Date.now();
    } catch (error) {
      console.error("Could not load ATProto records from the PDS", error);
    }
  }

  /**
   * Uploads local-only entries (logged offline, missing from the PDS) and stamps them with their uri.
   * The app never deletes ticks or reviews, and deleting a star also removes its local copy, so a
   * uri-less entry can only be one that never reached the PDS.
   */
  async #uploadPending(collection: string, entries: Array<LocalTickEntry | LocalStarEntry | LocalCommentEntry | LocalRatingEntry>) {
    await Promise.allSettled(
      entries
        .filter((e) => !e.uri && e.subject.id > 0)
        .map(async (e) => {
          const record: Record<string, unknown> = { ...e };
          delete record.uri;
          delete record.label;
          delete record.author;
          e.uri = await this.#createRemoteRecord(collection, record);
        }),
    );
  }

  async #listRemote<T extends { uri?: string }>(collection: string): Promise<T[]> {
    const session = this.#oauthSession;
    if (!session) throw new Error("ATProto is not configured");
    const out: T[] = [];
    let cursor: string | undefined;
    do {
      const query = new URLSearchParams({ repo: session.did, collection, limit: "100" });
      if (cursor) query.set("cursor", cursor);
      const res = await this.#xrpc(`/xrpc/com.atproto.repo.listRecords?${query}`);
      if (!res.ok) throw new Error(`Could not list ${collection} (HTTP ${res.status})${await xrpcErrorMessage(res)}`);
      const data = (await res.json()) as ListRecordsResponse<T>;
      // Keep the record uri: it is required to detect duplicates during merges and to delete records
      for (const record of data.records ?? []) out.push({ ...record.value, uri: record.uri } as T);
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
        // The lexicons are not published to the ATProto lexicon registry yet:
        // disable PDS-side validation, otherwise known PDS instances reject the
        // record with HTTP 400
        validate: false,
        record: { $type: collection, ...record },
      }),
    });
    if (!res.ok)
      throw new Error(
        `Could not save the record to your ATProto repository (HTTP ${res.status})${await xrpcErrorMessage(res)}`,
      );
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
    if (!res.ok)
      throw new Error(
        `Could not delete the record from your ATProto repository (HTTP ${res.status})${await xrpcErrorMessage(res)}`,
      );
  }

  #persistTicks() {
    if (browser) localStorage.setItem(TICKS_STORAGE_KEY, JSON.stringify(this.ticks));
  }

  #persistStars() {
    if (browser) localStorage.setItem(STARS_STORAGE_KEY, JSON.stringify(this.stars));
  }

  #persistComments() {
    if (browser) localStorage.setItem(COMMENTS_STORAGE_KEY, JSON.stringify(this.comments));
  }

  #persistRatings() {
    if (browser) localStorage.setItem(RATINGS_STORAGE_KEY, JSON.stringify(this.ratings));
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
    if (this.session && feature.id > 0) {
      try {
        record.uri = await this.#createRemoteRecord(TICK_COLLECTION, {
          subject: record.subject,
          style: record.style,
          climbedAt: record.climbedAt,
          createdAt: record.createdAt,
          ...(record.comment ? { comment: record.comment } : {}),
        });
      } catch (error) {
        // Offline: keep the tick locally, #hydrate pushes pending records once back online.
        // Session errors still surface: the user must log in again.
        if (!this.#oauthSession) throw error;
      }
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

  /**
   * Moves a tick to a replacement OSM element when its original element was deleted or converted:
   * the remote record (if uploaded) is deleted, and a new one is created with the same ascent data.
   */
  async relinkTick(tick: LocalTickEntry, replacement: OsmElementRef): Promise<LocalTickEntry> {
    if (!this.session) throw new Error("ATProto is not configured");
    if (tick.uri) await this.#deleteRemoteRecord(TICK_COLLECTION, tick.uri);
    this.ticks = this.ticks.filter((t) => t !== tick);
    this.#persistTicks();

    const entry: LocalTickEntry = {
      ...tick,
      uri: undefined,
      label: undefined,
      subject: replacement,
    };
    try {
      entry.uri = await this.#createRemoteRecord(TICK_COLLECTION, {
        subject: entry.subject,
        style: entry.style,
        climbedAt: entry.climbedAt,
        createdAt: entry.createdAt,
        ...(entry.comment ? { comment: entry.comment } : {}),
      });
    } catch (error) {
      // Offline: keep the relinked tick locally, #hydrate pushes pending records once back online.
      if (!this.#oauthSession) throw error;
    }
    this.ticks = [entry, ...this.ticks];
    this.#persistTicks();
    return entry;
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
    if (this.session && feature.id > 0) {
      try {
        entry.uri = await this.#createRemoteRecord(STAR_COLLECTION, {
          subject: entry.subject,
          createdAt: entry.createdAt,
        });
      } catch (error) {
        if (!this.#oauthSession) throw error;
      }
    }
    this.stars = [entry, ...this.stars];
    this.#persistStars();
    return true;
  }

  async addComment(feature: OsmFeature, text: string): Promise<LocalCommentEntry> {
    if (!this.session) throw new Error("ATProto is not configured");
    const trimmed = text.trim();
    if (!trimmed) throw new Error("Enter a comment");
    const entry: LocalCommentEntry = {
      subject: { type: feature.type, id: feature.id },
      text: trimmed,
      createdAt: new Date().toISOString(),
      author: this.session.handle ?? this.session.did,
      label: feature.tags?.name,
    };
    if (this.session && feature.id > 0) {
      try {
        entry.uri = await this.#createRemoteRecord(COMMENT_COLLECTION, {
          subject: entry.subject,
          text: entry.text,
          createdAt: entry.createdAt,
        });
      } catch (error) {
        if (!this.#oauthSession) throw error;
      }
    }
    this.comments = [entry, ...this.comments];
    this.#persistComments();
    return entry;
  }

  async addRating(feature: OsmFeature, rating: number): Promise<LocalRatingEntry> {
    if (!this.session) throw new Error("ATProto is not configured");
    if (!Number.isFinite(rating) || rating < 0 || rating > 1) throw new Error("Invalid rating");
    const entry: LocalRatingEntry = {
      subject: { type: feature.type, id: feature.id },
      rating,
      createdAt: new Date().toISOString(),
      label: feature.tags?.name,
    };
    if (this.session && feature.id > 0) {
      try {
        entry.uri = await this.#createRemoteRecord(RATING_COLLECTION, {
          subject: entry.subject,
          rating: entry.rating,
          createdAt: entry.createdAt,
        });
      } catch (error) {
        if (!this.#oauthSession) throw error;
      }
    }
    this.ratings = [entry, ...this.ratings];
    this.#persistRatings();
    return entry;
  }
}

export const atproto = new AtProtoClient();
