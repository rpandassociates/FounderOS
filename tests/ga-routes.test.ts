/**
 * GA OAuth route failure paths — no network, no real credentials. The
 * success path (Google redirect → token exchange → .env.local write) cannot
 * run in tests, so these cover the guards: authorize refuses without an
 * OAuth client, the callback refuses without a valid state cookie.
 */
import { afterEach, describe, expect, test } from 'vitest';
import { POST as authorize } from '@/app/api/connectors/ga-data/authorize/route';
import { GET as callback } from '@/app/api/connectors/ga-data/callback/route';

const SAVED = {
  GA_DATA_CLIENT_ID: process.env.GA_DATA_CLIENT_ID,
  GA_DATA_CLIENT_SECRET: process.env.GA_DATA_CLIENT_SECRET,
};

afterEach(() => {
  if (SAVED.GA_DATA_CLIENT_ID === undefined) delete process.env.GA_DATA_CLIENT_ID;
  else process.env.GA_DATA_CLIENT_ID = SAVED.GA_DATA_CLIENT_ID;
  if (SAVED.GA_DATA_CLIENT_SECRET === undefined) delete process.env.GA_DATA_CLIENT_SECRET;
  else process.env.GA_DATA_CLIENT_SECRET = SAVED.GA_DATA_CLIENT_SECRET;
});

describe('POST /api/connectors/ga-data/authorize', () => {
  test('409 when the OAuth client id or secret is missing', async () => {
    delete process.env.GA_DATA_CLIENT_ID;
    delete process.env.GA_DATA_CLIENT_SECRET;
    const res = await authorize(new Request('http://localhost/api/connectors/ga-data/authorize', { method: 'POST' }));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toMatch(/not configured/);
  });
});

describe('GET /api/connectors/ga-data/callback', () => {
  test('400 with no state cookie at all', async () => {
    const res = await callback(new Request('http://localhost/api/connectors/ga-data/callback?code=c&state=s'));
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/Invalid OAuth state/);
  });
  test('400 when the state cookie does not match the query', async () => {
    const res = await callback(
      new Request('http://localhost/api/connectors/ga-data/callback?code=c&state=s', {
        headers: { cookie: 'ga_oauth_state=other; ga_oauth_verifier=v' },
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/Invalid OAuth state/);
  });
  test('400 (not a redirect) when state matches but no OAuth client is configured', async () => {
    delete process.env.GA_DATA_CLIENT_ID;
    delete process.env.GA_DATA_CLIENT_SECRET;
    const res = await callback(
      new Request('http://localhost/api/connectors/ga-data/callback?code=c&state=s', {
        headers: { cookie: 'ga_oauth_state=s; ga_oauth_verifier=v' },
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/not configured/);
  });
});
