'use client';

/**
 * /analytics under the GladOS style (glados-ui SPEC S03 §4.4, §5.4; X5).
 * Same data as the Classic tree. Sparks only where real history exists
 * (F16), one audience definition with /social (F17, C19), the one-slice run
 * outcomes donut becomes a stat and a split meter (F18), an empty state that
 * says why the run chart is empty (F19), and platform cards without handles
 * or share bars (F21: the donut owns share).
 */

import { Instagram, Linkedin, Music2, Twitter, Youtube, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  GAreaChart, GBar, GButton, GCard, GDelta, GDonut, GList, GPage, GRow, GSectionHeader, GSparkline, GTag,
  type DonutSlice,
} from '@/components/g';
import { formatFull } from '@/lib/format-number';
import { fmtDay } from '@/lib/social-view';
import { channelVizColor } from '@/components/social/channel';

export type AnalyticsTileG = {
  id: string;
  label: string;
  value: string;
  unit: string;
  source: string;
  /** A change with its window, rendered by GDelta. */
  change?: { cur: number; prev: number; window: string } | null;
  /** A plain secondary line ("+12 runs · 7 days"). */
  note?: string | null;
  spark?: number[];
  href?: string;
};

export type AnalyticsGProps = {
  liveCount: number;
  pendingCount: number;
  tiles: AnalyticsTileG[];
  audience: { total: number; slices: DonutSlice[] };
  runs: {
    /** The run log window the distribution reads ("all time", or "latest 2,000" when capped). */
    scope: string;
    total: number;
    byAgent: DonutSlice[];
    ok: number;
    recentFailures: { id: string; agent: string; at: string }[];
    volume: { date: string; count: number }[];
    windowRuns: number;
    lastRunAt: string | null;
  };
  pending: { id: string; label: string; source: string; setupHref: string }[];
  platforms: { platform: string; label: string; href: string; followers: number | null; cur: number | null; prev: number | null; spark: number[] }[];
  /** World traffic section (GA globe), rendered by the page when available. */
  worldTraffic?: ReactNode;
};

const ICONS: Record<string, LucideIcon> = { instagram: Instagram, tiktok: Music2, twitter: Twitter, youtube: Youtube, linkedin: Linkedin };

