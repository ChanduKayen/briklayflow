/**
 * The invitation: a warm-dark banner inviting site people onto WhatsApp, plus
 * the Manage-team slide-over. The slide-over shows your platform team
 * (org_memberships → user_profiles) and outstanding email invites (org_invites),
 * and lets you invite a teammate through the SAME route as the /team page
 * (create_invite RPC → /invite/{token}). Inviting also registers their number in
 * wa_registered_numbers, whose is_active toggle is the real "can capture" gate the
 * webhook enforces — turning it off stops that contact's future captures.
 *
 * HONEST INVITE: there is no approved outbound template yet, so "Start on
 * WhatsApp" opens the StartOnWhatsApp surface — a QR + click-to-chat link to
 * Briklay's number, so a person scans and says the first hello inbound (a
 * business cannot message a user unprompted without a template). Who may send
 * is governed separately in the Manage-team slide-over. No fake "invite sent".
 *
 * project-per-contact is intentionally not shown — wa_registered_numbers has no
 * project column yet (follow-up schema ticket).
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { UserPlus, X, Phone, Mail, Copy, Check, Clock, Loader2, ArrowRight, Pencil } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useSnackbar } from '../Snackbar';
import { useOrgId } from '../../lib/auth/AuthProvider';
import { N, V, WA, font, serif, nums, terraGrad, T } from './tokens';
import { WhatsAppGlyph } from './atoms';
import { StartOnWhatsApp } from './StartOnWhatsApp';

interface WaContact {
  id: string;
  phone_number: string;
  name: string;
  role: string;
  is_active: boolean;
  preferred_language: string | null;   // voice-note language (ISO-639-1); null = auto
  stakeholder_id: string | null;
  user_id: string | null;              // links a sender row to an org member (auth.users.id)
  welcomed_at: string | null;          // when the one-time welcome was sent; null = never
  oriented_at: string | null;          // when first-contact orientation was sent; null = never
  invite_status: string;               // 'active' | 'invited' (self-activates on first msg) | 'revoked'
  created_at: string;
}

/** Voice-note language per sender. "" (Auto) clears the override -> deployment locale
 *  prior / auto-detect. Speech language is set here because how someone TYPES isn't how
 *  they SPEAK (romanized English is common among Telugu/Hindi speakers). */
const VOICE_LANGS = [
  { value: '', label: 'Auto' },
  { value: 'te', label: 'Telugu' },
  { value: 'hi', label: 'Hindi' },
  { value: 'en', label: 'English' },
] as const;

const digits = (s: string) => s.replace(/\D/g, '');
/** Last 10 digits — the local part, used for display + matching across stored formats. */
const local10 = (s: string) => digits(s).slice(-10);
/** Canonical stored form: international +91 (digits only), matching what Meta sends
 *  inbound as `from` and what the webhook looks up. Day Book MUST store this so a
 *  registered number is recognised on the next inbound message. */
const intlPhone = (s: string) => '91' + local10(s);

/** Platform roles a teammate can be invited as (mirrors the /team access route). */
const INVITE_ROLES = [
  { value: 'supervisor', label: 'Supervisor' },
  { value: 'accountant', label: 'Accountant' },
  { value: 'management', label: 'Management' },
] as const;

interface OrgMember { id: string; name: string; role: string }
interface PendingInvite { invite_id: string; email: string; role: string; token: string; expires_at: string }

function useTeam() {
  return useQuery({
    queryKey: ['wa_registered_numbers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('wa_registered_numbers')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as WaContact[];
    },
  });
}

/** People already on your platform (org_memberships, names from user_profiles).
 *  Fetched in two steps on purpose: embedding user_profiles makes PostgREST join
 *  two tables that both carry an org_id column, so the `.eq('org_id', …)` filter
 *  compiles to an ambiguous `where org_id = …`. Separate queries dodge that. */
function useOrgMembers(orgId: string) {
  return useQuery({
    queryKey: ['daybook_org_members', orgId],
    queryFn: async () => {
      const { data: rows, error } = await supabase
        .from('org_memberships')
        .select('role, status, user_id')
        .eq('org_id', orgId)
        .eq('status', 'active')
        .order('joined_at', { ascending: false });
      if (error) throw error;
      const ids = (rows ?? []).map((r) => r.user_id).filter(Boolean);
      if (ids.length === 0) return [];
      const { data: profiles, error: pErr } = await supabase
        .from('user_profiles')
        .select('id, name')
        .in('id', ids);
      if (pErr) throw pErr;
      const nameById = new Map((profiles ?? []).map((p) => [p.id, p.name as string]));
      return (rows ?? []).map((r) => ({
        id: r.user_id,
        name: nameById.get(r.user_id) ?? 'Unnamed',
        role: r.role,
      })) as OrgMember[];
    },
  });
}

/** Outstanding email invites (org_invites), the same rows the /team page manages. */
function usePendingInvites(orgId: string) {
  return useQuery({
    queryKey: ['daybook_pending_invites', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('org_invites')
        .select('invite_id, email, role, token, expires_at')
        .eq('org_id', orgId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as PendingInvite[];
    },
  });
}

const inviteLinkFor = (token: string) => `${window.location.origin}/invite/${token}`;

// ── Manage team slide-over ──────────────────────────────────────────────────────
const roleLabel = (r: string) => r.charAt(0).toUpperCase() + r.slice(1);
const daysLeft = (iso: string) => Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));
const norm = (s: string) => (s || '').trim().toLowerCase();
const prettyPhone = (p: string) => { const d = local10(p); return d.length === 10 ? `${d.slice(0, 5)} ${d.slice(5)}` : d; };
const initials = (name: string) => (name || '?').split(' ').filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?';

