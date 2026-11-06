/**
 * POST /api/leads/ingest — Forminator -> Core lead feeder (rebuild v2).
 * Bearer: LEADS_INGEST_TOKEN. Bad body = 400, writes nothing.
 * Unknown magnetId = 400 (LeadIngestError). All logic in
 * lib/leads-ingest.ts; this is the HTTP wrapper.
 *
 * NOTE: this path must also be added to TOKEN_PATHS in
 * lib/auth-gate.ts (see patches/auth-gate.patch in the feeder pack),
 * or the gate returns 401 before this handler ever runs.
 */
import { NextResponse } from 'next/server';
import {
  LeadIngestError,
  getLeadDb,
  insertLead,
  validateLeadPayload,
  verifyLeadToken,
} from '@/lib/leads-ingest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const expected = process.env.LEADS_INGEST_TOKEN;
  if (!expected) {
    return NextResponse.json({ ok: false, error: 'lead ingest not configured' }, { status: 503 });
  }
  if (!verifyLeadToken(req.headers.get('authorization'), expected)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400 });
  }
  const v = validateLeadPayload(body);
  if (!v.ok) {
    return NextResponse.json({ ok: false, error: v.error }, { status: 400 });
  }
  try {
    const result = insertLead(getLeadDb(), v.lead);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof LeadIngestError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: err.httpStatus });
    }
    console.error('[leads/ingest]', err);
    return NextResponse.json({ ok: false, error: 'ingest failed' }, { status: 500 });
  }
}
