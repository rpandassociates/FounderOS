/**
 * Google Analytics connector — GA4 Data API, read-only.
 *
 * Reads GA_DATA_PROPERTY_IDS (comma list of numeric property IDs) and the
 * OAuth grant in GA_DATA_CLIENT_ID / GA_DATA_CLIENT_SECRET /
 * GA_DATA_REFRESH_TOKEN (see lib/connectors/ga-oauth.ts). Without all four
 * the connector reports `not_configured` — never a fake "connected", never
 * fixture numbers. With them, the status live-verifies the grant by minting
 * an access token (cached in memory until expiry); a dead grant reports
 * `error` with a reconnect hint instead of a green dot.
 *
 * Data: one runReport per property — users and sessions by countryId,
 * country and city over the last 28 days. GA returns names, never
 * coordinates, so globe pins sit on country centroids (lib/ga-countries.ts);
 * a country with no centroid still counts in every total and still appears
 * in the country list, it simply gets no pin.
 *
 * Server-only: imports node code through lib/creds and lib/swr. The Analytics
 * section receives only the serializable GaTraffic shape below, never keys.
 */
import { resolveCred, runtimeEnv } from '@/lib/creds';
import { TTL, keyTag, swr } from '@/lib/swr';
import type { ConnectorStatus } from '@/lib/connectors/types';
import { countryCentroid } from '@/lib/ga-countries';
import { gaAccessToken, GaInvalidGrantError } from '@/lib/connectors/ga-oauth';

export const GA_DATA_API = 'https://analyticsdata.googleapis.com/v1beta';
export const GA_RANGE_DAYS = 28;

export type GaConfig = {
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  propertyIds: string[];
};

/** Property IDs come from GA_DATA_PROPERTY_IDS only — never hardcoded. */
export function gaDataConfig(env: Record<string, string | undefined> = runtimeEnv()): GaConfig {
  const raw = env.GA_DATA_PROPERTY_IDS ?? '';
  const propertyIds = [...new Set(raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^\d+$/.test(s)))];
  return {
    clientId: env.GA_DATA_CLIENT_ID || undefined,
    clientSecret: env.GA_DATA_CLIENT_SECRET || undefined,
    refreshToken: env.GA_DATA_REFRESH_TOKEN || undefined,
    propertyIds,
  };
}

/** Missing pieces, for the honest not-configured detail (board context only). */
export function gaMissingPieces(config: GaConfig): string[] {
  const missing: string[] = [];
  if (!config.clientId) missing.push('GA_DATA_CLIENT_ID');
  if (!config.clientSecret) missing.push('GA_DATA_CLIENT_SECRET');
  if (!config.refreshToken) missing.push('GA_DATA_REFRESH_TOKEN');
  if (config.propertyIds.length === 0) missing.push('GA_DATA_PROPERTY_IDS');
  return missing;
}

export async function gaDataStatus(env: Record<string, string | undefined> = runtimeEnv()): Promise<ConnectorStatus> {
  const base = { id: 'ga-data', name: 'Google Analytics', kind: 'analytics' } as const;
  const config = gaDataConfig(env);
  const missing = gaMissingPieces(config);
  if (missing.length > 0) {
    return {
      ...base,
      state: 'not_configured',
      detail: `Google Analytics is not connected. Missing: ${missing.join(', ')}. Paste the OAuth client keys and property IDs on the integrations board, then connect with Google.`,
      meta: { properties: config.propertyIds.length },
    };
  }
  try {
    const token = await gaAccessToken();
    if (!token) {
      return { ...base, state: 'error', detail: 'GA credentials are saved but no access token could be minted. Reconnect with Google.', meta: { properties: config.propertyIds.length } };
    }
    return {
      ...base,
      state: 'connected',
      detail: `${config.propertyIds.length} GA4 ${config.propertyIds.length === 1 ? 'property' : 'properties'} · Google grant live · world traffic ready.`,
      meta: { properties: config.propertyIds.length },
    };
  } catch (err) {
    const detail =
      err instanceof GaInvalidGrantError
        ? 'Google refused the GA grant (invalid_grant). Reconnect with Google to issue a fresh grant.'
        : `GA grant check failed: ${err instanceof Error ? err.message : String(err)}`;
    return { ...base, state: 'error', detail, meta: { properties: config.propertyIds.length } };
  }
}

/** Last N days ending yesterday (GA data freshness), as explicit ISO dates. */
export function gaDateRange(days: number = GA_RANGE_DAYS, now: Date = new Date()): { startDate: string; endDate: string } {
  const day = 86_400_000;
  const end = new Date(now.getTime() - day);
  const start = new Date(end.getTime() - (days - 1) * day);
  return { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) };
}

export type GaReportRow = { countryId: string; country: string; city: string | null; users: number; sessions: number };

/** Parse a runReport payload. Guarded — malformed rows are skipped, never invented. */
export function parseGaReport(raw: unknown): GaReportRow[] {
  const rows = (raw as { rows?: unknown })?.rows;
  if (!Array.isArray(rows)) return [];
  const out: GaReportRow[] = [];
  for (const row of rows) {
    const r = (row ?? {}) as { dimensionValues?: { value?: unknown }[]; metricValues?: { value?: unknown }[] };
    const dims = r.dimensionValues ?? [];
    const mets = r.metricValues ?? [];
    const countryId = typeof dims[0]?.value === 'string' ? (dims[0].value as string) : '';
    const country = typeof dims[1]?.value === 'string' ? (dims[1].value as string) : '';
    const cityRaw = typeof dims[2]?.value === 'string' ? (dims[2].value as string) : '';
    const users = Number(mets[0]?.value);
    const sessions = Number(mets[1]?.value);
    if (!country || !Number.isFinite(users) || !Number.isFinite(sessions)) continue;
    out.push({
      countryId,
      country,
      city: cityRaw && cityRaw !== '(not set)' ? cityRaw : null,
      users: Math.max(0, Math.round(users)),
      sessions: Math.max(0, Math.round(sessions)),
    });
  }
  return out;
}

