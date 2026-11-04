'use client';

/* Canvas 2D renderer adapted from FounderOS-DEMO (github.com/Bennettxai/FounderOS-DEMO)
   components/adpilot/Globe.tsx @ 3397780, MIT License, Copyright (c) 2026 FounderOS.
   That file is itself a port of this component's earlier three.js version. */

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useGc } from '@/components/system-g/style-context';
import type { GeoPoint } from '@/lib/adpilot';
import { anchorRect, cityKey, globeLabel, placeLabels, type Anchor, type Rect } from '@/lib/adpilot-globe';
import {
  PITCH_LIMIT,
  centreOn,
  easeOut,
  latLngToVec,
  nearestYaw,
  planetRadius,
  rotate,
  type Vec,
} from '@/components/adpilot/projection';

/**
 * The AdPilot globe (SPEC S11): dot-matrix earth from real coastline
 * samples (public/adpilot/globe-dots.json), a thin bright rim on the horizon
 * that bleeds softly outward (the "red outline"), teardrop pins where leads
 * come from, and label chips on the top cities. Drag to rotate with inertia;
 * it idles into a slow spin. Click a pin or chip to centre the city and open
 * its City card (the deck renders the card; `focus` is lifted there).
 *
 * Every colour is a token read from the [data-adpilot] scope
 * (--ap-globe-*, --ap-pin*); a MutationObserver on <html data-theme>
 * re-reads them, so a theme switch re-colours the same canvas on the next
 * frame. The rotation-invariant outline is cached offscreen, land dots are
 * batched by alpha, and the loop only runs while something moves and the
 * globe is on screen (never off-screen, in a hidden tab, or idle under
 * reduced motion). Plain 2D canvas, no WebGL library.
 */

type Props = {
  geo: GeoPoint[];
  height?: number;
  /** Focused city key (`city|country`), or null. */
  focus: string | null;
  onFocus: (key: string | null) => void;
  /** The accessible name when `geo` is empty. */
  emptyLabel?: string;
  /** Metric name for chips, tooltips and labels (AdPilot default: 'leads'). */
  unitLabel?: string;
  /** Secondary metric name for tooltips and the list (AdPilot default: 'booked'). */
  secondaryLabel?: string;
  /** Card name in chip titles (AdPilot default: 'City card'). */
  cardLabel?: string;
  /** Noun for the group aria-label (AdPilot default: 'Lead'). */
  globeNoun?: string;
};

const TILT = 0.32;
/** The canvas overhangs the layout slot by this much on top and bottom, so the bleed is never clipped. */
const OVERHANG = 40;
const CHIP_COUNT = 6;
/** Below this slot width chips are hidden; hover, click and the city list remain (S11 §8 edge 7). */
const CHIP_MIN_WIDTH = 320;
const CHIP_GAP = 12;
/** Chips hide a little before the horizon so they don't flicker at the limb (F-G5). */
const HORIZON_Z = 0.08;
const IDLE_SPIN = 0.0016;
const FRAME_MS = 1000 / 60;
const LAND_BUCKETS = 8;
const SIZE_BUCKETS = 8;
const FOCUS_MS = 400;
const KEY_MS = 220;
const FADE_MS = 200;
const LAND_FADE_MS = 600;
const RESUME_MS = 2000;
const CLICK_SLOP = 4;
const KEY_YAW = (15 * Math.PI) / 180;
const KEY_PITCH = (10 * Math.PI) / 180;

type Rgb = [number, number, number];
type Palette = { rim: Rgb; bleed: Rgb; body: string; land: Rgb; pin: string; core: string; halo: Rgb };

/** Space- or comma-separated channels from a `-rgb` token. */
function channels(style: CSSStyleDeclaration, name: string, fallback: Rgb): Rgb {
  const parts = style
    .getPropertyValue(name)
    .trim()
    .split(/[\s,/]+/)
    .map(Number)
    .filter((n) => Number.isFinite(n));
  return parts.length >= 3 ? [parts[0], parts[1], parts[2]] : fallback;
}

/** A canvas fill from token channels (§3.2.1: JS-computed fills come from `-rgb` tokens). */
function tokenFill(c: Rgb, a: number): string {
  return `rgb(${c[0]} ${c[1]} ${c[2]} / ${a.toFixed(3)})`;
}