export function AnalyticsG(p: AnalyticsGProps) {
  const { tiles, audience, runs, pending, platforms } = p;
  const failed = runs.total - runs.ok;
  const okPct = runs.total > 0 ? Math.round((runs.ok / runs.total) * 100) : 0;
  return (
    <GPage className="an-g">
      <GSectionHeader
        size="page"
        title="Analytics"
        caption="Operating metrics"
        action={<GTag tone="accent" title="Live connector reads and metrics still waiting on a key">{p.liveCount} live · {p.pendingCount} pending</GTag>}
      />

      {/* Live tiles (F16, F17) */}
      {tiles.length > 0 && (
        <div className="an-g-tiles">
          {tiles.map((t) => (
            <GCard key={t.id} p={20} href={t.href} className="an-g-tile" title={`${t.label}: ${t.source}`}>
              <span className="an-g-tile-label">{t.label}</span>
              <span className="an-g-tile-value">
                <span className="soc-g-num">{t.value}</span>
                {t.unit && <span className="soc-g-cap">{t.unit}</span>}
              </span>
              <span className="an-g-tile-foot">
                {t.change ? <GDelta cur={t.change.cur} prev={t.change.prev} window={t.change.window} /> : <span className="soc-g-cap">{t.note ?? t.source}</span>}
                {t.spark && t.spark.length > 1 && <GSparkline values={t.spark} label={`${t.label}, last ${t.spark.length} points`} color="accent" width={96} height={26} />}
              </span>
            </GCard>
          ))}
        </div>
      )}

      {/* Distribution (F18) */}
      {(audience.total > 0 || runs.total > 0) && (
        <section className="soc-g-sec" aria-labelledby="an-g-dist">
          <GSectionHeader id="an-g-dist" size={22} title="Distribution" caption="Share of each total" />
          <div className="an-g-dist">
            {audience.total > 0 && (
              <GCard p={24} className="an-g-card">
                <GSectionHeader size={22} title="Audience share" caption={`${formatFull(audience.total)} total audience`} />
                <GDonut slices={audience.slices} size={150} formatValue={formatFull} centreLabel="total audience" label="Audience share by channel" />
              </GCard>
            )}
            {runs.total > 0 && (
              <GCard p={24} className="an-g-card">
                <GSectionHeader size={22} title="Runs by agent" caption={`${formatFull(runs.total)} runs, ${runs.scope}`} />
                <GDonut slices={runs.byAgent} size={150} formatValue={formatFull} centreLabel="runs" label={`Agent runs by agent, ${runs.scope}`} />
              </GCard>
            )}
            {runs.total > 0 && (
              <GCard p={24} className="an-g-card" aria-labelledby="an-g-outcomes">
                <GSectionHeader id="an-g-outcomes" size={22} title="Run outcomes" caption={runs.scope.charAt(0).toUpperCase() + runs.scope.slice(1)} />
                <div className="an-g-outcome">
                  <span className="soc-g-num">{okPct}% succeeded</span>
                  <GBar
                    label={`${formatFull(runs.ok)} succeeded, ${formatFull(failed)} failed`}
                    segments={[
                      { value: runs.ok, tone: 'ok', label: `${formatFull(runs.ok)} succeeded` },
                      ...(failed > 0 ? [{ value: failed, tone: 'err' as const, label: `${formatFull(failed)} failed` }] : []),
                    ]}
                  />
                  <span className="soc-g-cap">{formatFull(failed)} failed of {formatFull(runs.total)}</span>
                </div>
                {runs.recentFailures.length > 0 && (
                  <GList divided label="Most recent failures">
                    {runs.recentFailures.map((f) => <GRow key={f.id} title={f.agent} trailing={<span className="soc-g-cap">{fmtDay(f.at.slice(0, 10))}</span>} />)}
                  </GList>
                )}
              </GCard>
            )}
          </div>
        </section>
      )}

      {/* Run volume (F19) + awaiting credentials (F20). With no runs in the window the volume card
          shrinks to a one-line note and credentials takes the full row, so no empty chart well stands
          next to a tall list. */}
      <div className="an-g-pair" data-volume={runs.windowRuns === 0 ? 'empty' : undefined}>
        <GCard p={24} className="an-g-card" aria-labelledby="an-g-volume">
          <GSectionHeader id="an-g-volume" size={22} title="Agent run volume" caption={`${formatFull(runs.windowRuns)} runs in the last 14 days`} />
          {runs.windowRuns === 0 ? (
            <p className="soc-g-cap an-g-volume-empty" data-run-volume-empty="">
              {runs.total === 0 ? 'No agent runs recorded yet.' : 'No runs in the last 14 days.'}
              {runs.lastRunAt ? ` Last run ${fmtDay(runs.lastRunAt.slice(0, 10))}.` : ''}
            </p>
          ) : (
            <GAreaChart
              labels={runs.volume.map((d) => fmtDay(d.date))}
              series={[{ id: 'runs', label: 'Runs', values: runs.volume.map((d) => d.count), color: 'accent' }]}
              height={170}
              formatValue={formatFull}
              label="Agent runs per day, last 14 days"
            />
          )}
        </GCard>
        <GCard p={24} className="an-g-card" aria-labelledby="an-g-pending">
          <GSectionHeader id="an-g-pending" size={22} title="Awaiting credentials" caption={pending.length === 0 ? 'Every connector is live' : `${pending.length} metrics need a key`} />
          {pending.length > 0 && (
            <GList divided label="Metrics awaiting credentials">
              {pending.map((m) => (
                <GRow key={m.id} title={m.label} meta={m.source} trailing={<GButton size="sm" href={m.setupHref} title={`Connect ${m.source}`}>Set up</GButton>} />
              ))}
            </GList>
          )}
          <GButton href="/integrations" className="an-g-open">Open integrations</GButton>
        </GCard>
      </div>

      {/* Audience by platform (F21) */}
      {platforms.length > 0 && (
        <section className="soc-g-sec" aria-labelledby="an-g-platforms">
          <GSectionHeader id="an-g-platforms" size={22} title="Audience by platform" action={<GButton size="sm" href="/social">Open Social</GButton>} />
          <div className="an-g-platforms">
            {platforms.map((pl) => {
              const Icon = ICONS[pl.platform] ?? Instagram;
              return (
                <GCard key={pl.platform} p={20} href={pl.href} className="an-g-tile" title={`${pl.label}: open details`}>
                  <span className="soc-g-acct-head">
                    <span className="soc-g-icon"><Icon size={14} strokeWidth={1.75} aria-hidden /></span>
                    <span className="soc-g-acct-name">{pl.label}</span>
                  </span>
                  <span className="an-g-tile-value"><span className="soc-g-num">{pl.followers == null ? '—' : formatFull(pl.followers)}</span></span>
                  <span className="an-g-tile-foot">
                    {pl.cur != null && pl.prev != null ? <GDelta cur={pl.cur} prev={pl.prev} window="7 days" /> : <span className="soc-g-cap">no 7d history</span>}
                    {pl.spark.length > 1 && <GSparkline values={pl.spark} label={`${pl.label} followers, last ${pl.spark.length} snapshots`} color={channelVizColor(pl.platform)} width={96} height={26} />}
                  </span>
                </GCard>
              );
            })}
          </div>
        </section>
      )}

      {/* World traffic — GA globe, rendered by the page when available */}
      {p.worldTraffic}
    </GPage>
  );
}
