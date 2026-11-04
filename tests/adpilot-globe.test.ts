import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  angleBetween,
  centreOn,
  latLngToVec,
  nearestYaw,
  normaliseLatLng,
  planetRadius,
  project,
  rotate,
} from '@/components/adpilot/projection';
import { cityBreakdown, globeLabel, intersects, placeLabels, type LabelCandidate, type Rect } from '@/lib/adpilot-globe';

/** AdPilot globe (SPEC S11 §10): projection, chip placer, City card maths, and the source rules. */

const root = path.resolve(__dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');
const close = (a: number, b: number, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe('projection', () => {
  it('latLngToVec: (0,0) is +x, the north pole is +y, lng −90 faces the viewer', () => {
    const a = latLngToVec(0, 0);
    close(a.x, 1);
    close(a.y, 0);
    close(a.z, 0);
    const n = latLngToVec(90, 37);
    close(n.y, 1);
    const f = latLngToVec(0, -90);
    close(f.z, 1);
    expect(rotate(f, 0, 0).z).toBeCloseTo(1);
  });

  it('rotate: yaw π/2 moves +x to −z; pitch applies after yaw (golden vectors)', () => {
    const v = rotate({ x: 1, y: 0, z: 0 }, Math.PI / 2, 0);
    close(v.x, 0);
    close(v.z, -1);
    // Yaw then pitch: +z (facing) tipped by pitch 0.32 goes up-and-back.
    const t = rotate({ x: 0, y: 0, z: 1 }, 0, 0.32);
    close(t.y, -Math.sin(0.32));
    close(t.z, Math.cos(0.32));
    const g = rotate(latLngToVec(40.7128, -74.006), 0.35, 0.32);
    // New York at Bennett's demo pose (yaw 0.35, pitch 0.32), from his formulas.
    expect(g.x).toBeCloseTo(0.44604, 4);
    expect(g.y).toBeCloseTo(0.42637, 4);
    expect(g.z).toBeCloseTo(0.78693, 4);
  });

  it('project: front hemisphere is visible, the back is culled', () => {
    expect(project({ x: 0, y: 0, z: 1 }, 100, 100, 50)).toEqual({ x: 100, y: 100, visible: true });
    expect(project({ x: 0.5, y: 0.5, z: -0.1 }, 100, 100, 50).visible).toBe(false);
    expect(project({ x: 1, y: 0, z: 0 }, 100, 100, 50).visible).toBe(false);
  });

  it('centreOn brings a city to the disc centre (pitch clamped above ~51.6°)', () => {
    for (const [lat, lng] of [
      [40.71, -74.0],
      [-33.87, 151.2],
      [30.27, -97.74],
      [0, 0],
      [-12, 77],
    ]) {
      const c = centreOn(lat, lng);
      const v = rotate(latLngToVec(lat, lng), c.yaw, c.pitch);
      expect(v.x).toBeCloseTo(0, 9);
      expect(v.y).toBeCloseTo(0, 9);
      expect(v.z).toBeCloseTo(1, 9);
    }
    const north = centreOn(64.1, -21.9);
    expect(north.pitch).toBeCloseTo(0.9, 9);
    const v = rotate(latLngToVec(64.1, -21.9), north.yaw, north.pitch);
    expect(v.x).toBeCloseTo(0, 9);
    expect(v.z).toBeGreaterThan(0.9);
  });

  it('nearestYaw takes the short way round', () => {
    close(nearestYaw(0, 0.5), 0.5);
    close(nearestYaw(10 * Math.PI, 0.5), 10 * Math.PI + 0.5);
    close(nearestYaw(3, -3), 3 + (2 * Math.PI - 6));
  });

  it('bad coordinates never throw (S11 §8 edge 10)', () => {
    expect(normaliseLatLng(120, 190)).toEqual({ lat: 90, lng: -170 });
    expect(normaliseLatLng(Number.NaN, -540)).toEqual({ lat: 0, lng: -180 });
    const v = latLngToVec(1e9, Number.POSITIVE_INFINITY);
    expect(Number.isFinite(v.x + v.y + v.z)).toBe(true);
  });

  it('planet radius is 0.36 of the shorter side, never below 110px', () => {
    expect(planetRadius(1200, 640)).toBeCloseTo(230.4);
    expect(planetRadius(200, 640)).toBe(110);
  });

  it('angleBetween is the great-circle angle', () => {
    expect(angleBetween({ lat: 0, lng: 0 }, { lat: 0, lng: 90 })).toBeCloseTo(Math.PI / 2);
    expect(angleBetween({ lat: 10, lng: 10 }, { lat: 10, lng: 10 })).toBeCloseTo(0);
  });
});

/** Small deterministic PRNG for the property test. */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1_000_000) / 1_000_000;
  };
}

