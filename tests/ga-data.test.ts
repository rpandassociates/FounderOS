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
  gaTrafficAll,
  gaTrafficForProperty,
  normalizeGaHost,
  parseGaReport,
  resolveGaPropertyLabels,
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

describe('normalizeGaHost', () => {
  test('strips scheme and trailing slash', () => {
    expect(normalizeGaHost('https://landscaping.thecreativityfoundry.com/')).toBe('landscaping.thecreativityfoundry.com');
  });
  test('a bare host passes through unchanged, lowercased', () => {
    expect(normalizeGaHost('landscaping.thecreativityfoundry.com')).toBe('landscaping.thecreativityfoundry.com');
    expect(normalizeGaHost('HTTPS://Example.COM')).toBe('example.com');
  });
  test('drops path, query, fragment and port', () => {
    expect(normalizeGaHost('https://example.com/some/path')).toBe('example.com');
    expect(normalizeGaHost('https://example.com:8443/a?b=c#d')).toBe('example.com');
  });
  test('empty or garbage gives an empty string', () => {
    expect(normalizeGaHost('')).toBe('');
    expect(normalizeGaHost('   ')).toBe('');
    expect(normalizeGaHost('not a url!!')).toBe('');
    expect(normalizeGaHost('https://')).toBe('');
  });
});

const jsonRes = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });

/** Stub for the Admin API: accountSummaries body + dataStreams body per property id. */
const adminFetch = (opts: { summaries?: unknown; streams?: Record<string, unknown>; status?: number }) =>
  (async (url: string) => {
    if (opts.status && opts.status >= 400) return jsonRes({}, opts.status);
    if (url.includes('/accountSummaries')) return jsonRes(opts.summaries ?? {});
    const m = /\/properties\/(\d+)\/dataStreams/.exec(url);
    if (m) return jsonRes(opts.streams?.[m[1]] ?? {});
    return jsonRes({}, 404);
  }) as never;

const webStream = (defaultUri: string) => ({ dataStreams: [{ type: 'WEB_DATA_STREAM', webStreamData: { defaultUri } }] });

describe('resolveGaPropertyLabels', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  test('merges displayNames with stream hosts; the host wins over the displayName', async () => {
    const fetchFn = adminFetch({
      summaries: {
        accountSummaries: [
          { propertySummaries: [{ property: 'properties/111', displayName: 'Alpha Site' }, { property: 'properties/222', displayName: 'Beta Site' }] },
        ],
      },
      streams: { '111': webStream('https://alpha.example.com/'), '222': {} },
    });
    const labels = await resolveGaPropertyLabels(['111', '222'], 'tok', { fetchFn });
    expect(labels['111']).toBe('alpha.example.com');
    expect(labels['222']).toBe('Beta Site');
  });

  test('uses the first WEB_DATA_STREAM and skips non-web streams', async () => {
    const fetchFn = adminFetch({
      streams: {
        '111': {
          dataStreams: [
            { type: 'ANDROID_APP_DATA_STREAM' },
            { type: 'WEB_DATA_STREAM', webStreamData: { defaultUri: 'HTTPS://One.Example.com/path' } },
            { type: 'WEB_DATA_STREAM', webStreamData: { defaultUri: 'https://two.example.com' } },
          ],
        },
      },
    });
    expect((await resolveGaPropertyLabels(['111'], 'tok', { fetchFn }))['111']).toBe('one.example.com');
  });

  test('calls the Admin API with the Bearer token only', async () => {
    const seen: { url: string; auth?: string }[] = [];
    const fetchFn = (async (url: string, init?: { headers?: Record<string, string> }) => {
      seen.push({ url, auth: init?.headers?.Authorization });
      return jsonRes({});
    }) as never;
    await resolveGaPropertyLabels(['111'], 'tok', { fetchFn });
    expect(seen.map((x) => x.url)).toEqual([
      'https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200',
      'https://analyticsadmin.googleapis.com/v1beta/properties/111/dataStreams?pageSize=10',
    ]);
    expect(seen.every((x) => x.auth === 'Bearer tok')).toBe(true);
  });

  test('Admin API 403 on every call falls back to the map, then to the numeric id', async () => {
    const labels = await resolveGaPropertyLabels(['562396793', '999'], 'tok', { fetchFn: adminFetch({ status: 403 }) });
    expect(labels['562396793']).toBe('landscaping.thecreativityfoundry.com');
    expect(labels['999']).toBe('999');
  });

  test('a network error falls back instead of throwing', async () => {
    const fetchFn = (async () => {
      throw new Error('network down');
    }) as never;
    await expect(resolveGaPropertyLabels(['562394779'], 'tok', { fetchFn })).resolves.toEqual({ '562394779': 'thecreativityfoundry.com' });
  });

  test('no web stream and no displayName falls back to the map', async () => {
    const fetchFn = adminFetch({ summaries: { accountSummaries: [] }, streams: { '562394779': {} } });
    expect((await resolveGaPropertyLabels(['562394779'], 'tok', { fetchFn }))['562394779']).toBe('thecreativityfoundry.com');
  });

  test('a property in neither the Admin API response nor the map is labelled by its numeric id', async () => {
    const fetchFn = adminFetch({ summaries: { accountSummaries: [] }, streams: {} });
    expect(await resolveGaPropertyLabels(['999'], 'tok', { fetchFn })).toEqual({ '999': '999' });
  });
});

describe('gaTrafficAll property labels', () => {
  afterEach(() => vi.restoreAllMocks());

  test('traffic still loads when label resolution fails (labels fail, globe does not)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('analyticsadmin')) throw new Error('admin api down');
        if (url.includes('analyticsdata')) return new Response(JSON.stringify(runReportPayload), { status: 200 });
        return new Response(JSON.stringify({ access_token: 'at', expires_in: 3600 }), { status: 200 });
      }),
    );
    const world = await gaTrafficAll({ ...FULL_ENV, GA_DATA_PROPERTY_IDS: '777001' });
    expect(world.configured).toBe(true);
    expect(world.errors).toEqual({});
    expect(world.traffic['777001'].totalUsers).toBe(165);
    expect(world.propertyLabels['777001']).toBe('777001');
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