function readPalette(el: Element): Palette {
  const s = getComputedStyle(el);
  const text = channels(s, '--ap-signal-rgb', [128, 128, 128]);
  const rim = channels(s, '--ap-globe-rim-rgb', text);
  const word = (name: string, fb: string) => s.getPropertyValue(name).trim() || fb;
  const ink = s.color;
  return {
    rim,
    bleed: channels(s, '--ap-globe-bleed-rgb', rim),
    body: word('--ap-globe-body', ink),
    land: channels(s, '--ap-globe-land-rgb', rim),
    pin: word('--ap-pin', ink),
    core: word('--ap-pin-core', ink),
    halo: channels(s, '--ap-pin-halo-rgb', rim),
  };
}

/** Teardrop, tip anchored at (x, y): head circle, tapered tip, darker core (Bennett's shape). */
function drawPin(ctx: CanvasRenderingContext2D, x: number, y: number, h: number, pal: Palette) {
  const headR = h * 0.23;
  const headY = y - h + headR + h * 0.06;
  ctx.fillStyle = pal.pin;
  ctx.beginPath();
  ctx.arc(x, headY, headR, Math.PI * 0.93, Math.PI * 0.07, false);
  ctx.quadraticCurveTo(x + headR * 0.55, headY + headR * 1.15, x, y);
  ctx.quadraticCurveTo(x - headR * 0.55, headY + headR * 1.15, x - headR * Math.cos(Math.PI * 0.07), headY + headR * Math.sin(Math.PI * 0.07));
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = pal.core;
  ctx.beginPath();
  ctx.arc(x, headY, headR * 0.42, 0, Math.PI * 2);
  ctx.fill();
}

/** Pin height for a size bucket (Bennett's `0.052 + 0.03·√(leads/max)`, quantised to 8 sizes). */
function pinSize(bucket: number, R: number): number {
  return (0.052 + 0.03 * (bucket / (SIZE_BUCKETS - 1))) * R;
}
function sizeBucket(leads: number, max: number): number {
  return Math.round(Math.sqrt(Math.max(0, leads) / Math.max(max, 1)) * (SIZE_BUCKETS - 1));
}

type Pin = { key: string; g: GeoPoint; v: Vec; a: number; target: number };
type Hit = { x: number; y: number; r: number; key: string };
type Tip = { key: string; x: number; y: number };
/** A chip's placer anchor, its eased offset from the pin head (ox, oy) toward the anchor's (tx, ty), and its measured size. */
type Chip = { show: boolean; anchor: Anchor | null; ox: number; oy: number; tx: number; ty: number; w: number; h: number };