/** A tiny green pill toggle, shared by member rows and legacy sender rows. */
function WaToggle({ on, busy, onClick }: { on: boolean; busy?: boolean; onClick: () => void }) {
  return (
    <button
      aria-label="Toggle WhatsApp access"
      disabled={busy}
      onClick={onClick}
      className="w-9 h-5 rounded-full relative shrink-0"
      style={{ background: on ? WA : V.line, transition: 'background .18s ease', opacity: busy ? 0.6 : 1 }}
    >
      <span
        className="absolute top-0.5 w-4 h-4 rounded-full flex items-center justify-center"
        style={{ background: '#fff', left: on ? 18 : 2, transition: 'left .18s cubic-bezier(.3,.8,.3,1.2)', boxShadow: '0 1px 2px rgba(0,0,0,0.18)' }}
      >
        {busy && <Loader2 size={9} className="db-spin" style={{ color: WA }} />}
      </span>
    </button>
  );
}

const VOICE_LANG_SELECT = (value: string, onChange: (v: string) => void) => (
  <select
    aria-label="Voice note language"
    title="Language for this person's voice notes"
    value={value}
    onChange={(e) => onChange(e.target.value)}
    className="px-2 rounded-lg outline-none shrink-0 appearance-none"
    style={{ background: V.field, color: value ? V.ink : V.faint, height: 30, ...font, ...T.xs }}
  >
    {VOICE_LANGS.map((l) => <option key={l.value} value={l.value}>{l.value ? `🎙 ${l.label}` : 'Auto'}</option>)}
  </select>
);

/**
 * Inline editor to change an existing sender's WhatsApp number. Validates a
 * 10-digit local number; onSave receives the digits and is expected to store the
 * canonical +91 form. Shared by member rows and other-sender rows. Closes itself
 * on a successful save (the list refetches and shows the new number).
 */
function NumberEditor({ initial, onSave, onCancel }: {
  initial: string;
  onSave: (phone: string) => Promise<void>;
  onCancel: () => void;
}) {
  const { show } = useSnackbar();
  const [val, setVal] = useState(local10(initial));
  const [saving, setSaving] = useState(false);
  const ok = digits(val).length >= 10;
  const save = async () => {
    if (!ok) { show('Enter a 10-digit WhatsApp number', { type: 'error' }); return; }
    setSaving(true);
    try { await onSave(digits(val)); onCancel(); }
    catch (e: any) { show(e?.message || 'Could not update the number', { type: 'error' }); setSaving(false); }
  };
  return (
    <div className="mt-3 db-drop">
      <p className="mb-1.5" style={{ color: V.sys, ...font, ...T.xs }}>Change WhatsApp number</p>
      <div className="flex items-center gap-2">
        <div className="inline-flex items-center gap-2 px-3 rounded-lg flex-1" style={{ background: V.field, height: 40 }}>
          <WhatsAppGlyph size={13} color={WA} />
          <span style={{ color: V.faint, ...font, ...nums, ...T.sm }}>+91</span>
          <input
            autoFocus value={val}
            onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && ok) save(); }}
            placeholder="98765 43210"
            className="bg-transparent outline-none flex-1 min-w-0"
            style={{ color: V.ink, ...font, ...nums, ...T.sm }}
          />
        </div>
        <button onClick={onCancel} className="px-3 py-2 rounded-lg shrink-0" style={{ border: `1px solid ${V.line}`, color: V.sys, ...font, ...T.xs }}>Cancel</button>
        <button
          disabled={!ok || saving}
          onClick={save}
          className="inline-flex items-center gap-1 px-3 py-2 rounded-lg font-medium shrink-0"
          style={{ background: 'rgba(37,211,102,0.16)', color: WA, opacity: ok && !saving ? 1 : 0.5, ...font, ...T.xs }}
        >
          {saving ? <Loader2 size={13} className="db-spin" /> : <>Save <Check size={13} /></>}
        </button>
      </div>
      <p className="mt-1.5 leading-relaxed" style={{ color: V.faint, ...font, ...T.xs }}>They'll be recognised on this number from their next message. History stays.</p>
    </div>
  );
}

/**
 * A legacy / phone-only sender row (not tied to a platform member). Toggle send
 * access, set voice language, and change the number inline.
 */
