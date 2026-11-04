/**
 * Google OAuth for the GA Data API connector — same shape as the YouTube
 * Analytics flow in lib/lab/setup/oauth-google.ts, with its own credential
 * names so the two grants never share a token:
 *
 * Google "Web application" client, authorization code flow with PKCE (S256),
 * offline access. The refresh token is written to .env.local with
 * upsertEnvLocal (by the callback route); the access token is minted per
 * call and held in process memory until expires_in - 60 s, never on disk.
 * No token, secret or code is ever logged.
 *
 * Server-only: imports node:crypto. Never import from client components.
 */
import { createHash, randomBytes } from 'node:crypto';
import { resolveCred } from '@/lib/creds';

export const GA_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GA_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GA_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
export const GA_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';

/** The env fields this flow reads/writes (writtenBy 'oauth' in spirit). */
export const GA_OAUTH_FIELDS = ['GA_DATA_CLIENT_ID', 'GA_DATA_CLIENT_SECRET', 'GA_DATA_REFRESH_TOKEN'] as const;

export type OAuthFetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

const defaultFetch = (): OAuthFetch => fetch as unknown as OAuthFetch;

/** Google refused the refresh token: the 7-day Testing trap or a revoked grant. */
export class GaInvalidGrantError extends Error {
  constructor() {
    super('Google refused the refresh token (invalid_grant). If the OAuth app is in Testing, tokens last 7 days — connect again.');
    this.name = 'GaInvalidGrantError';
  }
}

export function gaOAuthClient(): { clientId: string; clientSecret: string } | null {
  const clientId = resolveCred('GA_DATA_CLIENT_ID', []);
  const clientSecret = resolveCred('GA_DATA_CLIENT_SECRET', []);
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/** GA callback URL when set, else the app's own callback on this port. */
export function gaRedirectUri(port: string | number = process.env.PORT ?? 3000): string {
  return resolveCred('GA_DATA_REDIRECT_URI', []) ?? `http://localhost:${port}/api/connectors/ga-data/callback`;
}

const b64url = (b: Buffer) => b.toString('base64url');
export const gaNewState = (): string => b64url(randomBytes(32));
export const gaNewVerifier = (): string => b64url(randomBytes(48));
export const gaChallengeOf = (verifier: string): string => b64url(createHash('sha256').update(verifier).digest());

export function gaAuthUrl(o: { clientId: string; redirectUri: string; state: string; verifier: string }): string {
  const q = new URLSearchParams({
    client_id: o.clientId,
    redirect_uri: o.redirectUri,
    response_type: 'code',
    scope: GA_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state: o.state,
    code_challenge: gaChallengeOf(o.verifier),
    code_challenge_method: 'S256',
  });
  return `${GA_AUTHORIZE_URL}?${q.toString()}`;
}

const form = (o: Record<string, string>) => new URLSearchParams(o).toString();

async function gaTokenCall(
  body: Record<string, string>,
  f: OAuthFetch,
): Promise<{ access_token?: string; expires_in?: number; refresh_token?: string }> {
  const res = await f(GA_TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form(body) });
  const data = (await res.json().catch(() => ({}))) as { error?: string; access_token?: string; expires_in?: number; refresh_token?: string };
  if (!res.ok) {
    if (data.error === 'invalid_grant') throw new GaInvalidGrantError();
    throw new Error(`Google token endpoint answered ${res.status}${data.error ? ` (${data.error})` : ''}`);
  }
  return data;
}

/** Code to tokens (the callback). Refresh token only arrives on first consent. */
export async function gaExchangeCode(
  o: { code: string; verifier: string; redirectUri: string; clientId: string; clientSecret: string },
  f: OAuthFetch = defaultFetch(),
): Promise<{ refreshToken: string; accessToken: string }> {
  const t = await gaTokenCall({ grant_type: 'authorization_code', code: o.code, code_verifier: o.verifier, redirect_uri: o.redirectUri, client_id: o.clientId, client_secret: o.clientSecret }, f);
  if (!t.refresh_token || !t.access_token) throw new Error('Google returned no refresh token. Remove the app from your Google account and connect again.');
  return { refreshToken: t.refresh_token, accessToken: t.access_token };
}

let cached: { token: string; until: number; refresh: string } | null = null;
/** Tests reset the in-memory access token. */
export function clearGaTokenCache(): void {
  cached = null;
}

/**
 * A short-lived Google access token minted from GA_DATA_REFRESH_TOKEN, held
 * in process memory until expires_in - 60 s; never stored on disk. Null when
 * GA is not connected. Throws GaInvalidGrantError on invalid_grant.
 */
export async function gaAccessToken(opts: { now?: Date; fetch?: OAuthFetch } = {}): Promise<string | null> {
  const now = (opts.now ?? new Date()).getTime();
  const refresh = resolveCred('GA_DATA_REFRESH_TOKEN', []);
  const client = gaOAuthClient();
  if (!refresh || !client) return null;
  if (cached && cached.refresh === refresh && cached.until > now) return cached.token;
  const t = await gaTokenCall({ grant_type: 'refresh_token', refresh_token: refresh, client_id: client.clientId, client_secret: client.clientSecret }, opts.fetch ?? defaultFetch());
  if (!t.access_token) throw new Error('Google returned no access token');
  cached = { token: t.access_token, until: now + Math.max(0, (t.expires_in ?? 3600) - 60) * 1000, refresh };
  return t.access_token;
}

/** Revoke the refresh token at Google (disconnect). Failures are ignored: the local fields are removed either way. */
export async function gaRevoke(refreshToken: string, f: OAuthFetch = defaultFetch()): Promise<void> {
  try {
    await f(`${GA_REVOKE_URL}?${form({ token: refreshToken })}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  } catch {
    /* removed locally regardless */
  }
}
