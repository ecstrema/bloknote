import { browser } from "$app/env";
import { MAX_RATING } from "@bloknote/common";
import type { CommentRecord, OsmElementRef, RatingRecord, StarRecord, TickAscent, TickRecord } from "@bloknote/common";
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

const TICK_COLLECTION = "org.bloknote.logbook.tick";
const STAR_COLLECTION = "org.bloknote.osm.bookmark";
const COMMENT_COLLECTION = "org.bloknote.osm.comment";
const RATING_COLLECTION = "org.bloknote.osm.rating";
const SETTINGS_COLLECTION = "org.bloknote.settings";
/** All synced preferences live in a single fixed-rkey record per account (issue #187) */
const SETTINGS_RKEY = "self";

/**
 * The `client_id` of the deployed app: it points to the client metadata hosted
 * at static/client-metadata.json, which the OAuth server fetches to validate
 * the client. It must stay in sync with that file.
 */
const PRODUCTION_CLIENT_ID = "https://ecstrema.github.io/bloknote/client-metadata.json";
/**
 * Minimal granular permissions: only create/delete records in the app's own
 * collections on the user's PDS (ticks, bookmarks, comments, ratings, synced
 * settings). No broad repository access, blobs, account, or identity permissions.
 * Record listing (com.atproto.repo.listRecords) is a public endpoint, so no read
 * permission is needed. Must stay in sync with static/client-metadata.json.
 */
const OAUTH_SCOPE =
  "atproto repo:org.bloknote.logbook.tick?action=create&action=update&action=delete repo:org.bloknote.osm.bookmark?action=create&action=delete repo:org.bloknote.osm.comment?action=create&action=delete repo:org.bloknote.osm.rating?action=create&action=delete repo:org.bloknote.settings?action=create&action=update";

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
  /** Deterministic local id (see tickLocalId), used to reference ticks in URLs */
  localId?: string;
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

/** Appearance and language preferences synced through the user's ATProto account (issue #187) */
export interface RemoteSettings {
  mode?: "light" | "dark" | "system";
  locale?: string;
  updatedAt?: string;
}