function OtherSenderRow({ contact, onToggle, onLang, onChangeNumber }: {
  contact: WaContact;
  onToggle: () => void;
  onLang: (lang: string | null) => void;
  onChangeNumber: (phone: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="rounded-xl p-3" style={{ background: V.surface, border: '1px solid #E3DDD4', opacity: contact.is_active ? 1 : 0.55 }}>
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="font-medium truncate" style={{ color: V.ink, ...font, ...T.sm }}>{contact.name || 'Site contact'}</p>
          <p className="truncate mt-0.5 inline-flex items-center gap-1" style={{ color: V.sys, ...font, ...nums, ...T.xs }}>
            <Phone size={10} style={{ color: V.faint }} /> +91 {prettyPhone(contact.phone_number)}
            {!editing && (
              <button onClick={() => setEditing(true)} aria-label="Change number" className="ml-1 shrink-0" style={{ color: V.faint }}><Pencil size={11} /></button>
            )}
          </p>
        </div>
        {!editing && VOICE_LANG_SELECT(contact.preferred_language ?? '', (v) => onLang(v || null))}
        {!editing && <WaToggle on={contact.is_active} onClick={onToggle} />}
      </div>
      {editing && <NumberEditor initial={contact.phone_number} onSave={onChangeNumber} onCancel={() => setEditing(false)} />}
    </div>
  );
}

/**
 * One org member, with their WhatsApp send-eligibility inline. The unit of the
 * redesigned panel: name · number · toggle, with a number-capture step when no
 * number is on file, and a subtle select→success motion on grant (which also
 * fires the welcome message, server-side).
 */
function WaMemberRow({
  member, sender, suggestPhone, onEnable, onDisable, onLang, onChangeNumber,
}: {
  member: OrgMember;
  sender: WaContact | null;
  suggestPhone: string;
  onEnable: (phone: string) => Promise<boolean>;   // resolves true if a welcome was sent
  onDisable: () => Promise<void>;
  onLang: (lang: string | null) => void;
  onChangeNumber?: (phone: string) => Promise<void>;   // change an existing sender row's number
}) {
  const { show } = useSnackbar();
  const active = !!sender?.is_active;
  const knownPhone = local10(sender?.phone_number ?? suggestPhone ?? '');
  type Phase = 'idle' | 'capture' | 'saving' | 'sent' | 'edit';
  const [phase, setPhase] = useState<Phase>('idle');
  const [welcomed, setWelcomed] = useState(false);
  const [val, setVal] = useState('');

  const doEnable = async (phone: string) => {
    const ph = digits(phone);
    if (ph.length < 10) { show('Enter a 10-digit WhatsApp number', { type: 'error' }); return; }
    setPhase('saving');
    try {
      const didWelcome = await onEnable(ph);
      setWelcomed(didWelcome);
      setPhase('sent');
      setTimeout(() => setPhase('idle'), 1900);
    } catch (e: any) {
      show(e?.message || 'Could not enable WhatsApp', { type: 'error' });
      setPhase('idle');
    }
  };

  const onToggle = async () => {
    if (active) {
      setPhase('saving');
      try { await onDisable(); } catch (e: any) { show(e?.message || 'Could not update', { type: 'error' }); }
      setPhase('idle');
      return;
    }
    if (knownPhone.length >= 10) { doEnable(knownPhone); return; }
    setVal(suggestPhone || '');
    setPhase('capture');
  };

  const showNumber = active || knownPhone.length >= 10;

  return (
    <div
      className={`rounded-xl p-3.5 ${phase === 'saving' ? 'db-glow' : ''}`}
      style={{ background: V.surface, border: '1px solid #E3DDD4', transition: 'opacity .2s', opacity: active || phase !== 'idle' ? 1 : 0.92 }}
    >
      <div className="flex items-center gap-3">
        <span className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 font-medium" style={{ background: V.terraWash, color: V.terraDeep, ...font, ...T.sm }}>
          {initials(member.name)}
        </span>
        <div className="flex-1 min-w-0">
          <p className="font-medium truncate" style={{ color: V.ink, ...font, ...T.sm }}>{member.name || 'Unnamed'}</p>
          {phase === 'sent' ? (
            <p className="truncate mt-0.5 inline-flex items-center gap-1 db-drop" style={{ color: WA, ...font, ...T.xs }}>
              <WhatsAppGlyph size={10} color={WA} /> {welcomed ? 'Welcome sent' : 'Sending enabled'}
            </p>
          ) : showNumber ? (
            <p className="truncate mt-0.5 inline-flex items-center gap-1" style={{ color: V.sys, ...font, ...nums, ...T.xs }}>
              <Phone size={10} style={{ color: V.faint }} /> +91 {prettyPhone(knownPhone)}
              {sender && onChangeNumber && phase === 'idle' && (
                <button onClick={() => setPhase('edit')} aria-label="Change number" className="ml-1 shrink-0" style={{ color: V.faint }}><Pencil size={11} /></button>
              )}
            </p>
          ) : (
            <p className="truncate mt-0.5" style={{ color: V.faint, ...font, ...T.xs }}>{roleLabel(member.role)} · add a number to enable</p>
          )}
        </div>

        {/* voice language only once active — keeps the row calm until it matters */}
        {active && phase !== 'capture' && phase !== 'edit' && VOICE_LANG_SELECT(sender?.preferred_language ?? '', (v) => onLang(v || null))}

        {phase === 'sent' ? (
          <span className="w-7 h-7 rounded-full inline-flex items-center justify-center shrink-0 db-ring" style={{ background: 'rgba(37,211,102,0.14)' }}>
            <Check size={14} color={WA} strokeWidth={3} />
          </span>
        ) : (
          <WaToggle on={active} busy={phase === 'saving'} onClick={onToggle} />
        )}
      </div>

      {/* inline number capture */}
      {phase === 'capture' && (
        <div className="mt-3 db-drop">
          <p className="mb-1.5" style={{ color: V.sys, ...font, ...T.xs }}>What number does {member.name?.split(' ')[0] || 'this teammate'} use on WhatsApp?</p>
          <div className="flex items-center gap-2">
            <div className="inline-flex items-center gap-2 px-3 rounded-lg flex-1" style={{ background: V.field, height: 40 }}>
              <WhatsAppGlyph size={13} color={WA} />
              <span style={{ color: V.faint, ...font, ...nums, ...T.sm }}>+91</span>
              <input
                autoFocus value={val}
                onChange={(e) => setVal(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && digits(val).length >= 10) doEnable(val); }}
                placeholder="98765 43210"
                className="bg-transparent outline-none flex-1 min-w-0"
                style={{ color: V.ink, ...font, ...nums, ...T.sm }}
              />
            </div>
            <button onClick={() => setPhase('idle')} className="px-3 py-2 rounded-lg shrink-0" style={{ border: `1px solid ${V.line}`, color: V.sys, ...font, ...T.xs }}>Cancel</button>
            <button
              disabled={digits(val).length < 10}
              onClick={() => doEnable(val)}
              className="inline-flex items-center gap-1 px-3 py-2 rounded-lg font-medium shrink-0"
              style={{ background: 'rgba(37,211,102,0.16)', color: WA, opacity: digits(val).length < 10 ? 0.5 : 1, ...font, ...T.xs }}
            >
              Enable <ArrowRight size={13} />
            </button>
          </div>
          <p className="mt-1.5 leading-relaxed" style={{ color: V.faint, ...font, ...T.xs }}>We'll send them a short welcome so they know they can start sending.</p>
        </div>
      )}

      {/* inline number change (existing sender) */}
      {phase === 'edit' && onChangeNumber && (
        <NumberEditor initial={knownPhone} onSave={onChangeNumber} onCancel={() => setPhase('idle')} />
      )}
    </div>
  );
}

