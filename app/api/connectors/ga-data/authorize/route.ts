import { NextResponse } from 'next/server';
import { resolveCred } from '@/lib/creds';
import { gaAuthUrl, gaNewState, gaNewVerifier, gaOAuthClient } from '@/lib/connectors/ga-oauth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/connectors/ga-data/authorize -> 200 { url } and state/verifier
 * cookies; the client then navigates to Google. A POST so the GET smoke
 * test never starts a flow. 409 when the OAuth client id or secret is
 * missing. The app's middleware already gates /api routes behind the
 * operator session, so only a signed-in operator can start this flow.
 */
export async function POST(request: Request) {
  const client = gaOAuthClient();
  if (!client) return NextResponse.json({ ok: false, error: 'GA OAuth client is not configured (GA_DATA_CLIENT_ID / GA_DATA_CLIENT_SECRET).' }, { status: 409 });
  const origin = new URL(request.url).origin;
  const redirectUri = resolveCred('GA_DATA_REDIRECT_URI', []) ?? `${origin}/api/connectors/ga-data/callback`;
  const state = gaNewState();
  const verifier = gaNewVerifier();
  const url = gaAuthUrl({ clientId: client.clientId, redirectUri, state, verifier });
  const res = NextResponse.json({ ok: true, url });
  const attrs = 'HttpOnly; SameSite=Lax; Path=/api/connectors/ga-data/; Max-Age=600';
  res.headers.append('Set-Cookie', `ga_oauth_state=${state}; ${attrs}`);
  res.headers.append('Set-Cookie', `ga_oauth_verifier=${verifier}; ${attrs}`);
  return res;
}