export function Globe({ geo, height = 560, focus, onFocus, emptyLabel, unitLabel = 'leads', secondaryLabel = 'booked', cardLabel = 'City card', globeNoun = 'Lead' }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const perfRef = useRef<HTMLDivElement>(null);
  const chipRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [tip, setTip] = useState<Tip | null>(null);
  const [landState, setLandState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [entered, setEntered] = useState(false);
  const [perf, setPerf] = useState(false);

  const byKey = useMemo(() => new Map(geo.map((g) => [cityKey(g), g])), [geo]);
  // The labeled cities: top N by leads for the current selection.
  const chipCities = useMemo(() => [...geo].sort((a, b) => b.leads - a.leads).slice(0, CHIP_COUNT), [geo]);
  const listCities = useMemo(() => [...geo].sort((a, b) => b.leads - a.leads), [geo]);

  // Live values the render loop reads without re-subscribing.
  const live = useRef({
    geo,
    chipCities,
    focus,
    preview: null as string | null,
    onFocus,
    height,
    obstacles: [] as Rect[],
    w: 0,
  });
  live.current.geo = geo;
  live.current.chipCities = chipCities;
  live.current.focus = focus;
  live.current.onFocus = onFocus;
  live.current.height = height;

  // Imperative handles into the loop, set by the main effect.
  const api = useRef<{
    setGeo: (g: GeoPoint[]) => void;
    focusOn: (key: string | null) => void;
    nudge: (dYaw: number, dPitch: number) => void;
    nearestCentre: () => string | null;
    kick: () => void;
    pinHead: (key: string) => { x: number; y: number } | null;
  } | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    const canvas = canvasRef.current;
    if (!mount || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const coarseQuery = window.matchMedia('(pointer: coarse)');
    let reduced = motionQuery.matches;
    const perfOn = new URLSearchParams(window.location.search).get('globeperf') === '1';
    setPerf(perfOn);

    let w = 1;
    let canvasH = 1;
    let dpr = 1;
    let cx = 0;
    let cy = 0;
    let R = 110;
    let pal = readPalette(mount);
    const layer = document.createElement('canvas');
    let halos: HTMLCanvasElement[] = [];

    /** The rotation-invariant outline (bleed, body, limb), drawn once per size, DPR or theme (F-P2). */
    const buildLayers = () => {
      layer.width = canvas.width;
      layer.height = canvas.height;
      const l = layer.getContext('2d');
      if (!l) return;
      l.setTransform(dpr, 0, 0, dpr, 0, 0);
      l.clearRect(0, 0, w, canvasH);
      // One continuous atmosphere: a wide soft bleed behind the horizon...
      const bleed = l.createRadialGradient(cx, cy, R * 0.96, cx, cy, R * 1.3);
      bleed.addColorStop(0, tokenFill(pal.bleed, 0.55));
      bleed.addColorStop(0.35, tokenFill(pal.bleed, 0.16));
      bleed.addColorStop(1, tokenFill(pal.bleed, 0));
      l.fillStyle = bleed;
      l.beginPath();
      l.arc(cx, cy, R * 1.3, 0, Math.PI * 2);
      l.fill();
      // ...the body...
      l.fillStyle = pal.body;
      l.beginPath();
      l.arc(cx, cy, R, 0, Math.PI * 2);
      l.fill();
      // ...and a bright fresnel limb on the body, peaking at the horizon.
      const limb = l.createRadialGradient(cx, cy, R * 0.8, cx, cy, R);
      limb.addColorStop(0, tokenFill(pal.rim, 0));
      limb.addColorStop(0.75, tokenFill(pal.rim, 0.12));
      limb.addColorStop(1, tokenFill(pal.rim, 0.6));
      l.fillStyle = limb;
      l.beginPath();
      l.arc(cx, cy, R, 0, Math.PI * 2);
      l.fill();
      // One halo sprite per pin-size bucket.
      halos = Array.from({ length: SIZE_BUCKETS }, (_, b) => {
        const hr = pinSize(b, R) * 0.8;
        const px = Math.max(2, Math.ceil(hr * 2 * dpr));
        const c = document.createElement('canvas');
        c.width = px;
        c.height = px;
        const hc = c.getContext('2d');
        if (hc) {
          const g = hc.createRadialGradient(px / 2, px / 2, 0, px / 2, px / 2, px / 2);
          g.addColorStop(0, tokenFill(pal.halo, 0.75));
          g.addColorStop(0.4, tokenFill(pal.halo, 0.22));
          g.addColorStop(1, tokenFill(pal.halo, 0));
          hc.fillStyle = g;
          hc.beginPath();
          hc.arc(px / 2, px / 2, px / 2, 0, Math.PI * 2);
          hc.fill();
        }
        return c;
      });
    };

    const resize = () => {
      w = Math.max(1, mount.clientWidth);
      canvasH = live.current.height + OVERHANG * 2;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(canvasH * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${canvasH}px`;
      cx = w / 2;
      cy = canvasH / 2;
      R = planetRadius(w, canvasH);
      live.current.w = w;
      buildLayers();
      measureObstacles();
      forcePlace = true;
      kick();
    };

    // DPR change (window moved between displays, S11 §8 edge 8).
    let dprQuery: MediaQueryList | null = null;
    const onDpr = () => {
      resize();
      watchDpr();
    };
    const watchDpr = () => {
      dprQuery?.removeEventListener('change', onDpr);
      dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      dprQuery.addEventListener('change', onDpr);
    };

    /** Floater rects (the stat column, the City card) in mount coordinates, for chips and the tooltip. */
    const measureObstacles = () => {
      const host = mount.parentElement;
      if (!host) return;
      const m = mount.getBoundingClientRect();
      live.current.obstacles = [...host.querySelectorAll<HTMLElement>('[data-ap-floater]')]
        .map((el) => el.getBoundingClientRect())
        .filter((r) => r.width > 0 && r.height > 0)
        .map((r) => ({ x: r.left - m.left - 6, y: r.top - m.top - 6, w: r.width + 12, h: r.height + 12 }));
    };

    // Landmass dot matrix from the baked coastline samples.
    let land: Vec[] = [];
    let landAlpha = 0;
    let disposed = false;
    fetch('/adpilot/globe-dots.json')
      .then((r) => {
        if (!r.ok) throw new Error(`dots ${r.status}`);
        return r.json();
      })
      .then((dots: [number, number][]) => {
        if (disposed) return;
        land = dots.map(([lat, lng]) => latLngToVec(lat, lng));
        landAlpha = reduced ? 1 : 0;
        setLandState('ready');
        kick();
      })
      .catch(() => {
        if (!disposed) setLandState('error'); // outline, body and pins still render
      });

    // Pins, with a fade when the selection changes (F-G2).
    const pins = new Map<string, Pin>();
    let maxLeads = 1;
    let firstGeo = true;
    const setGeo = (next: GeoPoint[]) => {
      maxLeads = Math.max(1, ...next.map((g) => g.leads));
      const keys = new Set<string>();
      for (const g of next) {
        const key = cityKey(g);
        keys.add(key);
        const hit = pins.get(key);
        if (hit) {
          hit.g = g;
          hit.target = 1;
        } else {
          pins.set(key, { key, g, v: latLngToVec(g.lat, g.lng), a: reduced || firstGeo ? 1 : 0, target: 1 });
        }
      }
      for (const p of pins.values()) if (!keys.has(p.key)) p.target = 0;
      if (reduced) for (const [k, p] of pins) if (p.target === 0) pins.delete(k);
      firstGeo = false;
      forcePlace = true;
      kick();
    };

    // Rotation state.
    let yaw = 0;
    let pitch = TILT;
    let velocity = reduced ? 0 : IDLE_SPIN;
    let idle = 0;
    let spinOn = !reduced;
    let resumeTimer = 0;
    let tween: { from: [number, number]; to: [number, number]; t0: number; ms: number } | null = null;
    let dragging = false;
    let downX = 0;
    let downY = 0;
    let lastX = 0;
    let lastY = 0;
    let moved = 0;
    let pointerType = 'mouse';

    const startTween = (toYaw: number, toPitch: number, ms: number) => {
      const target: [number, number] = [nearestYaw(yaw, toYaw), Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, toPitch))];
      if (reduced || ms <= 0) {
        yaw = target[0];
        pitch = target[1];
        tween = null;
      } else {
        tween = { from: [yaw, pitch], to: target, t0: performance.now(), ms };
      }
      kick();
    };

    const focusOn = (key: string | null) => {
      window.clearTimeout(resumeTimer);
      if (key) {
        const p = pins.get(key);
        spinOn = false;
        velocity = 0;
        if (p) {
          const c = centreOn(p.g.lat, p.g.lng);
          startTween(c.yaw, c.pitch, FOCUS_MS);
        }
      } else if (!reduced) {
        // Resume the idle spin 2s after the focus clears (F-G3).
        resumeTimer = window.setTimeout(() => {
          if (live.current.focus) return;
          spinOn = true;
          idle = 121;
          kick();
        }, RESUME_MS);
      }
      // The City card just opened or closed in the floater column: chips re-place around it now.
      measureObstacles();
      forcePlace = true;
      kick();
    };

    const nudge = (dYaw: number, dPitch: number) => {
      idle = 0;
      velocity = 0;
      const base = tween ? tween.to : [yaw, pitch];
      startTween(base[0] + dYaw, base[1] + dPitch, KEY_MS);
    };

    // Projected pins from the last frame, for hover and click picking.
    let hits: Hit[] = [];
    const pick = (px: number, py: number): Hit | null => {
      let best: Hit | null = null;
      let bestD = Infinity;
      for (const h of hits) {
        const d = Math.hypot(px - h.x, py - h.y);
        if (d <= h.r && d < bestD) {
          best = h;
          bestD = d;
        }
      }
      return best;
    };

    const nearestCentre = () => {
      let best: string | null = null;
      let bestZ = -Infinity;
      for (const p of pins.values()) {
        if (p.target === 0) continue;
        const v = rotate(p.v, yaw, pitch);
        if (v.z > bestZ) {
          bestZ = v.z;
          best = p.key;
        }
      }
      return bestZ > 0 ? best : null;
    };

    /** Where a pin's head sits in mount coordinates, at the end of any running tween. */
    const pinHead = (key: string) => {
      const p = pins.get(key);
      if (!p) return null;
      const [ay, ap] = tween ? tween.to : [yaw, pitch];
      const v = rotate(p.v, ay, ap);
      if (v.z <= 0) return null;
      const s = pinSize(sizeBucket(p.g.leads, maxLeads), R);
      return { x: cx + v.x * R * 1.002, y: cy - v.y * R * 1.002 - s * 0.7 - OVERHANG };
    };

    const local = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      dragging = true;
      pointerType = e.pointerType;
      downX = lastX = e.clientX;
      downY = lastY = e.clientY;
      moved = 0;
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = 'grabbing';
    };
    const onMove = (e: PointerEvent) => {
      if (dragging) {
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        lastX = e.clientX;
        lastY = e.clientY;
        moved = Math.max(moved, Math.hypot(e.clientX - downX, e.clientY - downY));
        if (moved > CLICK_SLOP) {
          tween = null;
          yaw += dx * 0.005;
          // Touch: vertical movement belongs to the page (touch-action: pan-y).
          if (pointerType !== 'touch') pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch + dy * 0.0028));
          velocity = reduced ? 0 : dx * 0.0006;
          idle = 0;
          kick();
        }
      }
      if (e.pointerType !== 'mouse') return;
      const p = local(e);
      const hit = dragging && moved > CLICK_SLOP ? null : pick(p.x, p.y);
      if (hit) {
        const m = mount.getBoundingClientRect();
        setTip({ key: hit.key, x: e.clientX - m.left, y: e.clientY - m.top });
        canvas.style.cursor = 'pointer';
      } else {
        setTip((t) => (t && t.key !== live.current.preview ? null : t));
        canvas.style.cursor = dragging ? 'grabbing' : 'grab';
      }
    };
    const onUp = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      canvas.style.cursor = 'grab';
      if (moved <= CLICK_SLOP) {
        // A click, not a drag: a pin focuses its city; empty sphere or space clears.
        const p = local(e);
        const hit = pick(p.x, p.y);
        if (hit) live.current.onFocus(hit.key);
        else if (live.current.focus) live.current.onFocus(null);
      }
      kick();
    };
    const onCancel = () => {
      dragging = false;
      canvas.style.cursor = 'grab';
      kick();
    };
    const onLeave = () => setTip((t) => (t && t.key !== live.current.preview ? null : t));
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onCancel);
    canvas.addEventListener('pointerleave', onLeave);

    // Chips: anchor chosen by the greedy placer every 3 frames; offsets ease between anchors.
    const chips: Chip[] = [];
    let forcePlace = true;
    let frameNo = 0;
    let lastPlace = -10;
    let lastObstacles = -100;

    // The loop: scheduled on demand, never while off-screen or hidden (F-P4).
    let raf = 0;
    let onScreen = true;
    let last = performance.now();
    let perfAvg = 0;
    let perfMax = 0;
    let perfFrames = 0;

    const moving = () =>
      dragging ||
      tween !== null ||
      (!reduced && spinOn && !live.current.focus) ||
      (!reduced && Math.abs(velocity) > 1e-5) ||
      (land.length > 0 && landAlpha < 1) ||
      [...pins.values()].some((p) => p.a !== p.target) ||
      chips.some((c) => c.show && c.anchor !== null && (Math.abs(c.ox - c.tx) > 0.5 || Math.abs(c.oy - c.ty) > 0.5));

    function kick() {
      if (raf || disposed || !onScreen || document.hidden) return;
      raf = requestAnimationFrame(frame);
    }

    function frame(now: number) {
      raf = 0;
      const t0 = performance.now();
      const dt = Math.min(50, Math.max(0, now - last));
      last = now;
      const k = dt / FRAME_MS;
      frameNo += 1;
      const focused = live.current.focus;

      // Motion: tween, else drag inertia and idle spin, normalised to time (F-P1).
      if (tween) {
        const p = (now - tween.t0) / tween.ms;
        const e = easeOut(p);
        yaw = tween.from[0] + (tween.to[0] - tween.from[0]) * e;
        pitch = tween.from[1] + (tween.to[1] - tween.from[1]) * e;
        if (p >= 1) tween = null;
      } else if (!dragging && !reduced) {
        yaw += velocity * k;
        idle += k;
        if (spinOn && !focused && idle > 120) velocity += (IDLE_SPIN - velocity) * (1 - Math.pow(0.98, k));
        else velocity *= Math.pow(0.985, k);
        if (!(spinOn && !focused) && Math.abs(velocity) <= 1e-5) velocity = 0;
      }

      // Fades.
      const step = reduced ? 1 : dt / FADE_MS;
      for (const [key, p] of pins) {
        if (p.a < p.target) p.a = Math.min(p.target, p.a + step);
        else if (p.a > p.target) p.a = Math.max(p.target, p.a - step);
        if (p.a === 0 && p.target === 0) pins.delete(key);
      }
      if (land.length && landAlpha < 1) landAlpha = reduced ? 1 : Math.min(1, landAlpha + dt / LAND_FADE_MS);

      // Draw.
      ctx!.setTransform(1, 0, 0, 1, 0, 0);
      ctx!.clearRect(0, 0, canvas!.width, canvas!.height);
      ctx!.drawImage(layer, 0, 0);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Land dots: front hemisphere only, dimming toward the horizon, batched by alpha (F-P3).
      if (land.length && landAlpha > 0) {
        const dot = Math.max(1, R * 0.0065);
        const half = dot / 2;
        const paths = Array.from({ length: LAND_BUCKETS }, () => new Path2D());
        for (const p of land) {
          const v = rotate(p, yaw, pitch);
          if (v.z <= 0) continue;
          const b = Math.min(LAND_BUCKETS - 1, Math.floor(v.z * LAND_BUCKETS));
          paths[b].rect(cx + v.x * R - half, cy - v.y * R - half, dot, dot);
        }
        for (let b = 0; b < LAND_BUCKETS; b++) {
          const z = (b + 0.5) / LAND_BUCKETS;
          ctx!.fillStyle = tokenFill(pal.land, (0.25 + 0.67 * z) * landAlpha);
          ctx!.fill(paths[b]);
        }
      }

      // Pins with a soft ground halo, sized by leads; tip anchored on the surface.
      const coarse = coarseQuery.matches;
      const marked = focused ?? live.current.preview;
      hits = [];
      const drawn: { p: Pin; x: number; y: number; s: number }[] = [];
      for (const p of pins.values()) {
        const v = rotate(p.v, yaw, pitch);
        if (v.z <= 0 || p.a <= 0) continue;
        const x = cx + v.x * R * 1.002;
        const y = cy - v.y * R * 1.002;
        const b = sizeBucket(p.g.leads, maxLeads);
        const s = pinSize(b, R);
        drawn.push({ p, x, y, s });
        if (p.target > 0) hits.push({ x, y: y - s * 0.7, r: Math.max(coarse ? 12 : 8, s * 0.3), key: p.key });
      }
      // Smaller pins first so the big cities sit on top.
      drawn.sort((a, b) => a.s - b.s);
      for (const { p, x, y, s } of drawn) {
        ctx!.globalAlpha = p.a;
        const halo = halos[sizeBucket(p.g.leads, maxLeads)];
        if (halo) {
          const hr = s * 0.8;
          ctx!.drawImage(halo, x - hr, y - hr, hr * 2, hr * 2);
        }
        drawPin(ctx!, x, y, s, pal);
        if (p.key === marked) {
          const headR = s * 0.23;
          ctx!.strokeStyle = pal.pin;
          ctx!.lineWidth = 1.5;
          ctx!.beginPath();
          ctx!.arc(x, y - s + headR + s * 0.06, headR + 3.5, 0, Math.PI * 2);
          ctx!.stroke();
        }
      }
      ctx!.globalAlpha = 1;

      // Chips (F-G5).
      if (frameNo - lastObstacles >= 30) {
        measureObstacles();
        lastObstacles = frameNo;
      }
      const cities = live.current.chipCities;
      const slotH = live.current.height;
      const candidates: { id: string; x: number; y: number; w: number; h: number; priority: number; i: number }[] = [];
      cities.forEach((g, i) => {
        const el = chipRefs.current[i];
        if (!el) return;
        const c = (chips[i] ??= { show: false, anchor: null, ox: 0, oy: 0, tx: 0, ty: 0, w: 0, h: 0 });
        if (!c.w) {
          c.w = el.offsetWidth;
          c.h = el.offsetHeight;
        }
        const pin = pins.get(cityKey(g));
        if (!pin || pin.target === 0 || w < CHIP_MIN_WIDTH) return;
        const v = rotate(pin.v, yaw, pitch);
        if (v.z <= HORIZON_Z) return;
        const s = pinSize(sizeBucket(pin.g.leads, maxLeads), R);
        candidates.push({ id: String(i), x: cx + v.x * R * 1.002, y: cy - v.y * R * 1.002 - s * 0.7 - OVERHANG, w: c.w, h: c.h, priority: g.leads, i });
      });
      if (forcePlace || frameNo - lastPlace >= 3) {
        forcePlace = false;
        lastPlace = frameNo;
        const placed = new Map(
          placeLabels(candidates, live.current.obstacles, { x: 4, y: 4, w: w - 8, h: slotH - 8 }, CHIP_GAP).map((p) => [p.id, p]),
        );
        cities.forEach((_, i) => {
          const c = chips[i];
          if (!c) return;
          const p = placed.get(String(i));
          if (!p) {
            c.show = false;
            c.anchor = null;
            return;
          }
          const cand = candidates.find((x) => x.i === i)!;
          const r = anchorRect(cand, p.anchor, CHIP_GAP);
          c.tx = r.x - cand.x;
          c.ty = r.y - cand.y;
          if (!c.show || c.anchor === null || reduced) {
            c.ox = c.tx;
            c.oy = c.ty;
          }
          c.anchor = p.anchor;
          c.show = true;
        });
      }
      const ease = reduced ? 1 : 1 - Math.pow(0.6, k);
      const inView = new Set(candidates.map((c) => c.i));
      cities.forEach((g, i) => {
        const el = chipRefs.current[i];
        const c = chips[i];
        if (!el || !c) return;
        const cand = candidates.find((x) => x.i === i);
        const show = c.show && inView.has(i) && !!cand;
        if (show && cand) {
          c.ox += (c.tx - c.ox) * ease;
          c.oy += (c.ty - c.oy) * ease;
          el.style.transform = `translate3d(${Math.round(cand.x + c.ox)}px, ${Math.round(cand.y + c.oy)}px, 0)`;
        }
        el.dataset.show = show ? '1' : '0';
        el.dataset.focused = cityKey(g) === focused ? '1' : '0';
      });

      if (perfOn) {
        const cost = performance.now() - t0;
        perfFrames += 1;
        perfAvg = perfAvg ? perfAvg * 0.95 + cost * 0.05 : cost;
        perfMax = Math.max(perfMax, cost);
        // Diagnostics for the audit script (scripts/adpilot-globe-check.mjs): cost, and where each
        // visible pin's tip and head sit in canvas pixels.
        (window as unknown as { __apGlobePerf?: unknown }).__apGlobePerf = {
          avg: perfAvg,
          max: perfMax,
          frames: perfFrames,
          R,
          pins: drawn.filter((d) => d.p.target > 0).map((d) => ({ key: d.p.key, x: d.x, y: d.y, hy: d.y - d.s * 0.7 })),
        };
        if (perfRef.current && perfFrames % 15 === 0) {
          perfRef.current.textContent = `frame ${perfAvg.toFixed(2)}ms avg · ${perfMax.toFixed(2)}ms max · ${land.length} dots · ${pins.size} pins`;
        }
      }

      if (moving()) kick();
    }

    // Theme switch: re-read tokens and rebuild the cached layers; same canvas (F-R2).
    const themeObserver = new MutationObserver(() => {
      pal = readPalette(mount);
      buildLayers();
      chips.forEach((c) => {
        if (c) c.w = 0;
      });
      forcePlace = true;
      kick();
    });
    // data-ui, data-accent and data-mode too: under the GladOS style the globe follows the accent and mode (X3, C30).
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-ui', 'data-accent', 'data-mode'] });

    const io = new IntersectionObserver(
      (entries) => {
        onScreen = entries.some((e) => e.isIntersecting);
        if (onScreen) {
          last = performance.now();
          kick();
        } else if (raf) {
          cancelAnimationFrame(raf);
          raf = 0;
        }
      },
      { threshold: 0 },
    );
    io.observe(mount);

    const onVisibility = () => {
      if (document.hidden) {
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
      } else {
        last = performance.now();
        kick();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    const onMotion = () => {
      reduced = motionQuery.matches;
      if (reduced) {
        velocity = 0;
        spinOn = false;
      } else if (!live.current.focus) {
        spinOn = true;
      }
      kick();
    };
    motionQuery.addEventListener('change', onMotion);

    const ro = new ResizeObserver(resize);
    ro.observe(mount);
    resize();
    watchDpr();
    setGeo(live.current.geo);

    api.current = { setGeo, focusOn, nudge, nearestCentre, kick, pinHead };
    const enter = requestAnimationFrame(() => setEntered(true));

    return () => {
      disposed = true;
      api.current = null;
      cancelAnimationFrame(raf);
      cancelAnimationFrame(enter);
      window.clearTimeout(resumeTimer);
      ro.disconnect();
      io.disconnect();
      themeObserver.disconnect();
      dprQuery?.removeEventListener('change', onDpr);
      motionQuery.removeEventListener('change', onMotion);
      document.removeEventListener('visibilitychange', onVisibility);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onCancel);
      canvas.removeEventListener('pointerleave', onLeave);
    };
  }, []);

  // Selection changed: pins fade between sets (F-G2).
  useEffect(() => {
    api.current?.setGeo(geo);
  }, [geo]);

  // Focus changed: centre the city and stop the spin, or resume it after 2s (F-G3).
  useEffect(() => {
    api.current?.focusOn(focus);
  }, [focus]);

  // Tooltip: beside the pointer, flipped left or up when it would leave the slot or cover a floater (F-G4).
  useLayoutEffect(() => {
    const el = tipRef.current;
    if (!el || !tip) return;
    const tw = el.offsetWidth;
    const th = el.offsetHeight;
    const W = live.current.w;
    const H = live.current.height;
    let left = tip.x + 14;
    let top = tip.y - 10;
    const hitsFloater = (x: number, y: number) =>
      live.current.obstacles.some((o) => x < o.x + o.w && o.x < x + tw && y < o.y + o.h && o.y < y + th);
    if (left + tw > W - 4 || hitsFloater(left, top)) left = tip.x - 14 - tw;
    if (top + th > H - 4) top = tip.y - th - 10;
    if (top < 4) top = 4;
    if (left < 4) left = 4;
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
  }, [tip]);

  const tipCity = tip ? byKey.get(tip.key) : undefined;

  // Hidden list focus previews the city: rotate it to the centre and show its tooltip there.
  const preview = (key: string | null) => {
    live.current.preview = key;
    const a = api.current;
    if (!a) return;
    a.focusOn(key ?? live.current.focus);
    if (key) {
      const head = a.pinHead(key);
      setTip({ key, x: head?.x ?? live.current.w / 2, y: head?.y ?? live.current.height / 2 });
    } else {
      setTip(null);
    }
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const a = api.current;
    if (!a) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const dYaw = e.key === 'ArrowLeft' ? -KEY_YAW : e.key === 'ArrowRight' ? KEY_YAW : 0;
      const dPitch = e.key === 'ArrowUp' ? -KEY_PITCH : e.key === 'ArrowDown' ? KEY_PITCH : 0;
      a.nudge(dYaw, dPitch);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const key = a.nearestCentre();
      if (key) onFocus(key);
    }
  };

  const label = globeLabel(geo, emptyLabel, unitLabel);
  // Under the GladOS style (GStyleProvider) the chips are kit chips and the focus region a kit viz part (GP4).
  const gc = useGc();
  const planetPx = Math.round(planetRadius(live.current.w || 1, height + OVERHANG * 2) * 2);

  return (
    <div
      ref={mountRef}
      data-globe
      tabIndex={0}
      role="group"
      aria-label={`${globeNoun} globe. Arrow keys rotate it, Enter opens the city nearest the centre, Escape closes it.`}
      onKeyDown={onKey}
      className={gc('g-viz-globe ap-globe relative w-full outline-none', 'ap-globe relative w-full outline-none')}
      data-entered={entered ? '1' : '0'}
      // overflow stays visible so the overhanging canvas can breathe
      style={{ height }}
    >
      <canvas ref={canvasRef} role="img" aria-label={label} className="ap-globe-canvas absolute left-0 z-0" style={{ top: -OVERHANG }} />
      <div aria-hidden className="ap-globe-ring" style={{ width: planetPx, height: planetPx }} />
      {/* Top-city label chips, positioned by the render loop (no re-renders). */}
      {chipCities.map((g, i) => (
        <button
          key={cityKey(g)}
          type="button"
          tabIndex={-1}
          aria-hidden
          data-show="0"
          ref={(el) => {
            chipRefs.current[i] = el;
          }}
          onClick={() => onFocus(cityKey(g))}
          title={`${g.city}, ${g.country}: open the ${cardLabel}`}
          className={gc('g-chip ap-globe-chip absolute left-0 top-0 z-20', 'ap-globe-chip absolute left-0 top-0 z-20 flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1')}
        >
          <span className="text-[12px] text-os-text">{g.city}</span>
          <span className="text-[11px] tabular-nums text-os-muted">{g.leads} {unitLabel}</span>
        </button>
      ))}
      {tip && tipCity && (
        <div ref={tipRef} role="tooltip" className="ap-globe-tip pointer-events-none absolute z-30 px-3 py-2" style={{ left: tip.x + 14, top: tip.y - 10 }}>
          <div className="text-[12.5px] text-os-text">
            {tipCity.city}, {tipCity.country}
          </div>
          <div className="text-[11.5px] tabular-nums text-os-muted">
            {tipCity.leads} {unitLabel} · {tipCity.bookings} {secondaryLabel}
          </div>
        </div>
      )}
      {/* Keyboard and screen-reader path to every city (F-G6). */}
      <ul className="sr-only" aria-label="Cities by leads">
        {listCities.map((g) => {
          const key = cityKey(g);
          return (
            <li key={key}>
              <button
                type="button"
                data-city-key={key}
                className={gc('g-sr', '') || undefined}
                aria-pressed={focus === key}
                onFocus={() => preview(key)}
                onBlur={() => preview(null)}
                onClick={() => onFocus(key)}
              >
                {g.city}, {g.country}: {g.leads} {unitLabel}, {g.bookings} {secondaryLabel}
              </button>
            </li>
          );
        })}
      </ul>
      {landState === 'error' && (
        <p className="absolute inset-x-0 bottom-1 z-10 text-center text-[11.5px] text-os-dim">Map outline unavailable</p>
      )}
      {perf && <div ref={perfRef} className="ap-globe-perf absolute left-2 top-2 z-30 px-2 py-1 text-[11px] tabular-nums" />}
    </div>
  );
}
