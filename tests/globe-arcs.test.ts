import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  ARC_WIDTH_MAX,
  ARC_WIDTH_MIN,
  arcLegColorToken,
  arcLineWidth,
  latLngToVec,
  rotate,
  sampleArc,
  slerp,
  visibleRuns,
} from '@/components/adpilot/projection';
import {
  GA_SERVER_PIN,
  GA_SERVER_PIN_FALLBACK,
  buildTrafficArcs,
  serverPinOrFallback,
  type GaGlobeCountry,
} from '@/lib/ga-countries';

/**
 * Globe missile arcs (GA world-traffic): great-circle geometry, far-side
 * culling, leg colours, thickness scaling, and the server pin. The canvas
 * itself has no browser in this sandbox, so these tests cover the pure
 * geometry the renderer draws from — the draw loop reuses the same rotate()
 * and z > 0 rule as the pins.
 */

const root = path.resolve(__dirname, '..');
const close = (a: number, b: number, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(eps);
const mag = (v: { x: number; y: number; z: number }) => Math.hypot(v.x, v.y, v.z);

describe('slerp', () => {
  it('endpoints are exact and the midpoint rides the great circle', () => {
    const a = latLngToVec(39.8, -98.6);
    const b = latLngToVec(39.0067, -77.4291);
    const s0 = slerp(a, b, 0);
    const s1 = slerp(a, b, 1);
    close(s0.x, a.x);
    close(s0.y, a.y);
    close(s0.z, a.z);
    close(s1.x, b.x);
    close(s1.y, b.y);
    close(s1.z, b.z);
    const mid = slerp(a, b, 0.5);
    close(mag(mid), 1);
    const dot = a.x * mid.x + a.y * mid.y + a.z * mid.z;
    const half = Math.acos(Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z))) / 2;
    expect(dot).toBeCloseTo(Math.cos(half), 9);
  });

  it('a degenerate arc (same point twice) does not NaN', () => {
    const a = latLngToVec(10, 20);
    const m = slerp(a, a, 0.5);
    expect(Number.isFinite(m.x + m.y + m.z)).toBe(true);
    close(mag(m), 1);
  });
});

describe('sampleArc', () => {
  it('samples run 0 → 1, endpoints on the surface, mid-arc lifted', () => {
    const samples = sampleArc({ lat: 39.8, lng: -98.6 }, { lat: 39.0067, lng: -77.4291 }, 32, 0.18);
    expect(samples).toHaveLength(33);
    expect(samples[0].t).toBe(0);
    expect(samples[32].t).toBe(1);
    close(mag(samples[0].v), 1);
    close(mag(samples[32].v), 1);
    expect(mag(samples[16].v)).toBeGreaterThan(1);
    expect(mag(samples[16].v)).toBeCloseTo(1.18, 6);
  });
});

describe('visibleRuns (far-side culling)', () => {
  const rotated = (from: { lat: number; lng: number }, to: { lat: number; lng: number }, yaw: number, pitch: number) =>
    sampleArc(from, to, 32, 0.18).map((s) => {
      const r = rotate(s.v, yaw, pitch);
      return { t: s.t, z: r.z };
    });

  it('a front-side arc draws as one full run', () => {
    // lng −90 faces the viewer at yaw 0; both endpoints face it.
    const runs = visibleRuns(rotated({ lat: 0, lng: -90 }, { lat: 10, lng: -70 }, 0, 0));
    expect(runs).toHaveLength(1);
    expect(runs[0][0].t).toBe(0);
    expect(runs[0][runs[0].length - 1].t).toBe(1);
  });

  it('a far-side arc draws nothing, never across the disc', () => {
    const runs = visibleRuns(rotated({ lat: 0, lng: -90 }, { lat: 10, lng: -70 }, Math.PI, 0));
    expect(runs).toEqual([]);
  });

  it('a limb-crossing arc draws a partial run that stops at the horizon', () => {
    // Non-antipodal endpoints: (0,−90) faces the viewer at yaw 0, (0,60) is
    // past the limb. (Exactly antipodal pairs have no unique great circle
    // and no country centroid is antipodal to the server pin.)
    const runs = visibleRuns(rotated({ lat: 0, lng: -90 }, { lat: 0, lng: 60 }, 0, 0));
    expect(runs).toHaveLength(1);
    expect(runs[0][0].t).toBe(0);
    expect(runs[0][runs[0].length - 1].t).toBeLessThan(1);
    const reversed = visibleRuns(rotated({ lat: 0, lng: 60 }, { lat: 0, lng: -90 }, 0, 0));
    expect(reversed).toHaveLength(1);
    expect(reversed[0][reversed[0].length - 1].t).toBe(1);
    expect(reversed[0][0].t).toBeGreaterThan(0);
  });
});

