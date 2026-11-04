import { NextResponse } from 'next/server';
import { resolveCred, upsertEnvLocal } from '@/lib/creds';
import { gaExchangeCode, gaOAuthClient } from '@/lib/connectors/ga-oauth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

/**
 * GET /api/connectors/ga-data/callback?code=…&state=… — Google returns here
 * after consent. Validates the state cookie, exchanges the code for tokens,
 * and writes ONLY GA_DATA_REFRESH_TOKEN to .env.local (never echoed back).
 * Then redirects to /analytics, where the section now reads live GA data.
 * Failures answer a plain 400 with the reason — no token material in it.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const cookies = parseCookies(request.headers.get('cookie'));
  const clear = 'HttpOnly; SameSite=Lax; Path=/api/connectors/ga-data/; Max-Age=0';
  const fail = (message: string, status = 400) => {
    const res = new NextResponse(message, { status });
    res.headers.append('Set-Cookie', `ga_oauth_state=; ${clear}`);
    res.headers.append('Set-Cookie', `ga_oauth_verifier=; ${clear}`);
    return res;
  };
  if (!code || !state || cookies.ga_oauth_state !== state || !cookies.ga_oauth_verifier) {
    return fail('Invalid OAuth state. Start again from the Analytics page.');
  }
  const client = gaOAuthClient();
  if (!client) return fail('GA OAuth client is not configured.');
  const redirectUri = resolveCred('GA_DATA_REDIRECT_URI', []) ?? `${url.origin}/api/connectors/ga-data/callback`;
  try {
    const { refreshToken } = await gaExchangeCode({ code, verifier: cookies.ga_oauth_verifier, redirectUri, clientId: client.clientId, clientSecret: client.clientSecret });
    upsertEnvLocal({ GA_DATA_REFRESH_TOKEN: refreshToken });
  } catch (err) {
    return fail(`Google sign-in failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  const res = NextResponse.redirect(new URL('/analytics', url.origin));
  res.headers.append('Set-Cookie', `ga_oauth_state=; ${clear}`);
  res.headers.append('Set-Cookie', `ga_oauth_verifier=; ${clear}`);
  return res;
}