describe('placeLabels (greedy chip placer)', () => {
  const bounds: Rect = { x: 0, y: 0, w: 900, h: 560 };
  const rectOf = (p: { x: number; y: number }, c: LabelCandidate): Rect => ({ x: p.x, y: p.y, w: c.w, h: c.h });

  it('never overlaps, never touches an obstacle, always stays inside (200 seeds)', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const r = rng(seed);
      const cands: LabelCandidate[] = Array.from({ length: 2 + Math.floor(r() * 8) }, (_, i) => ({
        id: `c${i}`,
        x: 80 + r() * 740,
        y: 60 + r() * 440,
        w: 80 + r() * 60,
        h: 24,
        priority: Math.floor(r() * 400),
      }));
      const obstacles: Rect[] = r() < 0.5 ? [{ x: 700, y: 30, w: 200, h: 200 }] : [];
      const placed = placeLabels(cands, obstacles, bounds);
      const rects = placed.map((p) => rectOf(p, cands.find((c) => c.id === p.id)!));
      for (let i = 0; i < rects.length; i++) {
        const a = rects[i];
        expect(a.x >= 0 && a.y >= 0 && a.x + a.w <= 900 && a.y + a.h <= 560).toBe(true);
        for (const o of obstacles) expect(intersects(a, o)).toBe(false);
        for (let j = i + 1; j < rects.length; j++) expect(intersects(a, rects[j]), `seed ${seed}`).toBe(false);
      }
      // The highest-leads city is always placed when it has room.
      const top = [...cands].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))[0];
      const hasRoom = top.x > 160 && top.x < 540 && top.y > 60 && top.y < 500;
      if (hasRoom && obstacles.length === 0) expect(placed.some((p) => p.id === top.id)).toBe(true);
    }
  });

  it('tries NE first, then flips away from an obstacle', () => {
    const c: LabelCandidate = { id: 'a', x: 400, y: 300, w: 100, h: 24, priority: 1 };
    expect(placeLabels([c], [], bounds)[0]).toMatchObject({ anchor: 'ne', x: 412, y: 264 });
    const blocked = placeLabels([c], [{ x: 405, y: 200, w: 300, h: 95 }], bounds)[0];
    expect(blocked.anchor).toBe('nw');
  });

  it('hides a chip with no free anchor', () => {
    const c: LabelCandidate = { id: 'a', x: 400, y: 300, w: 100, h: 24, priority: 1 };
    expect(placeLabels([c], [{ x: 0, y: 0, w: 900, h: 560 }], bounds)).toEqual([]);
  });

  it('is deterministic', () => {
    const r = rng(7);
    const cands = Array.from({ length: 6 }, (_, i) => ({ id: `c${i}`, x: 300 + r() * 200, y: 200 + r() * 100, w: 110, h: 24, priority: 5 }));
    expect(placeLabels(cands, [], bounds)).toEqual(placeLabels([...cands].reverse(), [], bounds));
  });
});

