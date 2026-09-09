/** Day Book atoms — channel signature + confidence chip + the nature chip. */
import { Camera, Mic } from 'lucide-react';
import type { RoughEntrySource } from '../../types';
import { V, WA, font, mono } from './tokens';

/** The WhatsApp brand mark, drawn (channel signature only). */
export function WhatsAppGlyph({ size = 13, color = WA }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} aria-hidden="true">
      <path d="M.057 24l1.687-6.163a11.867 11.867 0 01-1.587-5.946C.16 5.335 5.495 0 12.05 0a11.817 11.817 0 018.413 3.488 11.824 11.824 0 013.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 01-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884a9.86 9.86 0 001.51 5.26l-.999 3.648 3.978-1.115zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.096 3.2 5.077 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413z" />
    </svg>
  );
}

const CHANNEL: Record<RoughEntrySource, { label: string; sub?: typeof Camera }> = {
  WHATSAPP_TEXT:  { label: 'WhatsApp' },
  WHATSAPP_IMAGE: { label: 'WhatsApp photo', sub: Camera },
  WHATSAPP_VOICE: { label: 'WhatsApp voice', sub: Mic },
  UI_TEXT:        { label: 'Added here' },
  UI_IMAGE:       { label: 'Scan' },
};

export function ChannelBadge({ source }: { source: RoughEntrySource }) {
  const m = CHANNEL[source] ?? CHANNEL.WHATSAPP_TEXT;
  const whatsapp = source.startsWith('WHATSAPP');
  const Sub = m.sub;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-md" style={{ background: V.field, ...font }}>
      {whatsapp ? <WhatsAppGlyph size={12} /> : Sub ? <Sub size={11} style={{ color: V.faint }} /> : null}
      <span style={{ color: V.sys }}>{m.label}</span>
    </span>
  );
}

/**
 * NATURE CHIP — the quiet mark of what a card IS, in the ledger's own docket voice: a soft wash, a small
 * dot, a mono uppercase label with generous tracking. It sits beside the voucher furniture (Nº, timestamp),
 * never shouting — colour carries meaning (terra = money out / a bill, sage = labour / money in), but at low
 * saturation so it reads as a tab on a document, not a status alarm.
 */
export type ChipTone = 'neutral' | 'terra' | 'sage' | 'ask';
const CHIP_TONES: Record<ChipTone, { bg: string; fg: string; dot: string; border: string }> = {
  neutral: { bg: V.field,      fg: V.sys,      dot: V.faint, border: 'transparent' },
  terra:   { bg: V.terraWash,  fg: V.terraDeep, dot: V.terra, border: 'rgba(188,75,39,.16)' },
  sage:    { bg: V.sageWash,   fg: V.sage,     dot: V.sage,  border: 'rgba(47,93,52,.16)' },
  ask:     { bg: V.askWash,    fg: V.ask,      dot: V.ask,   border: V.askLine },
};

export function NatureChip({ label, tone = 'neutral' }: { label: string; tone?: ChipTone }) {
  const t = CHIP_TONES[tone];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5.5, padding: '3px 9px', borderRadius: 999,
      background: t.bg, border: `1px solid ${t.border}`, color: t.fg, lineHeight: 1, whiteSpace: 'nowrap',
      ...mono, fontSize: 9.5, fontWeight: 600, letterSpacing: '.12em', textTransform: 'uppercase',
    }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: t.dot }} />
      {label}
    </span>
  );
}

/** What KIND of entry this is — the label + tone for its NatureChip. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function natureOf(entry: { ai_extracted?: any }): { label: string; tone: ChipTone } {
  const ai = (entry.ai_extracted ?? {}) as Record<string, unknown>;
  if (ai.kind === 'BILL') {
    const paid = !!(ai.payment as { amount?: number } | null)?.amount;
    return { label: paid ? 'Bill · Paid' : 'Bill', tone: 'terra' };
  }
  const t = ai.transaction_type;
  if (t === 'Worker Payment') return { label: 'Labour', tone: 'sage' };
  if (t === 'Material Purchase') return { label: 'Material', tone: 'terra' };
  if (t === 'General Expense') return { label: 'Overhead', tone: 'neutral' };
  if (ai.direction === 'in') return { label: 'Receipt', tone: 'sage' };
  return { label: 'Payment', tone: 'neutral' };
}

/** ready = the entry can be filed as-is; otherwise it needs the owner's eye. */
export function ConfidenceDot({ ready }: { ready: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full"
      style={ready
        ? { background: V.field, color: V.sys, ...font }
        : { background: V.askWash, border: `1px solid ${V.askLine}`, color: V.ask, ...font }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: ready ? V.terra : V.ask }} />
      {ready ? 'ready to file' : 'needs your eye'}
    </span>
  );
}
