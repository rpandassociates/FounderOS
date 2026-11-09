'use client';

/**
 * World traffic — the Analytics page's GA section. Same globe as AdPilot
 * (dot-matrix earth, drag-to-rotate with inertia, idle spin, pins), fed by
 * GA users/sessions instead of ad leads/bookings: one pin per visitor
 * country, sized by users. Clicking a pin (or a country row) opens its
 * location card with totals and its top cities.
 *
 * With real GA rows, the globe also draws missile arcs: one round trip per
 * country, from the SAME sessions number — inbound (country → server,
 * visits) and outbound (server → country, content served), in two colours,
 * both landing on the server pin. GA reports no separate send/receive
 * counts, and the legend says so in plain words.
 *
 * Honest states only: unconfigured shows "Not configured" with a Set up
 * link (never fixture numbers, never a globe pretending at traffic); a
 * failed GA read shows the failure; totals always include countries that
 * have no map position, and the section says so when that happens. No arcs
 * draw without real GA rows.
 *
 * Client-safe: takes only the serializable GaWorldData shape. The pin
 * mapping (country → centroid) lives in lib/ga-countries, so no node-only
 * connector module enters the client bundle.
 */

import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { Globe as GlobeIcon } from 'lucide-react';
import { cityKey } from '@/lib/adpilot-globe';
import { buildTrafficArcs, GA_SERVER_PIN, gaGlobePoints } from '@/lib/ga-countries';
import { arcLegColorToken } from '@/components/adpilot/projection';
import type { GlobeArc } from '@/components/adpilot/Globe';
import type { GaCountryRow, GaWorldData } from '@/lib/connectors/ga-data';
import { SetupLink } from '@/components/SetupLink';
import { setupHrefFor } from '@/lib/integrations-catalog';
import { Label } from '@/components/terminal';

const Globe = dynamic(() => import('@/components/adpilot/Globe').then((m) => m.Globe), {
  ssr: false,
  loading: () => <div className="h-[560px] w-full" />,
});

const nf = new Intl.NumberFormat('en-US');
const fmt = (n: number) => nf.format(n);

function share(users: number, total: number): string {
  return total > 0 ? `${((users / total) * 100).toFixed(1)}%` : '—';
}