describe('arcLineWidth', () => {
  it('clamps to [MIN, MAX], scales with sqrt, and never breaks on bad input', () => {
    expect(arcLineWidth(0, 100)).toBe(ARC_WIDTH_MIN);
    expect(arcLineWidth(-5, 100)).toBe(ARC_WIDTH_MIN);
    expect(arcLineWidth(NaN, 100)).toBe(ARC_WIDTH_MIN);
    expect(arcLineWidth(100, 100)).toBe(ARC_WIDTH_MAX);
    expect(arcLineWidth(10_000, 100)).toBe(ARC_WIDTH_MAX);
    expect(arcLineWidth(1, 100)).toBeGreaterThan(ARC_WIDTH_MIN);
    expect(arcLineWidth(1, 100)).toBeLessThan(arcLineWidth(25, 100));
    expect(arcLineWidth(25, 100)).toBeLessThan(arcLineWidth(100, 100));
  });
});

describe('arc leg colours', () => {
  it('inbound and outbound map to different tokens, both defined in globals.css', () => {
    expect(arcLegColorToken('inbound')).toBe('--ap-arc-in-rgb');
    expect(arcLegColorToken('outbound')).toBe('--ap-arc-out-rgb');
    expect(arcLegColorToken('inbound')).not.toBe(arcLegColorToken('outbound'));
    const css = fs.readFileSync(path.join(root, 'app/globals.css'), 'utf8');
    for (const t of ['--ap-arc-in-rgb', '--ap-arc-out-rgb', '--ap-server-rgb']) {
      expect(css).toContain(t);
    }
  });
});

describe('server pin', () => {
  it('resolves to Sterling, Virginia (ip-api.com lookup of the VPS public IP)', () => {
    expect(GA_SERVER_PIN.city).toBe('Sterling');
    expect(GA_SERVER_PIN.country).toBe('United States');
    expect(GA_SERVER_PIN.lat).toBeCloseTo(39.0067, 3);
    expect(GA_SERVER_PIN.lng).toBeCloseTo(-77.4291, 3);
    expect(GA_SERVER_PIN.source).toBe('ip-geolocation');
  });

  it('falls back to an explicitly approximate pin when nothing resolves', () => {
    expect(serverPinOrFallback(null)).toBe(GA_SERVER_PIN_FALLBACK);
    expect(GA_SERVER_PIN_FALLBACK.source).toBe('approximate');
    expect(serverPinOrFallback(GA_SERVER_PIN)).toBe(GA_SERVER_PIN);
  });
});

describe('buildTrafficArcs', () => {
  const rows: GaGlobeCountry[] = [
    { countryId: 'US', country: 'United States', users: 160, sessions: 200, plotted: true },
    { countryId: 'XX', country: 'Nowhere Land', users: 5, sessions: 7, plotted: false },
    { countryId: 'ZZ', country: 'Unknown', users: 3, sessions: 4, plotted: true },
  ];

  it('emits one round trip per plotted country from the same sessions number', () => {
    const arcs = buildTrafficArcs(rows, GA_SERVER_PIN);
    expect(arcs).toHaveLength(2);
    const [inbound, outbound] = arcs;
    expect(inbound.leg).toBe('inbound');
    expect(outbound.leg).toBe('outbound');
    expect(inbound.sessions).toBe(200);
    expect(outbound.sessions).toBe(200);
    expect(inbound.from).toEqual({ lat: 39.8, lng: -98.6 });
    expect(inbound.to).toEqual({ lat: GA_SERVER_PIN.lat, lng: GA_SERVER_PIN.lng });
    expect(outbound.from).toEqual({ lat: GA_SERVER_PIN.lat, lng: GA_SERVER_PIN.lng });
    expect(outbound.to).toEqual({ lat: 39.8, lng: -98.6 });
  });

  it('unplotted and centroid-less countries get no arc', () => {
    expect(buildTrafficArcs([], GA_SERVER_PIN)).toEqual([]);
    expect(buildTrafficArcs(rows.filter((r) => r.countryId !== 'US'), GA_SERVER_PIN)).toEqual([]);
  });
});