/** Current local appearance and language, used to seed the account settings on first sync */
function localSettings(): RemoteSettings {
  if (!browser) return {};
  const mode = localStorage.getItem("bloknote:mode");
  const locale = localStorage.getItem("bloknote:locale");
  return {
    ...(mode === "light" || mode === "dark" || mode === "system" ? { mode } : {}),
    ...(locale ? { locale } : {}),
  };
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

export function sameElementRef(a: OsmElementRef | undefined, b: OsmElementRef | undefined): boolean {
  if (!a || !b) return false;
  return a.type === b.type && a.id === b.id;
}

/** Deterministic local id for a tick: stable across PDS re-syncs without polluting the record */
function tickLocalId(entry: LocalTickEntry | TickRecord): string {
  const signature = JSON.stringify({
    subject: entry.subject ?? null,
    name: entry.name ?? null,
    outcome: entry.outcome ?? null,
    sendStyle: entry.sendStyle ?? null,
    attemptStyle: entry.attemptStyle ?? null,
    hangs: entry.hangs ?? null,
    climbedAt: entry.climbedAt,
    createdAt: entry.createdAt,
  });
  // djb2
  let hash = 5381;
  for (let i = 0; i < signature.length; i++) {
    hash = ((hash << 5) + hash + signature.charCodeAt(i)) | 0;
  }
  return `t${(hash >>> 0).toString(36)}`;
}

/**
 * Assigns a stable unique local id to every tick (mutates entries missing or duplicating one).
 * Must run before ticks reach the UI: the ticks list keys its each blocks by localId, and
 * Svelte crashes on duplicate (or undefined) keys.
 */
function ensureTickLocalIds(ticks: LocalTickEntry[]): LocalTickEntry[] {
  const seen = new Set<string>();
  for (const entry of ticks) {
    if (entry.localId && !seen.has(entry.localId)) {
      seen.add(entry.localId);
      continue;
    }
    let id = tickLocalId(entry);
    while (seen.has(id)) id = `${id}x`;
    entry.localId = id;
    seen.add(id);
  }
  return ticks;
}

/** The record stored in the PDS: the local-only fields (uri, label, localId) are stripped */
function remoteTickRecord(entry: LocalTickEntry): TickRecord {
  return {
    ...(entry.subject ? { subject: entry.subject } : {}),
    ...(entry.outcome ? { outcome: entry.outcome } : {}),
    ...(entry.sendStyle ? { sendStyle: entry.sendStyle } : {}),
    ...(entry.attemptStyle ? { attemptStyle: entry.attemptStyle } : {}),
    ...(entry.hangs ? { hangs: entry.hangs } : {}),
    ...(entry.ascentInfo ? { ascentInfo: entry.ascentInfo } : {}),
    climbedAt: entry.climbedAt,
    ...(entry.comment ? { comment: entry.comment } : {}),
    ...(entry.name ? { name: entry.name } : {}),
    ...(entry.grade ? { grade: entry.grade } : {}),
    ...(entry.locationHint ? { locationHint: entry.locationHint } : {}),
  };
}

/**
 * Ticks written before the location hint became an array are migrated on read: the very first
 * version stored a single crag name (record field "crag"), then a "> "-joined string.
 */
function normalizeTick(entry: LocalTickEntry): LocalTickEntry {
  const migrated =
    "crag" in entry
      ? (() => {
          const { crag, ...rest } = entry as LocalTickEntry & { crag?: string };
          return crag && !rest.locationHint ? { ...rest, locationHint: [crag] } : rest;
        })()
      : entry;
  return typeof migrated.locationHint === "string"
    ? { ...migrated, locationHint: [migrated.locationHint] }
    : migrated;
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
  ticks = $state<LocalTickEntry[]>(ensureTickLocalIds(readJson<LocalTickEntry[]>(TICKS_STORAGE_KEY, []).map(normalizeTick)));
  stars = $state<LocalStarEntry[]>(readJson<LocalStarEntry[]>(STARS_STORAGE_KEY, []));
  comments = $state<LocalCommentEntry[]>(readJson<LocalCommentEntry[]>(COMMENTS_STORAGE_KEY, []));
  ratings = $state<LocalRatingEntry[]>(readJson<LocalRatingEntry[]>(RATINGS_STORAGE_KEY, []));
  /** Appearance and language synced from the ATProto account, applied by the root layout (issue #187) */
  settings = $state<RemoteSettings | undefined>(undefined);

  #client?: BrowserOAuthClient;
  #oauthSession?: OAuthSession;
  #ready?: Promise<void>;
  /** Last successful #hydrate, used to rate-limit the background re-syncs */
  #lastHydrateAt = 0;
  #syncing?: Promise<void>;
  /** Set after a settings write fails (e.g. a session authorized before the settings permission existed) */
  #settingsWriteFailed = false;

  constructor() {
    if (browser) {
      // Drop legacy app-password sessions: logging in now requires the full
      // OAuth flow and no longer uses credentials stored in localStorage
      const legacy = localStorage.getItem(SESSION_STORAGE_KEY);
      if (legacy && legacy.includes("accessJwt")) localStorage.removeItem(SESSION_STORAGE_KEY);
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
      const [remoteTicks, remoteStars, remoteComments, remoteRatings] = await Promise.all([
        this.#listRemote<LocalTickEntry>(TICK_COLLECTION).then((ticks) => ticks.map(normalizeTick)),
        this.#listRemote<LocalStarEntry>(STAR_COLLECTION),
        this.#listRemote<LocalCommentEntry>(COMMENT_COLLECTION),
        this.#listRemote<LocalRatingEntry>(RATING_COLLECTION),
      ]);
      await this.#fetchRemoteSettings();
      // Keep the cached labels and the local-only entries (never uploaded), then let the PDS win.
      // Local entries carrying a uri that the PDS does not return anymore were deleted upstream
      // (e.g. from pds.ls) and are dropped: the PDS is the source of truth.
      const merge = <T extends { uri?: string; label?: string; localId?: string }>(local: T[], remote: T[]): T[] => {
        const labels = new Map(local.filter((e) => e.uri).map((e) => [e.uri!, e.label]));
        const localIds = new Map(local.filter((e) => e.uri && e.localId).map((e) => [e.uri!, e.localId!]));
        // Content signature used to drop stale local copies that duplicate a remote record
        // (caches written by older versions stored remote entries without their uri)
        const signature = (e: T) => JSON.stringify({ ...e, uri: undefined, label: undefined, localId: undefined });
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
          localId: e.localId ?? (e.uri ? localIds.get(e.uri) : undefined),
        })) as T[];
      };
      const mergedTicks = merge(this.ticks, remoteTicks as LocalTickEntry[]);
      // linkTick can attach a tick to a locally created element, which only has a temporary id
      // until the changeset is pushed (issue #154): the PDS record is deliberately left without
      // a subject in the meantime and updated by remapTickSubjects after the push. A re-sync
      // before the push must therefore not drop the locally assigned subject, otherwise the
      // tick falls back into the "Not in the map data" bucket and leaves the places hierarchy.
      const localSubjects = new Map(
        this.ticks.filter((e) => e.uri && e.subject).map((e) => [e.uri!, e.subject!]),
      );
      for (const entry of mergedTicks) {
        if (!entry.subject && entry.uri && localSubjects.has(entry.uri)) {
          entry.subject = localSubjects.get(entry.uri)!;
        }
      }
      // Local ids are assigned before the assignment: the ticks list keys its each blocks by
      // localId, and a render with pending (undefined) ids between the awaits would crash it
      this.ticks = ensureTickLocalIds(mergedTicks);
      this.stars = merge(this.stars, remoteStars as LocalStarEntry[]);
      this.comments = merge(this.comments, remoteComments as LocalCommentEntry[]);
      this.ratings = merge(this.ratings, remoteRatings as LocalRatingEntry[]);
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
   * A uri-less entry can only be one that never reached the PDS: synced entries carry their uri,
   * and deletes remove the entry (local and remote) in one step.
   */
  async #uploadPending(collection: string, entries: Array<LocalTickEntry | LocalStarEntry | LocalCommentEntry | LocalRatingEntry>) {
    await Promise.allSettled(
      entries
        // Subject-less ticks (routes not on OSM yet, issue #154) are uploaded too
        .filter((e) => !e.uri && (!("subject" in e) || !e.subject || e.subject.id > 0))
        .map(async (e) => {
          const record: Record<string, unknown> = { ...e };
          delete record.uri;
          delete record.label;
          delete record.author;
          delete record.localId;
          e.uri = await this.#createRemoteRecord(collection, record);
        }),
    );
  }

  /**
   * Reads the synced appearance/language settings from the account (issue #187). When no record
   * exists yet, it is seeded with the current local preferences. Failures never break the
   * records hydration: settings sync is a nice-to-have.
   */
  async #fetchRemoteSettings() {
    try {
      const session = this.#oauthSession;
      if (!session) return;
      const query = new URLSearchParams({ repo: session.did, collection: SETTINGS_COLLECTION, rkey: SETTINGS_RKEY });
      const res = await this.#xrpc(`/xrpc/com.atproto.repo.getRecord?${query}`);
      if (res.ok) {
        const data = (await res.json()) as { value?: RemoteSettings };
        this.settings = data.value ?? undefined;
      } else {
        // No record yet (HTTP 400/404): create one from the current local preferences
        await this.saveSettings(localSettings());
      }
    } catch (error) {
      console.warn("Could not load the settings from the ATProto account", error);
    }
  }

  /**
   * Saves the synced appearance and language preferences to the ATProto account (issue #187).
   * Called when the user changes a synced setting; remote changes are applied without pushing
   * back, so this only ever runs for explicit user edits.
   */
  async saveSettings(patch: RemoteSettings) {
    if (!this.session || this.#settingsWriteFailed) return;
    const record: RemoteSettings = { ...this.settings, ...patch, updatedAt: new Date().toISOString() };
    delete (record as { $type?: string }).$type;
    this.settings = record;
    try {
      await this.#putRemoteRecord(SETTINGS_COLLECTION, SETTINGS_RKEY, record);
    } catch (error) {
      // Sessions authorized before the settings permission existed cannot write until re-login
      console.warn("Could not save the settings to the ATProto account", error);
      this.#settingsWriteFailed = true;
    }
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
    this.#clearLocalData();
    this.settings = undefined;
    this.#settingsWriteFailed = false;
    if (session) await session.signOut().catch(() => {});
  }

  /** Clears the locally cached Atmosphere records (ticks, stars, comments, ratings). Settings are kept. */
  #clearLocalData() {
    this.ticks = [];
    this.stars = [];
    this.comments = [];
    this.ratings = [];
    if (browser) {
      localStorage.removeItem(TICKS_STORAGE_KEY);
      localStorage.removeItem(STARS_STORAGE_KEY);
      localStorage.removeItem(COMMENTS_STORAGE_KEY);
      localStorage.removeItem(RATINGS_STORAGE_KEY);
    }
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

  /** Overwrites an existing record in the PDS (used to edit ticks, see updateTick) */
  async #putRemoteRecord(collection: string, uri: string, record: object): Promise<void> {
    const session = this.#oauthSession;
    if (!session) throw new Error("ATProto is not configured");
    const rkey = uri.split("/").at(-1);
    if (!rkey) throw new Error(`Invalid record URI: ${uri}`);
    const res = await this.#xrpc("/xrpc/com.atproto.repo.putRecord", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repo: session.did,
        collection,
        rkey,
        // Same as createRecord: the lexicons are not published yet
        validate: false,
        record: { $type: collection, ...record },
      }),
    });
    if (!res.ok)
      throw new Error(
        `Could not update the record in your ATProto repository (HTTP ${res.status})${await xrpcErrorMessage(res)}`,
      );
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

  #ensureTickLocalIds() {
    this.ticks = ensureTickLocalIds(this.ticks);
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

  async addTick(
    feature: OsmFeature,
    ascent: TickAscent,
    comment?: string,
    climbedAt?: string,
  ): Promise<LocalTickEntry> {
    if (!this.session) throw new Error("ATProto is not configured");
    const now = new Date().toISOString();
    // Imported ticks (issue #154) can carry the original ascent date
    const climbed = climbedAt ?? now;
    const record: LocalTickEntry = {
      subject: { type: feature.type, id: feature.id },
      ...ascent,
      climbedAt: climbed,
      label: feature.tags?.name,
      ...(comment?.trim() ? { comment: comment.trim() } : {}),
    };
    if (this.session && feature.id > 0) {
      try {
        record.uri = await this.#createRemoteRecord(TICK_COLLECTION, remoteTickRecord(record));
      } catch (error) {
        // Offline: keep the tick locally, #hydrate pushes pending records once back online.
        // Session errors still surface: the user must log in again.
        if (!this.#oauthSession) throw error;
      }
    }
    this.ticks = [record, ...this.ticks];
    this.#ensureTickLocalIds();
    this.#persistTicks();
    return record;
  }

  /**
   * Adds a tick for a route that is not on OpenStreetMap (yet): the record carries the route
   * name (and optionally grade and location hint) instead of a subject (issue #154). The ticks
   * list lets the user add the route to OSM later, or link the tick when the route appears in the data.
   */
  async addNameTick(
    tick: { name: string; grade?: string; locationHint?: string[] },
    ascent: TickAscent,
    comment?: string,
    climbedAt?: string,
  ): Promise<LocalTickEntry> {
    if (!this.session) throw new Error("ATProto is not configured");
    const now = new Date().toISOString();
    const record: LocalTickEntry = {
      ...ascent,
      climbedAt: climbedAt ?? now,
      name: tick.name,
      ...(tick.grade ? { grade: tick.grade } : {}),
      ...(tick.locationHint ? { locationHint: tick.locationHint } : {}),
      ...(comment?.trim() ? { comment: comment.trim() } : {}),
    };
    if (this.#oauthSession) {
      try {
        record.uri = await this.#createRemoteRecord(TICK_COLLECTION, remoteTickRecord(record));
      } catch (error) {
        if (!this.#oauthSession) throw error;
      }
    }
    this.ticks = [record, ...this.ticks];
    this.#ensureTickLocalIds();
    this.#persistTicks();
    return record;
  }

  /** Finds a tick by its local id (used by the "add to OSM" flow, issue #154) */
  findTick(localId: string): LocalTickEntry | undefined {
    return this.ticks.find((t) => t.localId === localId);
  }

  /**
   * Pushes the current local state of a tick to the PDS. The entry is mutated in place first:
   * inline edits (debounced for a few seconds by the caller) land here (issue #154).
   * Uri-less entries (never uploaded) are pushed by #uploadPending on the next sync instead.
   */
  async pushTick(entry: LocalTickEntry): Promise<LocalTickEntry> {
    if (!this.session) throw new Error("ATProto is not configured");
    if (entry.uri) {
      await this.#putRemoteRecord(TICK_COLLECTION, entry.uri, remoteTickRecord(entry));
    }
    this.#persistTicks();
    return entry;
  }

  /** Edits a tick (ascent, date, comment) locally and in the PDS when synced */
  async updateTick(
    entry: LocalTickEntry,
    patch: { ascent?: TickAscent; climbedAt?: string; comment?: string },
  ): Promise<LocalTickEntry> {
    if (!this.session) throw new Error("ATProto is not configured");
    if (patch.ascent !== undefined) {
      delete entry.sendStyle;
      delete entry.attemptStyle;
      delete entry.hangs;
      Object.assign(entry, patch.ascent);
    }
    if (patch.climbedAt !== undefined) entry.climbedAt = patch.climbedAt;
    if (patch.comment !== undefined) {
      const trimmed = patch.comment.trim();
      if (trimmed) entry.comment = trimmed;
      else delete entry.comment;
    }
    if (entry.uri) {
      try {
        await this.#putRemoteRecord(TICK_COLLECTION, entry.uri, remoteTickRecord(entry));
      } catch (error) {
        if (!this.#oauthSession) throw error;
      }
    }
    this.#ensureTickLocalIds();
    this.#persistTicks();
    return entry;
  }

  /** Attaches a subject-less tick to an OSM element (e.g. once the route exists in OSM) */
  async linkTick(entry: LocalTickEntry, ref: OsmElementRef, label?: string): Promise<LocalTickEntry> {
    if (!this.session) throw new Error("ATProto is not configured");
    entry.subject = ref;
    if (label) entry.label = label;
    // Locally created elements carry a temporary id until their changeset is pushed: the PDS
    // record is only updated then (see remapTickSubjects), never with a temporary reference
    if (entry.uri && ref.id > 0) {
      try {
        await this.#putRemoteRecord(TICK_COLLECTION, entry.uri, remoteTickRecord(entry));
      } catch (error) {
        if (!this.#oauthSession) throw error;
      }
    }
    this.#persistTicks();
    return entry;
  }

  /**
   * Called after a changeset push assigned real OSM ids to created elements: the ticks pointing
   * at the temporary ids are remapped locally, and their records are updated on the PDS
   * (issue #154). Ticks that were never uploaded are picked up by the next sync instead.
   */
  async remapTickSubjects(remaps: { type: OsmElementRef["type"]; from: number; to: number }[]): Promise<void> {
    let changed = false;
    for (const entry of this.ticks) {
      if (!entry.subject) continue;
      const remap = remaps.find((r) => r.type === entry.subject!.type && r.from === entry.subject!.id);
      if (!remap) continue;
      entry.subject = { type: entry.subject.type, id: remap.to };
      changed = true;
      if (entry.uri) {
        try {
          await this.#putRemoteRecord(TICK_COLLECTION, entry.uri, remoteTickRecord(entry));
        } catch (error) {
          if (!this.#oauthSession) throw error;
        }
      }
    }
    if (changed) this.#persistTicks();
  }

  async addBulkTicks(features: OsmFeature[], ascent: TickAscent, comment?: string): Promise<TickRecord[]> {
    if (!this.session) throw new Error("ATProto is not configured");
    const created: LocalTickEntry[] = [];
    for (const feature of features.filter((f) => f.id > 0)) {
      created.push(await this.addTick(feature, ascent, comment));
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
      entry.uri = await this.#createRemoteRecord(TICK_COLLECTION, remoteTickRecord(entry));
    } catch (error) {
      // Offline: keep the relinked tick locally, #hydrate pushes pending records once back online.
      if (!this.#oauthSession) throw error;
    }
    this.ticks = [entry, ...this.ticks];
    this.#persistTicks();
    return entry;
  }

  /** Deletes a tick from the PDS (when synced) and from the local cache */
  async deleteTick(tick: LocalTickEntry): Promise<void> {
    if (!this.session) throw new Error("ATProto is not configured");
    if (tick.uri) await this.#deleteRemoteRecord(TICK_COLLECTION, tick.uri);
    this.ticks = this.ticks.filter((t) => t !== tick);
    this.#persistTicks();
  }

  /** Deletes a comment from the PDS (when synced) and from the local cache */
  async deleteComment(comment: LocalCommentEntry): Promise<void> {
    if (!this.session) throw new Error("ATProto is not configured");
    if (comment.uri) await this.#deleteRemoteRecord(COMMENT_COLLECTION, comment.uri);
    this.comments = this.comments.filter((c) => c !== comment);
    this.#persistComments();
  }

  /** Deletes a rating from the PDS (when synced) and from the local cache */
  async deleteRating(rating: LocalRatingEntry): Promise<void> {
    if (!this.session) throw new Error("ATProto is not configured");
    if (rating.uri) await this.#deleteRemoteRecord(RATING_COLLECTION, rating.uri);
    this.ratings = this.ratings.filter((r) => r !== rating);
    this.#persistRatings();
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
      label: feature.tags?.name,
    };
    if (this.session && feature.id > 0) {
      try {
        entry.uri = await this.#createRemoteRecord(STAR_COLLECTION, {
          subject: entry.subject,
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
    if (!Number.isInteger(rating) || rating < 0 || rating > MAX_RATING) throw new Error("Invalid rating");
    const entry: LocalRatingEntry = {
      subject: { type: feature.type, id: feature.id },
      rating,
      label: feature.tags?.name,
    };
    if (this.session && feature.id > 0) {
      try {
        entry.uri = await this.#createRemoteRecord(RATING_COLLECTION, {
          subject: entry.subject,
          rating: entry.rating,
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