export type GaCityRow = { city: string; users: number; sessions: number };
export type GaCountryRow = {
  countryId: string;
  country: string;
  users: number;
  sessions: number;
  plotted: boolean;
  cities: GaCityRow[];
};
export type GaTraffic = {
  propertyId: string;
  startDate: string;
  endDate: string;
  totalUsers: number;
  totalSessions: number;
  countries: GaCountryRow[];
  unplottedUsers: number;
  unplottedSessions: number;
};

/** Rows → one country row each, cities nested, totals honest (unplotted included). */
export function aggregateGaTraffic(rows: GaReportRow[], propertyId: string, startDate: string, endDate: string): GaTraffic {
  const byCountry = new Map<string, GaCountryRow>();
  let totalUsers = 0;
  let totalSessions = 0;
  let unplottedUsers = 0;
  let unplottedSessions = 0;
  for (const row of rows) {
    totalUsers += row.users;
    totalSessions += row.sessions;
    const key = row.countryId || row.country;
    let c = byCountry.get(key);
    if (!c) {
      const plotted = countryCentroid(row.countryId) !== null;
      c = { countryId: row.countryId, country: row.country, users: 0, sessions: 0, plotted, cities: [] };
      byCountry.set(key, c);
    }
    c.users += row.users;
    c.sessions += row.sessions;
    if (row.city) {
      const hit = c.cities.find((x) => x.city === row.city);
      if (hit) {
        hit.users += row.users;
        hit.sessions += row.sessions;
      } else {
        c.cities.push({ city: row.city, users: row.users, sessions: row.sessions });
      }
    }
  }
  for (const c of byCountry.values()) {
    c.cities.sort((a, b) => b.users - a.users);
    if (!c.plotted) {
      unplottedUsers += c.users;
      unplottedSessions += c.sessions;
    }
  }
  const countries = [...byCountry.values()].sort((a, b) => b.users - a.users);
  return { propertyId, startDate, endDate, totalUsers, totalSessions, countries, unplottedUsers, unplottedSessions };
}

type FetchFn = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** One live runReport. Throws on HTTP errors so the caller reports them honestly. */
export async function gaTrafficForProperty(
  propertyId: string,
  range: { startDate: string; endDate: string },
  opts: { fetchFn?: FetchFn; accessToken?: string } = {},
): Promise<GaTraffic> {
  const token = opts.accessToken ?? (await gaAccessToken());
  if (!token) throw new Error('Google Analytics is not connected (no access token).');
  const fetchFn = (opts.fetchFn ?? fetch) as FetchFn;
  const res = await fetchFn(`${GA_DATA_API}/properties/${propertyId}:runReport`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      dateRanges: [{ startDate: range.startDate, endDate: range.endDate }],
      dimensions: [{ name: 'countryId' }, { name: 'country' }, { name: 'city' }],
      metrics: [{ name: 'totalUsers' }, { name: 'sessions' }],
      limit: '10000',
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`GA Data API answered ${res.status} for property ${propertyId}`);
  const rows = parseGaReport(await res.json());
  return aggregateGaTraffic(rows, propertyId, range.startDate, range.endDate);
}

export type GaWorldData = {
  configured: boolean;
  /** Client id + secret saved but no refresh token yet: the section can offer Connect with Google. */
  oauthReady: boolean;
  propertyIds: string[];
  startDate: string;
  endDate: string;
  rangeLabel: string;
  traffic: Record<string, GaTraffic>;
  errors: Record<string, string>;
};

/**
 * World traffic for every configured property, cached per property + range
 * (60s fresh, 10 min stale-while-revalidate, same window as other live reads).
 * Never throws for API failures: they land in `errors` so the section shows
 * the failure instead of a blank page or fake numbers.
 */
export async function gaTrafficAll(env: Record<string, string | undefined> = runtimeEnv()): Promise<GaWorldData> {
  const config = gaDataConfig(env);
  const range = gaDateRange();
  const base = {
    configured: false,
    oauthReady: Boolean(config.clientId && config.clientSecret && !config.refreshToken),
    propertyIds: config.propertyIds,
    startDate: range.startDate,
    endDate: range.endDate,
    rangeLabel: `Last ${GA_RANGE_DAYS} days`,
    traffic: {} as Record<string, GaTraffic>,
    errors: {} as Record<string, string>,
  };
  if (gaMissingPieces(config).length > 0) return base;
  const token = await gaAccessToken().catch(() => null);
  if (!token) {
    return { ...base, configured: true, errors: { _grant: 'Google refused the GA grant. Reconnect with Google to issue a fresh grant.' } };
  }
  const traffic: Record<string, GaTraffic> = {};
  const errors: Record<string, string> = {};
  await Promise.all(
    config.propertyIds.map(async (propertyId) => {
      try {
        traffic[propertyId] = await swr(`ga-data:traffic:${keyTag(token)}:${propertyId}:${range.startDate}:${range.endDate}`, TTL.social, () =>
          gaTrafficForProperty(propertyId, range, { accessToken: token }),
        );
      } catch (err) {
        errors[propertyId] = err instanceof Error ? err.message : String(err);
      }
    }),
  );
  return { ...base, configured: true, traffic, errors };
}

/** Globe-ready points for one property's traffic: one pin per plotted country, sized by users. */
