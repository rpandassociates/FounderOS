/**
 * GA connector tests — pure functions plus the token mint behind a stubbed
 * fetch. No network, no real credentials: the env values here are dummy
 * strings, and the stubbed token endpoint never leaves the test process.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { countryCentroid, gaGlobePoints } from '@/lib/ga-countries';
import {
  GA_RANGE_DAYS,
  aggregateGaTraffic,
  gaDataConfig,
  gaDataStatus,
  gaDateRange,
  gaMissingPieces,
  gaTrafficForProperty,
  parseGaReport,
} from '@/lib/connectors/ga-data';
import { GaInvalidGrantError, clearGaTokenCache, gaAccessToken, gaExchangeCode, type OAuthFetch } from '@/lib/connectors/ga-oauth';

const FULL_ENV = {
  GA_DATA_CLIENT_ID: 'test-client-id',
  GA_DATA_CLIENT_SECRET: 'test-client-secret',
  GA_DATA_REFRESH_TOKEN: 'test-refresh-token',
  GA_DATA_PROPERTY_IDS: '123,456',
};

function setProcessEnv(env: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

beforeEach(() => {
  clearGaTokenCache();
  setProcessEnv(FULL_ENV);
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearGaTokenCache();
  setProcessEnv({
    GA_DATA_CLIENT_ID: undefined,
    GA_DATA_CLIENT_SECRET: undefined,
    GA_DATA_REFRESH_TOKEN: undefined,
    GA_DATA_PROPERTY_IDS: undefined,
  });
});

const tokenFetch = (accessToken = 'test-access-token'): OAuthFetch =>
  (async () => ({
    ok: true,
    status: 200,
    json: async () => ({ access_token: accessToken, expires_in: 3600 }),
    text: async () => '',
  })) as OAuthFetch;

describe('gaDataConfig', () => {
  test('keeps numeric property ids, trims, drops junk, dedupes', () => {
    const config = gaDataConfig({ GA_DATA_PROPERTY_IDS: ' 123 , abc, 456, 123, 12x ' });
    expect(config.propertyIds).toEqual(['123', '456']);
  });
  test('empty env gives no properties', () => {
    expect(gaDataConfig({}).propertyIds).toEqual([]);
  });
});

describe('gaMissingPieces', () => {
  test('lists every missing name', () => {
    expect(gaMissingPieces(gaDataConfig({}))).toEqual([
      'GA_DATA_CLIENT_ID',
      'GA_DATA_CLIENT_SECRET',
      'GA_DATA_REFRESH_TOKEN',
      'GA_DATA_PROPERTY_IDS',
    ]);
  });
  test('full config has no missing pieces', () => {
    expect(gaMissingPieces(gaDataConfig(FULL_ENV))).toEqual([]);
  });
  test('client keys without a refresh token is oauth-ready, not complete', () => {
    const missing = gaMissingPieces(gaDataConfig({ GA_DATA_CLIENT_ID: 'x', GA_DATA_CLIENT_SECRET: 'y', GA_DATA_PROPERTY_IDS: '1' }));
    expect(missing).toEqual(['GA_DATA_REFRESH_TOKEN']);
  });
});

describe('gaDateRange', () => {
  test('last 28 days ending yesterday, explicit dates', () => {
    const range = gaDateRange(28, new Date('2026-11-04T12:00:00Z'));
    expect(range).toEqual({ startDate: '2026-10-07', endDate: '2026-11-03' });
  });
  test('one day is just yesterday', () => {
    expect(gaDateRange(1, new Date('2026-11-04T12:00:00Z'))).toEqual({ startDate: '2026-11-03', endDate: '2026-11-03' });
  });
  test('default range is GA_RANGE_DAYS', () => {
    expect(GA_RANGE_DAYS).toBe(28);
  });
});

const runReportPayload = {
  rows: [
    { dimensionValues: [{ value: 'US' }, { value: 'United States' }, { value: 'New York' }], metricValues: [{ value: '120' }, { value: '200' }] },
    { dimensionValues: [{ value: 'US' }, { value: 'United States' }, { value: 'Austin' }], metricValues: [{ value: '30' }, { value: '40' }] },
    { dimensionValues: [{ value: 'US' }, { value: 'United States' }, { value: '(not set)' }], metricValues: [{ value: '10' }, { value: '15' }] },
    { dimensionValues: [{ value: 'ZZ' }, { value: 'Nowhere Land' }, { value: 'Nowhere City' }], metricValues: [{ value: '5' }, { value: '7' }] },
    // malformed: no country, non-numeric users — both skipped, never invented
    { dimensionValues: [{ value: 'GB' }, { value: '' }, { value: 'London' }], metricValues: [{ value: '9' }, { value: '9' }] },
    { dimensionValues: [{ value: 'GB' }, { value: 'United Kingdom' }, { value: 'London' }], metricValues: [{ value: 'n/a' }, { value: '9' }] },
  ],
};

describe('parseGaReport', () => {
  test('maps rows, folds (not set) city to null, skips malformed rows', () => {
    const rows = parseGaReport(runReportPayload);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toEqual({ countryId: 'US', country: 'United States', city: 'New York', users: 120, sessions: 200 });
    expect(rows[2]).toEqual({ countryId: 'US', country: 'United States', city: null, users: 10, sessions: 15 });
    expect(rows[3].countryId).toBe('ZZ');
  });
  test('no rows field gives no rows', () => {
    expect(parseGaReport({})).toEqual([]);
    expect(parseGaReport(null)).toEqual([]);
  });
});

describe('aggregateGaTraffic', () => {
  const traffic = aggregateGaTraffic(parseGaReport(runReportPayload), '123', '2026-10-07', '2026-11-03');
  test('countries sorted by users, cities nested and sorted', () => {
    expect(traffic.countries.map((c) => c.country)).toEqual(['United States', 'Nowhere Land']);
    const us = traffic.countries[0];
    expect(us.users).toBe(160);
    expect(us.sessions).toBe(255);
    expect(us.cities.map((c) => c.city)).toEqual(['New York', 'Austin']);
    expect(us.plotted).toBe(true);
  });
  test('totals include unplotted countries, and the section can say so', () => {
    expect(traffic.totalUsers).toBe(165);
    expect(traffic.totalSessions).toBe(262);
    expect(traffic.unplottedUsers).toBe(5);
    expect(traffic.unplottedSessions).toBe(7);
    expect(traffic.countries[1].plotted).toBe(false);
  });
  test('carries property and range through', () => {
    expect(traffic.propertyId).toBe('123');
    expect(traffic.startDate).toBe('2026-10-07');
    expect(traffic.endDate).toBe('2026-11-03');
  });
});

describe('countryCentroid + gaGlobePoints', () => {
  test('known country resolves, unknown returns null', () => {
    expect(countryCentroid('US')).toEqual({ lat: 39.8, lng: -98.6 });
    expect(countryCentroid('us')).toEqual({ lat: 39.8, lng: -98.6 });
    expect(countryCentroid('ZZ')).toBeNull();
  });
  test('pins only for plotted countries, sized by users, sessions as secondary', () => {
    const traffic = aggregateGaTraffic(parseGaReport(runReportPayload), '123', '2026-10-07', '2026-11-03');
    const points = gaGlobePoints(traffic.countries);
    expect(points).toHaveLength(1);
    expect(points[0]).toEqual({ city: 'United States', country: 'United States', lat: 39.8, lng: -98.6, leads: 160, bookings: 255 });
  });
});

describe('gaTrafficForProperty', () => {
  test('posts runReport for country/city and returns aggregated traffic', async () => {
    let seenUrl = '';
    let seenBody = '';
    const fetchFn = (async (url: string, init?: { body?: string }) => {
      seenUrl = url;
      seenBody = init?.body ?? '';
      return { ok: true, status: 200, json: async () => runReportPayload };
    }) as never;
    const traffic = await gaTrafficForProperty('123', { startDate: '2026-10-07', endDate: '2026-11-03' }, { fetchFn, accessToken: 'tok' });
    expect(seenUrl).toContain('/properties/123:runReport');
    expect(JSON.parse(seenBody).dimensions.map((d: { name: string }) => d.name)).toEqual(['countryId', 'country', 'city']);
    expect(traffic.totalUsers).toBe(165);
  });
  test('HTTP errors throw so the caller reports them honestly', async () => {
    const fetchFn = (async () => ({ ok: false, status: 403, json: async () => ({}) })) as never;
    await expect(gaTrafficForProperty('123', { startDate: '2026-10-07', endDate: '2026-11-03' }, { fetchFn, accessToken: 'tok' })).rejects.toThrow('403');
  });
});

describe('gaAccessToken', () => {
  test('mints from the refresh token and caches until expiry', async () => {
    const f = vi.fn(tokenFetch());
    expect(await gaAccessToken({ fetch: f })).toBe('test-access-token');
    expect(await gaAccessToken({ fetch: f })).toBe('test-access-token');
    expect(f).toHaveBeenCalledTimes(1);
  });
  test('invalid_grant throws GaInvalidGrantError', async () => {
    const f = (async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: 'invalid_grant' }),
      text: async () => '',
    })) as never;
    await expect(gaAccessToken({ fetch: f })).rejects.toBeInstanceOf(GaInvalidGrantError);
  });
  test('no refresh token gives null, never a throw', async () => {
    setProcessEnv({ GA_DATA_REFRESH_TOKEN: undefined });
    clearGaTokenCache();
    expect(await gaAccessToken({ fetch: tokenFetch() })).toBeNull();
  });
});

describe('gaExchangeCode', () => {
  test('throws when Google returns no refresh token', async () => {
    const f = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'at' }),
      text: async () => '',
    })) as never;
    await expect(
      gaExchangeCode({ code: 'c', verifier: 'v', redirectUri: 'http://localhost:3000/api/connectors/ga-data/callback', clientId: 'id', clientSecret: 'sec' }, f),
    ).rejects.toThrow('no refresh token');
  });
});

describe('gaDataStatus', () => {
  test('incomplete env reports not_configured with the missing names', async () => {
    const status = await gaDataStatus({});
    expect(status.state).toBe('not_configured');
    expect(status.id).toBe('ga-data');
    expect(status.detail).toContain('GA_DATA_CLIENT_ID');
  });
  test('complete env with a live grant reports connected', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ access_token: 'at', expires_in: 3600 }), { status: 200 })));
    const status = await gaDataStatus(FULL_ENV);
    expect(status.state).toBe('connected');
    expect(status.meta?.properties).toBe(2);
  });
  test('dead grant reports error, not a green dot', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })));
    const status = await gaDataStatus(FULL_ENV);
    expect(status.state).toBe('error');
    expect(status.detail).toContain('invalid_grant');
  });
});
