import { emailStatus } from '@/lib/connectors/email';
import { calendarStatus } from '@/lib/connectors/gcal';
import { slackStatus } from '@/lib/connectors/slack';
import { paymentsStatus } from '@/lib/connectors/payments';
import { notionStatus } from '@/lib/connectors/notion';
import { zernioStatus } from '@/lib/connectors/zernio';
import { beehiivStatus } from '@/lib/connectors/beehiiv';
import { manychatStatus } from '@/lib/connectors/manychat';
import { attioStatus } from '@/lib/connectors/attio';
import { arcadsStatus } from '@/lib/connectors/arcads';
import { miroStatus } from '@/lib/connectors/miro';
import { wisprStatus } from '@/lib/connectors/wispr';
import { whatsappStatus } from '@/lib/connectors/whatsapp';
import { obsidianStatus } from '@/lib/connectors/obsidian';
import { localStackStatus } from '@/lib/connectors/local-stack';
import { llmStatus } from '@/lib/connectors/llm';
import { webinarjamStatus } from '@/lib/connectors/webinarjam';
import { trakyoStatus } from '@/lib/connectors/trakyo';
import { metaAdsStatus } from '@/lib/connectors/meta-ads';
import { gaDataStatus } from '@/lib/connectors/ga-data';
import { foreplayStatus } from '@/lib/connectors/foreplay';
import { ghlStatus } from '@/lib/connectors/ghl';
import { apifyStatus } from '@/lib/connectors/apify';
import { robinhoodConnectorStatus } from '@/lib/connectors/robinhood';
import { phantomConnectorStatus } from '@/lib/connectors/phantom';
import { plaudConnectorStatus } from '@/lib/connectors/plaud';
import { fathomStatus } from '@/lib/connectors/fathom';
import { supersetConnectorStatus } from '@/lib/connectors/superset';
import { getBrainProvider } from '@/lib/brain';
import { resolveManychatKey, runtimeEnv } from '@/lib/creds';
import type { ConnectorStatus } from '@/lib/connectors/types';
import { isFilming, demoConnectors } from '@/lib/demo-mode';
import { CONNECTORS_SWR_KEY, CONNECTORS_SWR_PREFIX, TTL, swr } from '@/lib/swr';

async function brainConnectorStatus(): Promise<ConnectorStatus> {
  const status = await getBrainProvider().status();
  return {
    id: 'gbrain',
    name: 'Optimal Engine',
    kind: 'brain',
    state: status.connected ? 'connected' : 'error',
    detail: status.detail,
    meta: { provider: status.provider },
  };
}

const CHECKS: [string, ConnectorStatus['kind'], () => Promise<ConnectorStatus>][] = [
  ['gbrain', 'brain', brainConnectorStatus],
  ['llm', 'orchestration', llmStatus],
  ['whatsapp', 'social', whatsappStatus],
  ['zernio', 'social', zernioStatus],
  ['beehiiv', 'social', () => beehiivStatus(runtimeEnv())],
  [
    'manychat',
    'social',
    () => {
      // the operator's real key rides in ~/.config/mcp.json (the manychat MCP
      // registration), same reuse pattern as Attio — .env.local still wins.
      const env = runtimeEnv();
      if (!env.MANYCHAT_API_KEY) env.MANYCHAT_API_KEY = resolveManychatKey();
      return manychatStatus(env);
    },
  ],
  ['attio', 'crm', attioStatus],
  ['webinarjam', 'crm', webinarjamStatus],
  ['trakyo', 'crm', trakyoStatus],
  ['meta-ads', 'ads', metaAdsStatus],
  ['ga-data', 'analytics', gaDataStatus],
  ['foreplay', 'creative', foreplayStatus],
  ['apify', 'social', apifyStatus],
  ['ghl', 'crm', ghlStatus],
  ['arcads', 'creative', arcadsStatus],
  ['wispr', 'local', wisprStatus],
  ['local-stack', 'local', localStackStatus],
  ['obsidian', 'knowledge', obsidianStatus],
  ['miro', 'creative', miroStatus],
  ['email', 'email', () => emailStatus(runtimeEnv())],
  ['calendar', 'calendar', calendarStatus],
  ['slack', 'slack', () => slackStatus(runtimeEnv())],
  ['payments', 'payments', () => paymentsStatus(runtimeEnv())],
  ['notion', 'notion', () => notionStatus(runtimeEnv())],
  // FounderOS merge (SPEC §2.4). Robinhood and Plaud read the local store (feed
  // freshness, pushed recordings); Phantom and Fathom make one free, cached read.
  ['robinhood', 'payments', robinhoodConnectorStatus],
  ['phantom', 'payments', phantomConnectorStatus],
  ['plaud', 'knowledge', plaudConnectorStatus],
  ['fathom', 'crm', () => fathomStatus()],
  ['superset', 'orchestration', supersetConnectorStatus],
];

/**
 * Every connector's live status. Pages (Home, Connections, Setup, Blueprint) share one
 * stale-while-revalidate result (lib/swr.ts): a real check at most 60s old renders at once,
 * an older one (up to 10 min) renders while a fresh check runs behind it, and only a cold
 * server waits for the checks. `fresh: true` always checks now (and refreshes the shared
 * result). Saving or removing a key clears it (lib/creds.ts), so a new key shows on the
 * next render, never a stale "Not configured".
 */
export async function allConnectorStatuses(opts: { fresh?: boolean } = {}): Promise<ConnectorStatus[]> {
  // Filming mode: scripted stand-in (lib/demo-mode.ts)
  if (isFilming()) return demoConnectors();
  return swr(CONNECTORS_SWR_KEY, opts.fresh ? { freshMs: 0, maxStaleMs: 0 } : TTL.connector, checkAll);
}

async function checkAll(): Promise<ConnectorStatus[]> {
  return Promise.all(
    CHECKS.map(([id, kind, check]) =>
      check().catch(
        (err): ConnectorStatus => ({
          id,
          name: id,
          kind,
          state: 'error',
          detail: err instanceof Error ? err.message : String(err),
        }),
      ),
    ),
  );
}

/**
 * One connector's status for a page that shows a few of them (Funnel, Comms, Analytics), on the
 * same window as the board: a real check at most 60s old renders at once, an older one (up to
 * 10 min) while one check runs behind it. Keyed per connector and per Filming state; saving or
 * removing a key clears it with the board (lib/creds.ts). A check that throws is not cached.
 */
export function cachedStatus(id: string, check: () => Promise<ConnectorStatus>): Promise<ConnectorStatus> {
  return swr(`${CONNECTORS_SWR_PREFIX}one:${id}:${isFilming() ? 'filming' : 'live'}`, TTL.connector, check);
}