describe('cityBreakdown (City card)', () => {
  const geo = (city: string, country: string, leads: number, bookings: number) => ({ city, country, lat: 1, lng: 2, leads, bookings });
  const campaigns = [
    { id: 'a', name: 'Lumen Desk cold', geo: [geo('Austin', 'US', 100, 10), geo('London', 'GB', 50, 5)] },
    { id: 'b', name: 'Lumen Desk retargeting', geo: [geo('Austin', 'US', 40, 8), geo('Oslo', 'NO', 0, 2)] },
    { id: 'c', name: 'Orbit Labs launch', geo: [geo('London', 'GB', 10, 0)] },
  ];

  it('per-campaign rows sum to the city totals', () => {
    const b = cityBreakdown(campaigns, 'Austin', 'US')!;
    expect(b.leads).toBe(140);
    expect(b.bookings).toBe(18);
    expect(b.byCampaign.map((r) => r.id)).toEqual(['a', 'b']);
    expect(b.byCampaign.reduce((s, r) => s + r.leads, 0)).toBe(b.leads);
    expect(b.byCampaign.reduce((s, r) => s + r.bookings, 0)).toBe(b.bookings);
    expect(b.bookingRate).toBeCloseTo(18 / 140);
  });

  it('shares sum to 1 across the cities of a selection', () => {
    const cities = [
      ['Austin', 'US'],
      ['London', 'GB'],
      ['Oslo', 'NO'],
    ];
    const total = cities.reduce((s, [c, k]) => s + (cityBreakdown(campaigns, c, k)!.share ?? 0), 0);
    expect(total).toBeCloseTo(1);
  });

  it('a 0-lead city has a null booking rate; an unknown city is null', () => {
    expect(cityBreakdown(campaigns, 'Oslo', 'NO')!.bookingRate).toBeNull();
    expect(cityBreakdown(campaigns, 'Paris', 'FR')).toBeNull();
  });

  it('globeLabel names the top three, or the empty state', () => {
    expect(globeLabel([geo('Austin', 'US', 296, 1), geo('Oslo', 'NO', 9, 0), geo('Lima', 'PE', 247, 0), geo('Pune', 'IN', 283, 0)])).toBe(
      'Leads by city: 4 cities. Top: Austin 296, Pune 283, Lima 247.',
    );
    expect(globeLabel([])).toBe('No lead locations yet');
    expect(globeLabel([], 'No lead locations for Orbit Labs launch')).toBe('No lead locations for Orbit Labs launch');
  });
});

describe('globe source rules (S11 §9)', () => {
  const globe = read('components/adpilot/Globe.tsx');

  it('three.js is gone (AC11.1)', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.dependencies?.three).toBeUndefined();
    expect(pkg.devDependencies?.['@types/three']).toBeUndefined();
    for (const dir of ['app', 'components', 'lib']) {
      const walk = (d: string): string[] =>
        fs.readdirSync(path.join(root, d), { withFileTypes: true }).flatMap((e) =>
          e.isDirectory() ? walk(path.join(d, e.name)) : /\.(tsx?|mjs|js)$/.test(e.name) ? [path.join(d, e.name)] : [],
        );
      for (const f of walk(dir)) expect(read(f), f).not.toMatch(/from ['"]three['"]/);
    }
  });

  it('the file header carries the MIT attribution (AC11.14)', () => {
    const head = globe.split('\n').slice(0, 8).join('\n');
    expect(head).toMatch(/adapted from FounderOS-DEMO \(github\.com\/Bennettxai\/FounderOS-DEMO\)/);
    expect(head).toMatch(/@ 3397780, MIT License, Copyright \(c\) 2026 FounderOS/);
  });

  it('colours come from tokens and re-key on theme change (F-R2)', () => {
    for (const t of ['--ap-globe-rim-rgb', '--ap-globe-bleed-rgb', '--ap-globe-body', '--ap-globe-land-rgb', '--ap-pin', '--ap-pin-core', '--ap-pin-halo-rgb', '--ap-arc-in-rgb', '--ap-arc-out-rgb', '--ap-server-rgb']) {
      expect(globe).toContain(`'${t}'`);
    }
    expect(globe).toMatch(/new MutationObserver/);
    expect(globe).toMatch(/attributeFilter: \['data-theme', 'data-ui', 'data-accent', 'data-mode'\]/);
  });

  it('pauses off-screen, when hidden, and honours reduced motion (F-P4)', () => {
    expect(globe).toMatch(/new IntersectionObserver/);
    expect(globe).toMatch(/visibilitychange/);
    expect(globe).toMatch(/prefers-reduced-motion: reduce/);
  });

  it('never captures the wheel and lets vertical swipes scroll (S11 §6)', () => {
    expect(globe).not.toMatch(/['"]wheel['"]/);
    expect(globe).not.toMatch(/touch-none/);
    expect(read('app/globals.css')).toMatch(/\.ap-globe-canvas \{[^}]*touch-action: pan-y/);
  });

  it('arcs come only from the arcs prop, never invented (F-G1 superseded Nov 2026)', () => {
    // The GA world-traffic globe draws missile arcs for real GA rows passed
    // in via props; the component invents no endpoints of its own, and the
    // curves are slerp polylines, not beziers.
    expect(globe).toMatch(/arcs\?: GlobeArc\[\]/);
    expect(globe).not.toMatch(/bezierCurveTo/);
  });
});
