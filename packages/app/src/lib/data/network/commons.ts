import { resolve } from "$app/paths";

const API_URL = "https://commons.wikimedia.org/w/api.php";
const REST_URL = "https://commons.wikimedia.org/w/rest.php";
const TOKEN_STORAGE_KEY = "bloknote:commons-token";
const FLOW_STORAGE_KEY = "bloknote:commons-oauth";
/** Pending sign-in flows expire after this long (state + PKCE verifier are short-lived) */
const FLOW_MAX_AGE_MS = 15 * 60_000;
const CLIENT_ID = "cb1b3304f08a90e52e8846257af8b143";

/**
 * Wikimedia OAuth 2.0 flow with PKCE, mirroring the requests of the reference implementation
 * m3api-oauth2 (https://gitlab.wikimedia.org/repos/m3api/m3api-oauth2): notably, `redirect_uri` is
 * NOT sent — MediaWiki defaults it to the callback registered for the "Bloknote" consumer on
 * meta.wikimedia.org (`https://ecstrema.github.io/bloknote/commons-oauth`), and sending it
 * explicitly trips the client validation with "Client authentication failed" (issue #244). The
 * client is public ("Client is confidential: No"), so no client_secret is used.
 *
 * The pending flow (state + PKCE verifier) is stored in localStorage rather than sessionStorage:
 * sessionStorage does not reliably survive the round trip through the Wikimedia login domains
 * (storage partitioning drops it, breaking the callback with "sign-in session expired").
 */

type CommonsToken = { access_token: string; expires_at: number };

type CommonsFlow = { state: string; verifier: string; returnTo: string; createdAt: number };

function randomValue() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function readToken(): CommonsToken | undefined {
  const raw = sessionStorage.getItem(TOKEN_STORAGE_KEY);
  if (!raw) return;
  try {
    const token = JSON.parse(raw) as CommonsToken;
    if (token.expires_at <= Date.now() + 30_000) {
      sessionStorage.removeItem(TOKEN_STORAGE_KEY);
      return;
    }
    return token;
  } catch {
    sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  }
}

export function getCommonsAccessToken() {
  return readToken()?.access_token;
}

export function logoutCommons() {
  sessionStorage.removeItem(TOKEN_STORAGE_KEY);
}

function writeFlow(flow: CommonsFlow) {
  localStorage.setItem(FLOW_STORAGE_KEY, JSON.stringify(flow));
}

/** Reads and consumes the pending sign-in flow, when it exists and has not expired */
function readFlow(): CommonsFlow | undefined {
  const raw = localStorage.getItem(FLOW_STORAGE_KEY);
  if (!raw) return;
  localStorage.removeItem(FLOW_STORAGE_KEY);
  try {
    const flow = JSON.parse(raw) as CommonsFlow;
    if (Date.now() - flow.createdAt <= FLOW_MAX_AGE_MS) return flow;
  } catch {
    // Corrupted flow: drop it
  }
  return;
}

export async function startCommonsLogin() {
  if (!CLIENT_ID) throw new Error("Wikimedia upload is not configured for this deployment.");

  const verifier = randomValue();
  const challengeBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(challengeBytes)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
  const state = randomValue();

  writeFlow({ state, verifier, returnTo: window.location.href, createdAt: Date.now() });

  const authorization = new URL(`${REST_URL}/oauth2/authorize`);
  authorization.search = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  window.location.assign(authorization);
}

export async function completeCommonsLogin(search: string): Promise<string> {
  const params = new URLSearchParams(search);
  const oauthError = params.get("error_description") ?? params.get("error");
  if (oauthError) throw new Error(`Wikimedia sign-in failed: ${oauthError}`);

  const flow = readFlow();
  if (!flow) throw new Error("The Wikimedia sign-in session expired. Please try again.");

  const { state, verifier, returnTo } = flow;
  if (!params.get("code") || params.get("state") !== state) {
    throw new Error("Wikimedia sign-in could not be verified. Please try again.");
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: CLIENT_ID,
    code: params.get("code")!,
    code_verifier: verifier,
  });
  const response = await fetch(`${REST_URL}/oauth2/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const result = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
    message?: string;
  };
  if (!response.ok || !result.access_token) {
    throw new Error(
      [result.error_description, result.message, result.error].find((message) => !!message) ??
        "Wikimedia did not return an access token.",
    );
  }

  sessionStorage.setItem(
    TOKEN_STORAGE_KEY,
    JSON.stringify({ access_token: result.access_token, expires_at: Date.now() + (result.expires_in ?? 3600) * 1000 }),
  );
  const returnUrl = new URL(returnTo, window.location.origin);
  return returnUrl.origin === window.location.origin ? returnUrl.toString() : resolve("/");
}

export async function getCommonsUsername(accessToken: string) {
  const response = await fetch(`${REST_URL}/oauth2/resource/profile`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error("Could not verify the Wikimedia account.");
  const profile = (await response.json()) as { username?: string };
  return profile.username;
}

export async function uploadCommonsFile(
  accessToken: string,
  file: File,
  metadata: { filename: string; description: string; source: string; author: string; license: string },
) {
  const headers = { Authorization: `Bearer ${accessToken}` };
  const tokenUrl = new URL(API_URL);
  tokenUrl.search = new URLSearchParams({
    action: "query",
    meta: "tokens",
    format: "json",
    origin: "*",
  }).toString();
  const tokenResponse = await fetch(tokenUrl, { headers });
  const tokenData = (await tokenResponse.json()) as {
    query?: { tokens?: { csrftoken?: string } };
    error?: { info?: string };
  };
  const csrfToken = tokenData.query?.tokens?.csrftoken;
  if (!tokenResponse.ok || !csrfToken) {
    throw new Error(tokenData.error?.info ?? "Could not get a Wikimedia upload token.");
  }

  const form = new FormData();
  form.set("action", "upload");
  form.set("format", "json");
  form.set("filename", metadata.filename);
  form.set("comment", "Uploaded from Bloknote");
  form.set(
    "text",
    [
      "{{Information",
      `|description=${escapeTemplateValue(metadata.description)}`,
      `|source=${escapeTemplateValue(metadata.source)}`,
      `|author=${escapeTemplateValue(metadata.author)}`,
      `|date=${new Date().toISOString().slice(0, 10)}`,
      "}}",
      `{{${metadata.license}}}`,
    ].join("\n"),
  );
  form.set("token", csrfToken);
  form.set("file", file, metadata.filename);

  const response = await fetch(`${API_URL}?origin=*`, { method: "POST", headers, body: form });
  const data = (await response.json()) as {
    upload?: { result?: string; filename?: string; warnings?: Record<string, string> };
    error?: { info?: string };
  };
  if (!response.ok || data.error) throw new Error(data.error?.info ?? "The Wikimedia upload failed.");
  if (data.upload?.result !== "Success" || !data.upload.filename) {
    const warning = Object.values(data.upload?.warnings ?? {})[0];
    throw new Error(warning ?? "Wikimedia did not confirm the upload.");
  }
  return `File:${data.upload.filename}`;
}

function escapeTemplateValue(value: string) {
  return value.replaceAll("\r", " ").replaceAll("\n", " ").replaceAll("|", "{{!}}").replaceAll("}", "&#125;");
}
