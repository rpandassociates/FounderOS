import type { Campaign, GeoPoint } from '@/lib/adpilot';

/**
 * Globe data helpers (SPEC S11 §7): the City card breakdown, the chip
 * placer and the accessible label. Pure and client-safe; tested in
 * tests/adpilot-globe.test.ts.
 */

/** One city across campaigns is keyed by city and country (same rule as aggregateGeo). */
export function cityKey(g: Pick<GeoPoint, 'city' | 'country'>): string {
  return `${g.city}|${g.country}`;
}

export type CityBreakdown = {
  key: string;
  city: string;
  country: string;
  lat: number;
  lng: number;
  leads: number;
  bookings: number;
  /** bookings / leads; null when the city has no leads (S11 §8 edge 3). */
  bookingRate: number | null;
  /** The city's share of all leads in `campaigns`; null when there are none. */
  share: number | null;
  /** Every campaign whose geo holds the city, most leads first. Rows sum to the totals. */
  byCampaign: { id: string; name: string; leads: number; bookings: number }[];
};

/**
 * What the City card shows (S11 F-G3): totals for one city over `campaigns`
 * (the deck's current selection), its booking rate, its share of the
 * selection's leads and the per-campaign rows. Null when no campaign in
 * the selection has the city.
 */
export function cityBreakdown(
  campaigns: Pick<Campaign, 'id' | 'name' | 'geo'>[],
  city: string,
  country: string,
): CityBreakdown | null {
  let total = 0;
  let leads = 0;
  let bookings = 0;
  let at: { lat: number; lng: number } | null = null;
  const rows: CityBreakdown['byCampaign'] = [];
  for (const c of campaigns) {
    let cl = 0;
    let cb = 0;
    let hit = false;
    for (const g of c.geo) {
      total += g.leads;
      if (g.city !== city || g.country !== country) continue;
      hit = true;
      cl += g.leads;
      cb += g.bookings;
      at ??= { lat: g.lat, lng: g.lng };
    }
    if (!hit) continue;
    leads += cl;
    bookings += cb;
    rows.push({ id: c.id, name: c.name, leads: cl, bookings: cb });
  }
  if (!at) return null;
  rows.sort((a, b) => b.leads - a.leads || a.name.localeCompare(b.name));
  return {
    key: cityKey({ city, country }),
    city,
    country,
    lat: at.lat,
    lng: at.lng,
    leads,
    bookings,
    bookingRate: leads > 0 ? bookings / leads : null,
    share: total > 0 ? leads / total : null,
    byCampaign: rows,
  };
}

export type Rect = { x: number; y: number; w: number; h: number };
export type Anchor = 'ne' | 'nw' | 'se' | 'sw';
export type LabelCandidate = { id: string; x: number; y: number; w: number; h: number; priority: number };
export type PlacedLabel = { id: string; x: number; y: number; anchor: Anchor };

export const LABEL_ANCHORS: Anchor[] = ['ne', 'nw', 'se', 'sw'];

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function inside(r: Rect, b: Rect): boolean {
  return r.x >= b.x && r.y >= b.y && r.x + r.w <= b.x + b.w && r.y + r.h <= b.y + b.h;
}

/** The chip rect for a pin point and an anchor, `gap` px off the pin head. */
export function anchorRect(c: Pick<LabelCandidate, 'x' | 'y' | 'w' | 'h'>, anchor: Anchor, gap: number): Rect {
  const x = anchor === 'ne' || anchor === 'se' ? c.x + gap : c.x - gap - c.w;
  const y = anchor === 'ne' || anchor === 'nw' ? c.y - gap - c.h : c.y + gap;
  return { x, y, w: c.w, h: c.h };
}

/**
 * Greedy chip placer (S11 F-G5): highest priority first, each tries NE, NW,
 * SE, SW and takes the first rect that stays inside `bounds` and touches no
 * placed chip and no obstacle (the floater column). A chip with no free
 * anchor is left out; its city stays reachable by hover, click and the list.
 * Deterministic: ties break on id.
 */
export function placeLabels(candidates: LabelCandidate[], obstacles: Rect[], bounds: Rect, gap = 12): PlacedLabel[] {
  const order = [...candidates].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  const taken: Rect[] = [];
  const out: PlacedLabel[] = [];
  for (const c of order) {
    for (const anchor of LABEL_ANCHORS) {
      const r = anchorRect(c, anchor, gap);
      if (!inside(r, bounds)) continue;
      if (obstacles.some((o) => intersects(r, o)) || taken.some((t) => intersects(r, t))) continue;
      taken.push(r);
      out.push({ id: c.id, x: r.x, y: r.y, anchor });
      break;
    }
  }
  return out;
}

/** The canvas's accessible name (S11 F-G6, F-G7). `unit` names the metric (AdPilot: 'leads'). */
export function globeLabel(geo: GeoPoint[], emptyLabel = 'No lead locations yet', unit = 'leads'): string {
  if (geo.length === 0) return emptyLabel;
  const noun = unit.charAt(0).toUpperCase() + unit.slice(1);
  const top = [...geo]
    .sort((a, b) => b.leads - a.leads)
    .slice(0, 3)
    .map((g) => `${g.city} ${g.leads}`)
    .join(', ');
  return `${noun} by city: ${geo.length} ${geo.length === 1 ? 'city' : 'cities'}. Top: ${top}.`;
}