export function ManageTeam({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { show } = useSnackbar();
  const orgId = useOrgId();
  const { data: members = [] } = useOrgMembers(orgId);
  const { data: invites = [] } = usePendingInvites(orgId);
  const { data: senders = [] } = useTeam();

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<string>(INVITE_ROLES[0].value);
  const [result, setResult] = useState<{ link?: string; phone: string; mode: 'email' | 'wa'; name: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const emailProvided = email.trim().length > 0;
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const phoneOk = digits(phone).length >= 10;
  // Email is optional: with it, the full platform invite; without it, a WhatsApp-only
  // invite that self-activates the moment they first message Briklay.
  const canInvite = phoneOk && (!emailProvided || emailOk);

  // Linkage: a member is WhatsApp-eligible when a wa_registered_numbers row carries
  // their user_id. Legacy/phone-only rows (no user_id) are kept under "Other senders"
  // so nothing existing is lost; a name match just pre-fills the capture field.
  const senderForMember = (m: OrgMember) => senders.find((s) => s.user_id === m.id) ?? null;
  const suggestPhoneFor = (m: OrgMember) => local10(senders.find((s) => !s.user_id && norm(s.name) === norm(m.name))?.phone_number ?? '');
  const memberNames = new Set(members.map((m) => norm(m.name)));
  const otherSenders = senders.filter((s) => !s.user_id && !memberNames.has(norm(s.name)));

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['daybook_pending_invites'] });
    qc.invalidateQueries({ queryKey: ['wa_registered_numbers'] });
  };
  const resetForm = () => { setAdding(false); setName(''); setEmail(''); setPhone(''); setRole(INVITE_ROLES[0].value); setResult(null); };

  // Grant a member WhatsApp send-access: link/insert their number, then welcome
  // them via the approved `teammate_welcome` template (delivers outside Meta's 24h
  // window, unlike free-form text). Upsert by user_id OR matching phone so we never
  // collide with the UNIQUE(phone_number) constraint on a legacy row. The welcome
  // fires once per row — gated on the durable `welcomed_at` marker, NOT on whether
  // we just inserted — so an invited/legacy teammate (whose row already exists) is
  // greeted on their first enable, and re-enabling never re-sends.
  const sendWelcome = async (m: OrgMember, ph: string) => {
    const to = ph.length === 10 ? `91${ph}` : ph;
    const first = (m.name || '').trim().split(/\s+/)[0] || m.name || 'there';
    const { data, error } = await supabase.functions.invoke('send-template', {
      body: { templateKey: 'teammate_welcome', to, params: { name: first } },
    });
    if (error) {
      // Surface the function's error body (Meta message) when present.
      let msg = error.message;
      try {
        const ctx = (error as any).context;
        const parsed = ctx && typeof ctx.json === 'function' ? await ctx.json() : null;
        if (parsed?.error) msg = parsed.error;
      } catch { /* fall back to error.message */ }
      throw new Error(msg || 'Could not send the welcome message');
    }
    if (data && data.ok === false) throw new Error(data.error || 'Could not send the welcome message');
  };

  const enableMember = async (m: OrgMember, phoneInput: string) => {
    const ph = local10(phoneInput);
    if (ph.length < 10) throw new Error('Enter a 10-digit WhatsApp number');
    const stored = intlPhone(ph);   // canonical +91 form the webhook matches inbound against
    const existing = senders.find((s) => s.user_id === m.id) ?? senders.find((s) => local10(s.phone_number) === ph);

    // Resolve the row we're enabling + whether it has ever been welcomed.
    let rowId: string | undefined;
    let alreadyWelcomed = false;
    if (existing) {
      rowId = existing.id;
      alreadyWelcomed = !!existing.welcomed_at;
      // Also heal a legacy 10-digit row to the canonical form so inbound matches.
      const { error } = await supabase.from('wa_registered_numbers')
        .update({ is_active: true, user_id: m.id, phone_number: stored }).eq('id', existing.id);
      if (error) throw error;
    } else {
      const { data, error } = await supabase.from('wa_registered_numbers')
        .insert({ user_id: m.id, name: m.name, phone_number: stored, role: roleLabel(m.role), is_active: true })
        .select('id, welcomed_at').single();
      if (error) {
        if (!/duplicate|unique/i.test(error.message)) throw error;
        // dup race: another path inserted this number first — adopt that row.
        const { data: dup } = await supabase.from('wa_registered_numbers')
          .select('id, welcomed_at').eq('phone_number', stored).single();
        rowId = dup?.id;
        alreadyWelcomed = !!dup?.welcomed_at;
        if (rowId) await supabase.from('wa_registered_numbers').update({ is_active: true, user_id: m.id }).eq('id', rowId);
      } else {
        rowId = data?.id;
      }
    }

    // First-ever enable of this row → welcome once, then stamp so we never re-send.
    // sendWelcome throws on failure (surfaced as a toast); welcomed_at stays NULL
    // so a later retry still greets them.
    let didWelcome = false;
    if (!alreadyWelcomed) {
      await sendWelcome(m, ph);
      if (rowId) {
        await supabase.from('wa_registered_numbers')
          .update({ welcomed_at: new Date().toISOString() }).eq('id', rowId);
      }
      didWelcome = true;
    }
    await qc.invalidateQueries({ queryKey: ['wa_registered_numbers'] });
    return didWelcome; // true → a welcome was sent (drives the row's success label)
  };

  const disableMember = async (m: OrgMember) => {
    const row = senders.find((s) => s.user_id === m.id);
    if (!row) return;
    const { error } = await supabase.from('wa_registered_numbers').update({ is_active: false }).eq('id', row.id);
    if (error) throw error;
    await qc.invalidateQueries({ queryKey: ['wa_registered_numbers'] });
  };

  // Change an existing sender's WhatsApp number. Stores the canonical +91 form the
  // webhook matches inbound against. A no-op (same number) returns quietly; a clash
  // with another registered row surfaces a clear message instead of a raw constraint.
  //
  // The new number is a FRESH contact: clear welcomed_at + oriented_at so the welcome
  // re-sends on the next enable (otherwise the old number's "already welcomed" marker
  // suppresses it — the teammate on the new number would get nothing) and the inbound
  // webhook greets them on their first message.
  const changeNumber = async (id: string, phone: string) => {
    const stored = intlPhone(phone);
    const current = senders.find((s) => s.id === id);
    if (current && intlPhone(current.phone_number) === stored) return;   // unchanged
    if (senders.some((s) => s.id !== id && intlPhone(s.phone_number) === stored)) {
      throw new Error('That number is already registered to someone else.');
    }
    const { error } = await supabase.from('wa_registered_numbers')
      .update({ phone_number: stored, welcomed_at: null, oriented_at: null })
      .eq('id', id);
    if (error) {
      if (/duplicate|unique/i.test(error.message)) throw new Error('That number is already registered to someone else.');
      throw error;
    }
    await qc.invalidateQueries({ queryKey: ['wa_registered_numbers'] });
  };

  // Invite. With an email: the platform route (create_invite) + register their number
  // active so they can send the moment they join. Without an email: a WhatsApp-only
  // invite — wa_invite_number pre-registers the number INACTIVE ('invited'); it
  // self-activates the moment they first message Briklay (no proactive template, no
  // wait). One form, two kinds of access.
  const invite = useMutation({
    mutationFn: async () => {
      if (!phoneOk) throw new Error('Enter their WhatsApp number');
      const nm = name.trim();

      if (emailProvided) {
        if (!emailOk) throw new Error('Enter a valid email address');
        const { data: u } = await supabase.auth.getUser();
        const { data, error } = await supabase.rpc('create_invite', {
          p_org_id: orgId,
          p_email: email.trim().toLowerCase(),
          p_role: role,
          p_invited_by: u.user?.id,
        }).single();
        if (error) throw error;
        const row = data as { token: string; success: boolean; error: string | null };
        if (!row.success) throw new Error(row.error ?? 'Could not create the invite');
        // register the number for WhatsApp send-access; a duplicate number is harmless
        const { error: waErr } = await supabase.from('wa_registered_numbers')
          .insert({ name: nm || email.trim(), phone_number: intlPhone(phone), role: roleLabel(role), is_active: true });
        if (waErr && !/duplicate|unique/i.test(waErr.message)) throw waErr;
        return { link: inviteLinkFor(row.token), phone: digits(phone), mode: 'email' as const, name: nm };
      }

      // WhatsApp-only: pre-register the number as 'invited' (inactive). The inbound
      // webhook flips it active + welcomes them on their first message.
      const { error } = await supabase.rpc('wa_invite_number', {
        p_phone: intlPhone(phone), p_name: nm || null, p_role: roleLabel(role),
      });
      if (error) throw error;
      return { phone: digits(phone), mode: 'wa' as const, name: nm };
    },
    onSuccess: (r) => { setResult(r); refresh(); },
    onError: (e: any) => show(e.message || 'Could not send the invite', { type: 'error' }),
  });

  const revoke = useMutation({
    mutationFn: async (inviteId: string) => {
      const { error } = await supabase.from('org_invites').update({ status: 'revoked' }).eq('invite_id', inviteId);
      if (error) throw error;
    },
    onSuccess: () => { refresh(); show('Invite revoked'); },
    onError: (e: any) => show(e.message || 'Could not revoke', { type: 'error' }),
  });

  const toggle = useMutation({
    mutationFn: async ({ id, next }: { id: string; next: boolean }) => {
      const { error } = await supabase.from('wa_registered_numbers').update({ is_active: next }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wa_registered_numbers'] }),
    onError: (e: any) => show(e.message || 'Could not update access', { type: 'error' }),
  });

  const setLang = useMutation({
    mutationFn: async ({ id, lang }: { id: string; lang: string | null }) => {
      const { error } = await supabase.from('wa_registered_numbers').update({ preferred_language: lang }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wa_registered_numbers'] }),
    onError: (e: any) => show(e.message || 'Could not set voice language', { type: 'error' }),
  });

  const copyLink = (link: string) => {
    navigator.clipboard?.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); }).catch(() => { /* noop */ });
  };
  const waInviteUrl = (p: string, link: string) => `https://wa.me/91${p}?text=${encodeURIComponent(`You're invited to Briklay. Join here: ${link}`)}`;

  const labelCaps = { color: V.faint, letterSpacing: '0.08em', ...font, ...T.xs } as const;
  const eligibleCount = members.filter((m) => senderForMember(m)?.is_active).length;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" style={{ background: 'rgba(30,26,21,0.32)' }} onClick={onClose}>
      <div
        className="h-full overflow-y-auto db-fade"
        style={{ width: 'min(92%, 460px)', background: V.page, boxShadow: '-12px 0 32px rgba(30,26,21,0.18)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 px-5 py-4 flex items-center justify-between" style={{ background: V.page, borderBottom: `1px solid ${V.line}` }}>
          <div>
            <p style={{ color: V.ink, ...serif, fontSize: '1.3rem' }}>Your team</p>
            <p className="mt-0.5" style={{ color: V.faint, ...font, ...T.xs }}>People on Briklay, and who can send on WhatsApp</p>
          </div>
          <button onClick={onClose} aria-label="Close"><X size={18} style={{ color: V.faint }} /></button>
        </div>

        <div className="px-5 py-4">
          {/* invite */}
          {!adding && !result && (
            <button onClick={() => setAdding(true)} className="w-full inline-flex items-center justify-center gap-1.5 py-2.5 rounded-xl font-medium" style={{ background: terraGrad, color: '#fff', ...font, ...T.sm }}>
              <UserPlus size={15} /> Invite a teammate
            </button>
          )}

          {adding && !result && (
            <div className="rounded-xl p-3.5 space-y-2.5" style={{ background: V.surface, border: '1px solid #E3DDD4' }}>
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (optional)" className="w-full px-3 py-2 rounded-lg outline-none" style={{ background: V.field, color: V.ink, ...font, ...T.sm }} />
              <div className="inline-flex items-center gap-2 px-3 rounded-lg w-full" style={{ background: V.field, height: 40 }}>
                <Mail size={14} style={{ color: V.faint }} />
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email address (optional)" className="bg-transparent outline-none flex-1" style={{ color: V.ink, ...font, ...T.sm }} />
              </div>
              <div className="inline-flex items-center gap-2 px-3 rounded-lg w-full" style={{ background: V.field, height: 40 }}>
                <WhatsAppGlyph size={13} color={WA} />
                <span style={{ color: V.faint, ...font, ...nums, ...T.sm }}>+91</span>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98765 43210" className="bg-transparent outline-none flex-1" style={{ color: V.ink, ...font, ...nums, ...T.sm }} />
              </div>
              <select value={role} onChange={(e) => setRole(e.target.value)} className="w-full px-3 py-2 rounded-lg outline-none" style={{ background: V.field, color: V.ink, ...font, ...T.sm }}>
                {INVITE_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
              <p style={{ color: V.faint, ...font, ...T.xs }}>
                {emailProvided
                  ? 'They get a join link, and their number can send to Briklay on WhatsApp.'
                  : 'WhatsApp-only — no email needed. They go live the moment they send their first message to Briklay.'}
              </p>
              <div className="flex gap-2 pt-1">
                <button onClick={resetForm} className="flex-1 py-2 rounded-lg" style={{ border: `1px solid ${V.line}`, color: V.sys, ...font, ...T.sm }}>Cancel</button>
                <button disabled={!canInvite || invite.isPending} onClick={() => invite.mutate()} className="flex-1 py-2 rounded-lg font-medium" style={{ background: terraGrad, color: '#fff', opacity: canInvite ? 1 : 0.5, ...font, ...T.sm }}>
                  {invite.isPending ? 'Inviting…' : emailProvided ? 'Send invite' : 'Add to WhatsApp'}
                </button>
              </div>
            </div>
          )}

          {result && result.mode === 'email' && (
            <div className="rounded-xl p-3.5 db-drop" style={{ background: V.surface, border: '1px solid #E3DDD4' }}>
              <p className="inline-flex items-center gap-1.5 font-medium" style={{ color: V.ink, ...font, ...T.sm }}>
                <span className="w-5 h-5 rounded-full inline-flex items-center justify-center db-pop" style={{ background: V.sageWash }}><Check size={12} color={V.sage} strokeWidth={3} /></span>
                Invite ready
              </p>
              <p className="mt-1.5 leading-relaxed" style={{ color: V.sys, ...font, ...T.xs }}>Share this link so they can join. Their WhatsApp number can already send to Briklay.</p>
              <button onClick={() => result.link && copyLink(result.link)} className="mt-3 w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg" style={{ background: V.field, color: V.inkSoft, ...font, ...T.xs }}>
                <span className="truncate">{result.link}</span>
                {copied ? <Check size={14} style={{ color: V.sage, flexShrink: 0 }} /> : <Copy size={13} style={{ color: V.faint, flexShrink: 0 }} />}
              </button>
              <div className="flex gap-2 mt-2.5">
                <a href={waInviteUrl(result.phone, result.link!)} target="_blank" rel="noopener noreferrer" className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 rounded-lg font-medium" style={{ background: 'rgba(37,211,102,0.16)', color: WA, ...font, ...T.sm }}>
                  <WhatsAppGlyph size={14} color={WA} /> Send on WhatsApp
                </a>
                <button onClick={resetForm} className="px-4 py-2 rounded-lg" style={{ border: `1px solid ${V.line}`, color: V.sys, ...font, ...T.sm }}>Done</button>
              </div>
            </div>
          )}

          {result && result.mode === 'wa' && (
            <div className="rounded-xl p-3.5 db-drop" style={{ background: V.surface, border: '1px solid #E3DDD4' }}>
              <p className="inline-flex items-center gap-1.5 font-medium" style={{ color: V.ink, ...font, ...T.sm }}>
                <span className="w-5 h-5 rounded-full inline-flex items-center justify-center db-pop" style={{ background: V.sageWash }}><Check size={12} color={V.sage} strokeWidth={3} /></span>
                Added to WhatsApp
              </p>
              <p className="mt-1.5 leading-relaxed" style={{ color: V.sys, ...font, ...T.xs }}>
                <span style={{ ...nums }}>+91 {prettyPhone(result.phone)}</span>{result.name ? ` · ${result.name}` : ''} goes live the moment they send their first WhatsApp message to Briklay — Briklay greets them automatically. Share “Start on WhatsApp” so they can say hello.
              </p>
              <div className="flex gap-2 mt-2.5">
                <button onClick={resetForm} className="flex-1 py-2 rounded-lg font-medium" style={{ background: terraGrad, color: '#fff', ...font, ...T.sm }}>Done</button>
              </div>
            </div>
          )}

          {/* pending invites */}
          {invites.length > 0 && (
            <div className="mt-5">
              <p className="uppercase font-medium mb-2" style={labelCaps}>Pending invites</p>
              <div className="space-y-2">
                {invites.map((inv) => (
                  <div key={inv.invite_id} className="rounded-xl p-3 flex items-center gap-3" style={{ background: V.surface, border: '1px solid #E3DDD4' }}>
                    <span className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: V.field }}><Clock size={14} style={{ color: V.faint }} /></span>
                    <div className="flex-1 min-w-0">
                      <p className="truncate" style={{ color: V.ink, ...font, ...T.sm }}>{inv.email}</p>
                      <p className="truncate mt-0.5" style={{ color: V.faint, ...font, ...T.xs }}>{roleLabel(inv.role)} · expires in {daysLeft(inv.expires_at)}d</p>
                    </div>
                    <button onClick={() => copyLink(inviteLinkFor(inv.token))} aria-label="Copy invite link" className="p-1.5 rounded-lg shrink-0" style={{ color: V.faint }}><Copy size={14} /></button>
                    <button onClick={() => revoke.mutate(inv.invite_id)} aria-label="Revoke invite" className="p-1.5 rounded-lg shrink-0" style={{ color: V.faint }}><X size={14} /></button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* members — each with WhatsApp send-eligibility inline */}
          <div className="mt-6">
            <div className="flex items-baseline justify-between mb-2">
              <p className="uppercase font-medium inline-flex items-center gap-1.5" style={labelCaps}><WhatsAppGlyph size={11} color={WA} /> Who can send on WhatsApp</p>
              {members.length > 0 && <p style={{ color: V.faint, ...font, ...nums, ...T.xs }}>{eligibleCount}/{members.length} on</p>}
            </div>
            {members.length === 0 ? (
              <p className="py-6 text-center" style={{ color: V.faint, ...font, ...T.sm }}>No one yet. Invite the people who handle money on site.</p>
            ) : (
              <div className="space-y-2">
                {members.map((m) => (
                  <WaMemberRow
                    key={m.id}
                    member={m}
                    sender={senderForMember(m)}
                    suggestPhone={suggestPhoneFor(m)}
                    onEnable={(ph) => enableMember(m, ph)}
                    onDisable={() => disableMember(m)}
                    onLang={(lang) => { const row = senderForMember(m); if (row) setLang.mutate({ id: row.id, lang }); }}
                    onChangeNumber={senderForMember(m) ? (ph) => changeNumber(senderForMember(m)!.id, ph) : undefined}
                  />
                ))}
              </div>
            )}
            <p className="mt-2.5 leading-relaxed" style={{ color: V.faint, ...font, ...T.xs }}>
              Turning someone on lets their WhatsApp number send to Briklay, and sends them a one-time welcome. Turn it off when they leave the site — their history stays.
            </p>
          </div>

          {/* legacy / phone-only senders not tied to a member — preserved, never lost */}
          {otherSenders.length > 0 && (
            <div className="mt-6">
              <p className="uppercase font-medium mb-2" style={labelCaps}>Other site senders</p>
              <div className="space-y-2">
                {otherSenders.map((m) => (
                  <OtherSenderRow
                    key={m.id}
                    contact={m}
                    onToggle={() => toggle.mutate({ id: m.id, next: !m.is_active })}
                    onLang={(lang) => setLang.mutate({ id: m.id, lang })}
                    onChangeNumber={(ph) => changeNumber(m.id, ph)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── The banner ──────────────────────────────────────────────────────────────────
export function Invitation({ canManage }: { canManage: boolean }) {
  const { data: team = [] } = useTeam();
  const [manage, setManage] = useState(false);
  const [startWa, setStartWa] = useState(false);

  const activeCount = team.filter((t) => t.is_active).length;

  if (!canManage) return null;

  // shared overlays — the QR / click-to-chat surface and the manage-team slide-over
  const overlays = (
    <>
      {manage && <ManageTeam onClose={() => setManage(false)} />}
      {startWa && (
        <StartOnWhatsApp
          onClose={() => setStartWa(false)}
          onManageTeam={() => { setStartWa(false); setManage(true); }}
        />
      )}
    </>
  );

  // collapsed: once the org has active contacts, the top banner is a slim reminder
  if (activeCount > 0) {
    const onlyYou = activeCount === 1;
    return (
      <>
        {overlays}
        <div style={{ background: N.bg }}>
          <div className="mx-auto py-3 flex items-center gap-x-3 gap-y-1.5 flex-wrap" style={{ width: '92%', maxWidth: 1100 }}>
            <span className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'rgba(37,211,102,0.14)' }}>
              <WhatsAppGlyph size={15} color={WA} />
            </span>
            <p className="flex-1 min-w-0" style={{ color: N.text, ...font, ...T.sm }}>
              {onlyYou
                ? 'Currently you can send messages to Briklay from WhatsApp. You can also '
                : `${activeCount} people on site can message Briklay. `}
              <button
                onClick={() => setManage(true)}
                className="whitespace-nowrap underline underline-offset-2"
                style={{ color: N.textSoft, ...font, ...T.sm, textDecorationColor: N.keyline }}
              >
                {onlyYou ? 'add your team' : 'manage team'}
              </button>
            </p>
            <button
              onClick={() => setStartWa(true)}
              className="inline-flex items-center gap-1.5 font-medium py-1.5 px-3.5 rounded-lg whitespace-nowrap shrink-0 transition-colors"
              style={{ background: 'rgba(37,211,102,0.16)', color: WA, ...font, ...T.xs }}
            >
              <WhatsAppGlyph size={13} color={WA} /> Start on WhatsApp
            </button>
          </div>
        </div>
      </>
    );
  }

  // first run: no one can send yet — the hero invitation
  return (
    <>
      {overlays}
      <div className="relative overflow-hidden" style={{ background: N.bg }}>
        <div aria-hidden className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(420px circle at 88% 0%, rgba(37,211,102,0.10), transparent 60%)' }} />
        <div className="mx-auto py-5 relative" style={{ width: '92%', maxWidth: 1100 }}>
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'rgba(37,211,102,0.14)' }}>
              <WhatsAppGlyph size={20} color={WA} />
            </span>
            <div className="flex-1 min-w-0 flex items-center justify-between flex-wrap gap-x-5 gap-y-3">
              <div className="min-w-0" style={{ flexBasis: '60%', flexGrow: 1 }}>
                <p className="font-medium" style={{ color: N.text, ...font, ...T.sm }}>Bring your site onto WhatsApp</p>
                <p className="mt-1 leading-relaxed" style={{ color: N.textSoft, ...font, ...T.xs }}>
                  Scan the code to message Briklay — payments, bills, and photos, nothing to install.
                  {' '}
                  <button onClick={() => setManage(true)} className="whitespace-nowrap underline underline-offset-2" style={{ color: N.textSoft, textDecorationColor: N.keyline }}>
                    manage who can send
                  </button>.
                </p>
              </div>
              <button
                onClick={() => setStartWa(true)}
                className="inline-flex items-center justify-center gap-1.5 font-medium py-2 px-4 rounded-lg whitespace-nowrap shrink-0"
                style={{ background: 'rgba(37,211,102,0.16)', color: WA, ...font, ...T.sm }}
              >
                <WhatsAppGlyph size={15} color={WA} /> Start on WhatsApp
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