export function WorldTrafficSection({ data }: { data: GaWorldData }) {
  const [propertyId, setPropertyId] = useState<string>(data.propertyIds[0] ?? '');
  const [focus, setFocus] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  const traffic = propertyId ? data.traffic[propertyId] : undefined;
  const error = propertyId ? data.errors[propertyId] : undefined;
  const points = useMemo(() => (traffic ? gaGlobePoints(traffic.countries) : []), [traffic]);
  // One round trip per plotted country, both legs from the same sessions
  // number; unplotted countries get no arc (they still count in totals).
  const arcs: GlobeArc[] = useMemo(() => (traffic ? buildTrafficArcs(traffic.countries, GA_SERVER_PIN) : []), [traffic]);
  const focusCountry: GaCountryRow | undefined = useMemo(() => {
    if (!traffic || !focus) return undefined;
    const name = focus.split('|')[0];
    return traffic.countries.find((c) => c.country === name);
  }, [traffic, focus]);

  async function connectGoogle() {
    setConnecting(true);
    setConnectError(null);
    try {
      const res = await fetch('/api/connectors/ga-data/authorize', { method: 'POST' });
      const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !body.url) {
        setConnectError(body.error ?? 'Could not start Google sign-in.');
        setConnecting(false);
        return;
      }
      window.location.href = body.url;
    } catch {
      setConnectError('Could not start Google sign-in.');
      setConnecting(false);
    }
  }

  return (
    <section aria-labelledby="world-traffic-head">
      <div className="mb-4 flex items-center gap-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-sm-t bg-os-surface2">
          <GlobeIcon className="h-4 w-4 text-os-text" aria-hidden />
        </span>
        <h2 id="world-traffic-head" className="text-[15px] font-medium text-os-text">
          World traffic
        </h2>
        <span className="text-[12px] text-os-dim">{data.rangeLabel} · Google Analytics</span>
      </div>

      {!data.configured && (
        <div className="rounded-lg-t border border-os-border bg-os-surface p-6">
          <div className="flex items-center gap-2.5">
            <span className="dot off" />
            <span className="text-[13.5px] font-medium text-os-text">Not configured</span>
          </div>
          <p className="mt-2 max-w-[640px] text-[13px] leading-relaxed text-os-muted">
            Connect Google Analytics to see world traffic here — visitors by country on the globe,
            sized by users, with sessions and top cities per country.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <SetupLink href={setupHrefFor('ga-data')} />
            {data.oauthReady && (
              <button
                type="button"
                onClick={connectGoogle}
                disabled={connecting}
                className="rounded-sm-t border border-os-border-strong bg-os-surface2 px-3.5 py-2 text-[13px] font-medium text-os-text transition-colors hover:bg-os-surface3 disabled:opacity-60"
              >
                {connecting ? 'Opening Google…' : 'Connect with Google'}
              </button>
            )}
          </div>
          {connectError && <p className="mt-3 text-[12.5px] text-os-err">{connectError}</p>}
        </div>
      )}

      {data.configured && data.errors._grant && (
        <div className="rounded-lg-t border border-os-border bg-os-surface p-6">
          <div className="flex items-center gap-2.5">
            <span className="dot err" />
            <span className="text-[13.5px] font-medium text-os-text">Google grant expired</span>
          </div>
          <p className="mt-2 max-w-[640px] text-[13px] leading-relaxed text-os-muted">{data.errors._grant}</p>
          <div className="mt-4">
            <SetupLink href={setupHrefFor('ga-data')} />
          </div>
        </div>
      )}

      {data.configured && !data.errors._grant && data.propertyIds.length > 1 && (
        <div className="mb-4 flex items-center gap-3">
          <Label>Property</Label>
          <select
            value={propertyId}
            onChange={(e) => {
              setPropertyId(e.target.value);
              setFocus(null);
            }}
            aria-label="Google Analytics property"
            className="rounded-sm-t border border-os-border bg-os-surface px-2.5 py-2 text-[13px] text-os-text"
          >
            {data.propertyIds.map((id) => (
              <option key={id} value={id} title={`GA property ${id}`}>
                {data.propertyLabels[id] ?? id}
              </option>
            ))}
          </select>
        </div>
      )}

      {data.configured && !data.errors._grant && propertyId && error && (
        <div className="rounded-lg-t border border-os-border bg-os-surface p-6">
          <div className="flex items-center gap-2.5">
            <span className="dot err" />
            <span className="text-[13.5px] font-medium text-os-text">Google Analytics read failed</span>
          </div>
          <p className="mt-2 max-w-[640px] text-[13px] leading-relaxed text-os-muted">{error}</p>
        </div>
      )}

      {data.configured && !data.errors._grant && traffic && (
        <>
          <div className="mb-4 flex flex-wrap gap-6">
            <div>
              <div className="text-[26px] font-normal leading-none tabular-nums">{fmt(traffic.totalUsers)}</div>
              <div className="mt-1 text-[11.5px] text-os-dim">users · {data.rangeLabel.toLowerCase()}</div>
            </div>
            <div>
              <div className="text-[26px] font-normal leading-none tabular-nums">{fmt(traffic.totalSessions)}</div>
              <div className="mt-1 text-[11.5px] text-os-dim">sessions · {data.rangeLabel.toLowerCase()}</div>
            </div>
            <div>
              <div className="text-[26px] font-normal leading-none tabular-nums">{fmt(traffic.countries.length)}</div>
              <div className="mt-1 text-[11.5px] text-os-dim">countries</div>
            </div>
          </div>

          <div data-adpilot className="relative">
            <Globe
              geo={points}
              height={560}
              focus={focus}
              onFocus={setFocus}
              emptyLabel="No visitor locations yet"
              unitLabel="users"
              secondaryLabel="sessions"
              cardLabel="Location card"
              globeNoun="Traffic"
              arcs={arcs}
              server={{ lat: GA_SERVER_PIN.lat, lng: GA_SERVER_PIN.lng, label: 'Server' }}
            />
          </div>

          {arcs.length > 0 && (
            <div className="mt-4 rounded-lg-t border border-os-border bg-os-surface p-6">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px] text-os-text">
                <span className="flex items-center gap-2">
                  <span aria-hidden className="inline-block h-[3px] w-6 rounded-full" style={{ background: `rgb(var(${arcLegColorToken('inbound')}))` }} />
                  Inbound — visits (country → server)
                </span>
                <span className="flex items-center gap-2">
                  <span aria-hidden className="inline-block h-[3px] w-6 rounded-full" style={{ background: `rgb(var(${arcLegColorToken('outbound')}))` }} />
                  Outbound — content served (server → country)
                </span>
                <span className="flex items-center gap-2">
                  <span aria-hidden className="inline-block h-2.5 w-2.5 rotate-45" style={{ background: `rgb(var(--ap-server-rgb))` }} />
                  Server — {GA_SERVER_PIN.city}, {GA_SERVER_PIN.country}
                </span>
              </div>
              <p className="mt-3 text-[12.5px] leading-relaxed text-os-muted">
                Each session is a round trip: the two arcs for a country are the two legs of the same
                sessions. Google Analytics reports no separate send and receive counts — the numbers
                shown are users and sessions.
              </p>
              <p className="mt-2 text-[12px] text-os-dim">
                Server pin: {GA_SERVER_PIN.city}, {GA_SERVER_PIN.country}, from the public geolocation
                of the server&apos;s address (checked November 2026). It marks where the server&apos;s
                address geolocates, not a business location.
              </p>
            </div>
          )}

          {focusCountry && (
            <div role="region" aria-label={`Location: ${focusCountry.country}`} className="mt-4 rounded-lg-t border border-os-border bg-os-surface p-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[15px] font-medium text-os-text">{focusCountry.country}</div>
                  <div className="mt-1 font-mono text-[12px] text-os-dim">
                    {fmt(focusCountry.users)} users · {fmt(focusCountry.sessions)} sessions · {share(focusCountry.users, traffic.totalUsers)} of all users
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setFocus(null)}
                  className="rounded-sm-t border border-os-border px-2.5 py-1.5 text-[12px] text-os-muted hover:bg-os-surface2"
                >
                  Close
                </button>
              </div>
              {focusCountry.cities.length > 0 && (
                <ul className="mt-4 flex flex-col gap-1.5">
                  {focusCountry.cities.slice(0, 8).map((city) => (
                    <li key={city.city} className="flex items-baseline justify-between gap-3 text-[13px]">
                      <span className="text-os-text">{city.city}</span>
                      <span className="font-mono text-[12px] text-os-dim">
                        {fmt(city.users)} users · {fmt(city.sessions)} sessions
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="mt-4 rounded-lg-t border border-os-border bg-os-surface p-6">
            <Label>Top countries</Label>
            <ul className="mt-3 flex flex-col">
              {traffic.countries.slice(0, 10).map((c) => {
                const key = cityKey({ city: c.country, country: c.country });
                const row = (
                  <>
                    <span className="min-w-0 flex-1 truncate text-os-text">
                      {c.country}
                      {!c.plotted && <span className="ml-2 text-[11.5px] text-os-dim">(no map position)</span>}
                    </span>
                    <span className="font-mono text-[12px] text-os-dim">
                      {fmt(c.users)} users · {share(c.users, traffic.totalUsers)}
                    </span>
                  </>
                );
                return (
                  <li key={c.countryId || c.country} className="border-b border-os-border py-2 last:border-b-0">
                    {c.plotted ? (
                      <button type="button" onClick={() => setFocus(focus === key ? null : key)} aria-pressed={focus === key} className="flex w-full items-baseline justify-between gap-3 text-left text-[13px] hover:text-os-accent">
                        {row}
                      </button>
                    ) : (
                      <div className="flex items-baseline justify-between gap-3 text-[13px]">{row}</div>
                    )}
                  </li>
                );
              })}
            </ul>
            {traffic.countries.length === 0 && <p className="mt-2 text-[13px] text-os-muted">No visitors in this range.</p>}
            {traffic.unplottedUsers > 0 && (
              <p className="mt-3 text-[12px] text-os-dim">
                {fmt(traffic.unplottedUsers)} users from countries without a map position are included in the totals above.
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}
