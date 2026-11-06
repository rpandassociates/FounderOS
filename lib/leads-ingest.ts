/**
 * Lead ingest for the Forminator -> Core feeder — REBUILD (v2).
 *
 * Written against Core's REAL schema (lib/db.ts), replacing the first
 * build, which was written against invented layouts and failed QA:
 *  - funnel_contacts requires id, venture and status on every insert
 *    (all NOT NULL, no defaults). status is the stage enum:
 *    first_touch | engaged | nurtured | opted_in | converted.
 *    There is no 'new' status — it breaks funnel.journeys().
 *  - funnel_contacts has NO external_id column. Dedupe is by
 *    (lowercased email, venture); an existing contact gets name/phone
 *    refreshed and its status is NEVER regressed.
 *  - funnel_touches requires id, seq, stage, channel, label, source,
 *    at on every row. A form submission writes stage 'opted_in',
 *    channel 'organic', source 'wordpress' (the enum value added to
 *    FunnelSourceSchema; channelOfJourney classifies it as Forms).
 *  - lead_magnets has NO slug column and contacts have no magnet link
 *    column. Magnets are registered beforehand via POST
 *    /api/lead-magnets; the feeder takes an optional magnetId and
 *    rejects the submission with 400 when it does not exist.
 *  - Ids are deterministic: contact from (email, venture), touch from
 *    (form, entryId), so a re-POSTed submission can never duplicate.
 *
 * Kept from the first build (QA-approved): timing-safe Bearer auth,
 * validation before any write, the thin route wrapper, no secrets.
 */
import { createHash, timingSafeEqual } from 'node:crypto';

export const FUNNEL_STAGES = ['first_touch', 'engaged', 'nurtured', 'opted_in', 'converted'] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];
export const STAGE_INDEX: Record<FunnelStage, number> = {
  first_touch: 0,
  engaged: 1,
  nurtured: 2,
  opted_in: 3,
  converted: 4,
};

/** An ingest failure that maps to a specific HTTP status in the route. */
export class LeadIngestError extends Error {
  httpStatus: number;
  constructor(httpStatus: number, message: string) {
    super(message);
    this.httpStatus = httpStatus;
  }
}

export type LeadPayload = {
  venture: string;
  magnetId?: string;
  form_id: string;
  form_title?: string;
  entry_id: string;
  name?: string;
  email: string;
  phone?: string;
  company?: string;
  submitted_at?: string;
};

/** Bearer-token check with a timing-safe compare. */
export function verifyLeadToken(header: string | null, expected: string | undefined): boolean {
  if (!expected || !header) return false;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!m) return false;
  const got = Buffer.from(m[1]);
  const want = Buffer.from(expected);
  return got.length === want.length && timingSafeEqual(got, want);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function str(v: unknown, cap: number): string | undefined {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  return s === '' ? undefined : s.slice(0, cap);
}

export function validateLeadPayload(
  body: unknown,
): { ok: true; lead: LeadPayload } | { ok: false; error: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, error: 'body must be a JSON object' };
  }
  const b = body as Record<string, unknown>;
  const email = str(b.email, 254);
  if (!email || !EMAIL_RE.test(email)) return { ok: false, error: 'a valid email is required' };
  const entry = str(b.entry_id, 120) ?? str(b.external_id, 120);
  if (!entry) return { ok: false, error: 'entry_id is required (idempotency key)' };
  const lead: LeadPayload = {
    venture: str(b.venture, 80) ?? 'default',
    magnetId: str(b.magnetId, 120) ?? str(b.magnet_id, 120),
    form_id: str(b.form_id, 80) ?? 'unknown',
    form_title: str(b.form_title, 200),
    entry_id: entry,
    name: str(b.name, 200),
    email,
    phone: str(b.phone, 40),
    company: str(b.company, 200),
    submitted_at: str(b.submitted_at, 40),
  };
  return { ok: true, lead };
}

export function contactIdFor(emailLower: string, venture: string): string {
  return createHash('sha256').update(`lead:${venture}:${emailLower}`).digest('hex');
}

export function touchIdFor(formId: string, entryId: string): string {
  return createHash('sha256').update(`touch:${formId}:${entryId}`).digest('hex');
}

/** The narrow DB seam (production: getLeadDb below; tests: harness). */
export interface LeadDb {
  columns(table: string): string[];
  get(sql: string, ...params: unknown[]): Record<string, unknown> | undefined;
  run(sql: string, ...params: unknown[]): { lastInsertRowid: number | bigint };
}

