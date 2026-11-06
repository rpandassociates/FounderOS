/**
 * Channel analytics for /funnel (FounderOS merge F7, FO `FunnelChannelAnalytics`).
 * Leads, bookings and revenue per acquisition channel, read off the journeys'
 * Trakyo first touches (merged in app/funnel/page.tsx by mergeTrakyoTouches).
 * Pure and client-safe.
 *
 * Honesty rules:
 *  - Only an attributed first touch (Trakyo, or Meta Ads = paid) names a
 *    channel. A journey whose first touch came from the CRM (or a hand entry)
 *    is Unattributed, never guessed from a deal title.
 *  - Booked = the journey has a call touch or converted. Revenue = the
 *    converted journeys' amounts. Nothing is interpolated.
 *  - The channel taxonomy and its keyword rules follow FO v2
 *    `lib/funnel-analytics.ts`; only explicit referral wording counts as word
 *    of mouth.
 */
import type { FunnelJourney } from '@/lib/schemas';

export const FUNNEL_CHANNELS = [
  { id: 'youtube', label: 'YouTube' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'linkedin', label: 'LinkedIn' },
  { id: 'x', label: 'X' },
  { id: 'newsletter', label: 'Newsletter' },
  { id: 'word_of_mouth', label: 'Word of mouth' },
  { id: 'forms', label: 'Forms and waitlist' },
  { id: 'paid', label: 'Paid social' },
  { id: 'facebook', label: 'Facebook' },
  { id: 'search', label: 'Search' },
  { id: 'other', label: 'Other content' },
  { id: 'unattributed', label: 'Unattributed' },
] as const;
export type FunnelChannelId = (typeof FUNNEL_CHANNELS)[number]['id'];

export const channelLabel = (id: FunnelChannelId): string => FUNNEL_CHANNELS.find((c) => c.id === id)?.label ?? id;

/** Name the channel from a touch label (`YouTube: How I…`, `Meta ad: …`). */
export function classifyChannel(label: string, paid = false): FunnelChannelId {
  if (paid || /\bmeta ad\b/i.test(label)) return 'paid';
  if (/youtube|youtu\.be|\byt\b/i.test(label)) return 'youtube';
  if (/instagram|\big\b|\binsta\b/i.test(label)) return 'instagram';
  if (/linkedin/i.test(label)) return 'linkedin';
  if (/twitter|(?:^|[/.\s])x\.com|^x:|\bx (post|thread|bio)\b/i.test(label)) return 'x';
  if (/newsletter|beehiiv|email list/i.test(label)) return 'newsletter';
  if (/word[ -]of[ -]mouth|personal referral|recommendation/i.test(label)) return 'word_of_mouth';
  if (/facebook|\bfb\b/i.test(label)) return 'facebook';
  if (/google\.|bing\.|duckduckgo\.|\bsearch\b/i.test(label)) return 'search';
  if (/waitlist|typeform|\bform\b|opt.?in/i.test(label)) return 'forms';
  return 'other';
}

/**
 * A journey's acquisition channel: its Trakyo first touch (or a Meta Ads
 * first touch, which is paid by definition), else Unattributed.
 */
export function channelOfJourney(j: FunnelJourney): FunnelChannelId {
  const first = j.touches[0];
  if (!first) return 'unattributed';
  if (first.source === 'meta-ads') return 'paid';
  if (first.source === 'wordpress') return 'forms';
  if (first.source !== 'trakyo') return 'unattributed';
  return classifyChannel(first.label, first.channel === 'ads');
}

export const isBooked = (j: FunnelJourney): boolean => j.status === 'converted' || j.touches.some((t) => t.channel === 'call');

export type ChannelRow = {
  id: FunnelChannelId;
  label: string;
  leads: number;
  /** booked a call but not converted */
  booked: number;
  converted: number;
  /** booked + converted: every journey that reached a call */
  bookings: number;
  revenueUsd: number;
};

export type ChannelAnalytics = {
  /** channels with at least one lead, busiest first; Unattributed last */
  rows: ChannelRow[];
  total: number;
  /** journeys whose first touch names a channel */
  attributed: number;
};

export function channelAnalytics(journeys: readonly FunnelJourney[]): ChannelAnalytics {
  const by = new Map<FunnelChannelId, ChannelRow>();
  let attributed = 0;
  for (const j of journeys) {
    const id = channelOfJourney(j);
    if (id !== 'unattributed') attributed++;
    const row = by.get(id) ?? { id, label: channelLabel(id), leads: 0, booked: 0, converted: 0, bookings: 0, revenueUsd: 0 };
    row.leads++;
    if (j.status === 'converted') {
      row.converted++;
      row.bookings++;
      row.revenueUsd += j.amountUsd ?? 0;
    } else if (isBooked(j)) {
      row.booked++;
      row.bookings++;
    }
    by.set(id, row);
  }
  const order = FUNNEL_CHANNELS.map((c) => c.id as string);
  const rows = [...by.values()].sort((a, b) => {
    if (a.id === 'unattributed') return 1;
    if (b.id === 'unattributed') return -1;
    return b.leads - a.leads || b.revenueUsd - a.revenueUsd || order.indexOf(a.id) - order.indexOf(b.id);
  });
  return { rows, total: journeys.length, attributed };
}

/** The card's state, decided once on the server and shared by every tree. */
export type ChannelsCard =
  | { state: 'not_configured'; setupHref: string }
  | { state: 'ready'; sample: boolean; analytics: ChannelAnalytics; setupHref: string };