export type InsertResult = {
  id: string;
  existed: boolean;
  status: string;
  touchId: string;
  touchCreated: boolean;
};

export function insertLead(db: LeadDb, lead: LeadPayload): InsertResult {
  const iso = lead.submitted_at ?? new Date().toISOString();
  const emailLower = lead.email.toLowerCase();

  // Magnet gate FIRST: an unknown magnetId rejects the whole
  // submission (400) before anything is written.
  if (lead.magnetId) {
    const found = db.columns('lead_magnets').length
      ? db.get('SELECT id FROM "lead_magnets" WHERE id = ?', lead.magnetId)
      : undefined;
    if (!found) throw new LeadIngestError(400, `unknown magnetId: ${lead.magnetId}`);
  }

  // Dedupe by (lowercased email, venture) — the real table's identity
  // for a form lead. There is no external_id column to lean on.
  const existing = db.get(
    'SELECT id, status FROM "funnel_contacts" WHERE lower(email) = ? AND venture = ?',
    emailLower,
    lead.venture,
  );

  let contactId: string;
  let status: string;
  let existed = false;
  if (existing) {
    existed = true;
    contactId = String(existing.id);
    status = String(existing.status);
    // Refresh ONLY name/phone (and person, its mirror). Status is
    // never written here, so a stage can never regress — a converted
    // contact stays converted (STAGE_INDEX documents the ordering
    // this guard preserves).
    const sets: string[] = [];
    const params: unknown[] = [];
    if (lead.name) {
      sets.push('name = ?', 'person = ?');
      params.push(lead.name, lead.name);
    }
    if (lead.phone) {
      sets.push('phone = ?');
      params.push(lead.phone);
    }
    if (sets.length) {
      db.run(`UPDATE "funnel_contacts" SET ${sets.join(', ')} WHERE id = ?`, ...params, contactId);
    }
  } else {
    contactId = contactIdFor(emailLower, lead.venture);
    const displayName = lead.name ?? emailLower.split('@')[0];
    status = 'opted_in';
    db.run(
      `INSERT INTO "funnel_contacts"
         (id, name, venture, status, email, phone, person, company, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      contactId,
      displayName,
      lead.venture,
      status,
      lead.email,
      lead.phone ?? null,
      displayName,
      lead.company ?? null,
      iso,
    );
  }

  // The touch. Deterministic id: a re-POST of the same entry finds
  // the row already there and writes nothing.
  const touchId = touchIdFor(lead.form_id, lead.entry_id);
  let touchCreated = false;
  const dupeTouch = db.get('SELECT id FROM "funnel_touches" WHERE id = ?', touchId);
  if (!dupeTouch) {
    const seqRow = db.get(
      'SELECT COALESCE(MAX(seq), 0) AS maxseq FROM "funnel_touches" WHERE contact_id = ?',
      contactId,
    );
    const seq = Number(seqRow?.maxseq ?? 0) + 1;
    db.run(
      `INSERT INTO "funnel_touches" (id, contact_id, seq, stage, channel, label, source, at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      touchId,
      contactId,
      seq,
      'opted_in',
      'organic',
      lead.form_title ?? `Form ${lead.form_id}`,
      'wordpress',
      iso,
    );
    touchCreated = true;
  }

  return { id: contactId, existed, status, touchId, touchCreated };
}

let cached: LeadDb | null = null;

/**
 * Production DB handle: Core's SQLite file via better-sqlite3. If
 * Core's data layer differs, replace ONLY this function's body with
 * Core's own db helper (or its funnel.insertContact / insertTouch,
 * which zod-validate) — the rest of the module is driver-agnostic.
 * Path: GLADOS_DB env, else <cwd>/data/glados.db (real-mode data dir).
 */
export function getLeadDb(): LeadDb {
  if (cached) return cached;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('better-sqlite3');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('node:path') as typeof import('node:path');
  const file = process.env.GLADOS_DB ?? path.join(process.cwd(), 'data', 'glados.db');
  const db = new Database(file);
  cached = {
    columns(table: string): string[] {
      return (db.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[]).map((r) => r.name);
    },
    get(sql: string, ...params: unknown[]) {
      return db.prepare(sql).get(...params) as Record<string, unknown> | undefined;
    },
    run(sql: string, ...params: unknown[]) {
      const info = db.prepare(sql).run(...params) as { lastInsertRowid: number | bigint };
      return { lastInsertRowid: info.lastInsertRowid };
    },
  };
  return cached;
}
