/**
 * Team & Access — the redesigned team page.
 *
 * One elegant home for who's on Briklay and who can send on WhatsApp, built in the
 * Day Book design language (tokens V/N/WA, serif headings, terra accents, the WA
 * green channel signature). Consolidates what used to be split across the old
 * /team page and the Day Book "Manage team" slide-over:
 *   • invite a teammate (email = platform login; phone = WhatsApp-only, self-activating)
 *   • each member's role, WhatsApp number (add / change inline), send-eligibility,
 *     voice-note language, and project assignments
 *   • pending invites, and legacy phone-only "other senders"
 *
 * Visual lineage: the dark N hero echoes the landing bands + Day Book invitation
 * banner; cards use the db-card lift; grant-access uses the db-glow / db-ring micro
 * motion. Consistent with the landing, transcript and Day Book surfaces.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import {
  UserPlus, Mail, Phone, Copy, Check, Clock, X, Loader2, ArrowRight, Pencil, Trash2, ShieldCheck,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useSnackbar } from '../Snackbar';
import { useOrgId } from '../../lib/auth/AuthProvider';
import { useUserProfile } from '../../App';
import type { UserRole } from '../../types';
import { V, N, WA, font, serif, nums, terraGrad, T } from '../day-book/tokens';
import { ANIM } from '../day-book/motion';
import { WhatsAppGlyph } from '../day-book/atoms';

// ── small helpers (shared lineage with the Day Book Invitation) ─────────────────
const digits = (s: string) => (s || '').replace(/\D/g, '');
const local10 = (s: string) => digits(s).slice(-10);
const intlPhone = (s: string) => '91' + local10(s);
const prettyPhone = (p: string) => { const d = local10(p); return d.length === 10 ? `${d.slice(0, 5)} ${d.slice(5)}` : d; };
const initials = (name: string) => (name || '?').split(' ').filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?';
const roleLabel = (r: string) => (r ? r.charAt(0).toUpperCase() + r.slice(1) : '');
const inviteLinkFor = (token: string) => `${window.location.origin}/invite/${token}`;
const daysLeft = (iso: string) => Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));
const norm = (s: string) => (s || '').trim().toLowerCase();

const INVITE_ROLES = [
  { value: 'supervisor', label: 'Supervisor' },
  { value: 'accountant', label: 'Accountant' },
  { value: 'management', label: 'Management' },
] as const;

const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: 'supervisor', label: 'Supervisor' },
  { value: 'accountant', label: 'Accountant' },
  { value: 'management', label: 'Management' },
  { value: 'principal', label: 'Principal' },
];

const VOICE_LANGS = [
  { value: '', label: 'Auto' },
  { value: 'te', label: 'Telugu' },
  { value: 'hi', label: 'Hindi' },
  { value: 'en', label: 'English' },
] as const;

interface WaContact {
  id: string;
  phone_number: string;
  name: string;
  role: string;
  is_active: boolean;
  preferred_language: string | null;
  user_id: string | null;
  welcomed_at: string | null;
  created_at: string;
}
interface Member { id: string; name: string; role: UserRole; assigned_projects: string[] }
interface PendingInvite { invite_id: string; email: string; role: string; token: string; expires_at: string }

// ── atoms ───────────────────────────────────────────────────────────────────────

/** The green pill send-toggle (Day Book signature). */
function WaToggle({ on, busy, onClick }: { on: boolean; busy?: boolean; onClick: () => void }) {
  return (
    <button
      aria-label="Toggle WhatsApp access" disabled={busy} onClick={onClick}
      className="w-9 h-5 rounded-full relative shrink-0"
      style={{ background: on ? WA : V.line, transition: 'background .18s ease', opacity: busy ? 0.6 : 1 }}
    >
      <span className="absolute top-0.5 w-4 h-4 rounded-full flex items-center justify-center"
        style={{ background: '#fff', left: on ? 18 : 2, transition: 'left .18s cubic-bezier(.3,.8,.3,1.2)', boxShadow: '0 1px 2px rgba(0,0,0,0.18)' }}>
        {busy && <Loader2 size={9} className="db-spin" style={{ color: WA }} />}
      </span>
    </button>
  );
}

function VoiceLangSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select
      aria-label="Voice note language" title="Language for this person's voice notes"
      value={value} onChange={(e) => onChange(e.target.value)}
      className="px-2 rounded-lg outline-none shrink-0 appearance-none"
      style={{ background: V.field, color: value ? V.ink : V.faint, height: 30, ...font, ...T.xs }}
    >
      {VOICE_LANGS.map((l) => <option key={l.value} value={l.value}>{l.value ? `🎙 ${l.label}` : 'Auto'}</option>)}
    </select>
  );
}

/** Inline number add / change. onSave gets the digits; stores canonical +91. */
function NumberEditor({ initial, label, cta, onSave, onCancel }: {
  initial: string; label: string; cta: string;
  onSave: (phone: string) => Promise<void>; onCancel: () => void;
}) {
  const { show } = useSnackbar();
  const [val, setVal] = useState(local10(initial));
  const [saving, setSaving] = useState(false);
  const ok = digits(val).length >= 10;
  const save = async () => {
    if (!ok) { show('Enter a 10-digit WhatsApp number', { type: 'error' }); return; }
    setSaving(true);
    try { await onSave(digits(val)); onCancel(); }
    catch (e: any) { show(e?.message || 'Could not save the number', { type: 'error' }); setSaving(false); }
  };
  return (
    <div className="mt-3 db-drop">
      <p className="mb-1.5" style={{ color: V.sys, ...font, ...T.xs }}>{label}</p>
      <div className="flex items-center gap-2">
        <div className="inline-flex items-center gap-2 px-3 rounded-lg flex-1" style={{ background: V.field, height: 40 }}>
          <WhatsAppGlyph size={13} color={WA} />
          <span style={{ color: V.faint, ...font, ...nums, ...T.sm }}>+91</span>
          <input autoFocus value={val} onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && ok) save(); }}
            placeholder="98765 43210" className="bg-transparent outline-none flex-1 min-w-0"
            style={{ color: V.ink, ...font, ...nums, ...T.sm }} />
        </div>
        <button onClick={onCancel} className="px-3 py-2 rounded-lg shrink-0" style={{ border: `1px solid ${V.line}`, color: V.sys, ...font, ...T.xs }}>Cancel</button>
        <button disabled={!ok || saving} onClick={save}
          className="inline-flex items-center gap-1 px-3 py-2 rounded-lg font-medium shrink-0"
          style={{ background: 'rgba(37,211,102,0.16)', color: WA, opacity: ok && !saving ? 1 : 0.5, ...font, ...T.xs }}>
          {saving ? <Loader2 size={13} className="db-spin" /> : <>{cta} <ArrowRight size={13} /></>}
        </button>
      </div>
    </div>
  );
}

// ── member card ─────────────────────────────────────────────────────────────────

function MemberCard({
  member, sender, suggestPhone, projects,
  onEnable, onDisable, onChangeNumber, onLang, onRole, onRename, onDelete, onToggleProject,
}: {
  member: Member;
  sender: WaContact | null;
  suggestPhone: string;
  projects: { project_id: string; name: string }[];
  onEnable: (phone: string) => Promise<boolean>;
  onDisable: () => Promise<void>;
  onChangeNumber: (phone: string) => Promise<void>;
  onLang: (lang: string | null) => void;
  onRole: (role: UserRole) => void;
  onRename: (name: string) => Promise<void>;
  onDelete: () => void;
  onToggleProject: (projectId: string) => void;
}) {
  const { show } = useSnackbar();
  const active = !!sender?.is_active;
  const knownPhone = local10(sender?.phone_number ?? suggestPhone ?? '');
  type Phase = 'idle' | 'capture' | 'edit' | 'saving' | 'sent';
  const [phase, setPhase] = useState<Phase>('idle');
  const [welcomed, setWelcomed] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameVal, setNameVal] = useState(member.name);
  const [showProjects, setShowProjects] = useState(false);

  const doEnable = async (phone: string) => {
    const ph = digits(phone);
    if (ph.length < 10) { show('Enter a 10-digit WhatsApp number', { type: 'error' }); return; }
    setPhase('saving');
    try {
      const didWelcome = await onEnable(ph);
      setWelcomed(didWelcome); setPhase('sent');
      setTimeout(() => setPhase('idle'), 1900);
    } catch (e: any) { show(e?.message || 'Could not enable WhatsApp', { type: 'error' }); setPhase('idle'); }
  };

  const onToggle = async () => {
    if (active) {
      setPhase('saving');
      try { await onDisable(); } catch (e: any) { show(e?.message || 'Could not update', { type: 'error' }); }
      setPhase('idle'); return;
    }
    if (knownPhone.length >= 10) { doEnable(knownPhone); return; }
    setPhase('capture');
  };

  const saveName = async () => {
    const n = nameVal.trim();
    if (!n || n === member.name) { setEditingName(false); return; }
    try { await onRename(n); } catch (e: any) { show(e?.message || 'Could not rename', { type: 'error' }); }
    setEditingName(false);
  };

  const showNumber = active || knownPhone.length >= 10;
  const assignedCount = member.assigned_projects?.length ?? 0;

  return (
    <div className={`rounded-2xl p-4 db-card ${phase === 'saving' ? 'db-glow' : ''}`}
      style={{ background: V.surface, transition: 'opacity .2s', opacity: active || phase !== 'idle' ? 1 : 0.97 }}>
      {/* top row: identity + role + delete */}
      <div className="flex items-center gap-3">
        <span className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 font-medium"
          style={{ background: V.terraWash, color: V.terraDeep, ...font, ...T.sm }}>{initials(member.name)}</span>

        <div className="flex-1 min-w-0">
          {editingName ? (
            <div className="flex items-center gap-2">
              <input autoFocus value={nameVal} onChange={(e) => setNameVal(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') setEditingName(false); }}
                className="px-2 py-1 rounded-lg outline-none flex-1 min-w-0"
                style={{ background: V.field, color: V.ink, ...font, ...T.sm }} />
              <button onClick={saveName} className="px-2.5 py-1 rounded-lg font-medium shrink-0" style={{ background: terraGrad, color: '#fff', ...font, ...T.xs }}>Save</button>
              <button onClick={() => { setEditingName(false); setNameVal(member.name); }} className="p-1 shrink-0" style={{ color: V.faint }}><X size={15} /></button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <p className="font-medium truncate" style={{ color: V.ink, ...font, ...T.sm }}>{member.name || 'Unnamed'}</p>
              <button onClick={() => { setNameVal(member.name); setEditingName(true); }} aria-label="Edit name" className="shrink-0" style={{ color: V.faint, opacity: 0.7 }}><Pencil size={12} /></button>
            </div>
          )}
          {!editingName && (
            phase === 'sent' ? (
              <p className="truncate mt-0.5 inline-flex items-center gap-1 db-drop" style={{ color: WA, ...font, ...T.xs }}>
                <WhatsAppGlyph size={10} color={WA} /> {welcomed ? 'Welcome sent' : 'Sending enabled'}
              </p>
            ) : showNumber ? (
              <p className="truncate mt-0.5 inline-flex items-center gap-1" style={{ color: V.sys, ...font, ...nums, ...T.xs }}>
                <Phone size={10} style={{ color: V.faint }} /> +91 {prettyPhone(knownPhone)}
                {sender && phase === 'idle' && (
                  <button onClick={() => setPhase('edit')} aria-label="Change number" className="ml-1 shrink-0" style={{ color: V.faint }}><Pencil size={11} /></button>
                )}
              </p>
            ) : (
              <p className="truncate mt-0.5" style={{ color: V.faint, ...font, ...T.xs }}>No WhatsApp number yet</p>
            )
          )}
        </div>

        {/* role selector */}
        <div className="relative shrink-0">
          <select value={member.role}
            onChange={(e) => onRole(e.target.value as UserRole)}
            className="appearance-none pl-2.5 pr-6 rounded-lg outline-none cursor-pointer font-medium"
            style={{ background: V.field, color: V.inkSoft, height: 30, ...font, ...T.xs }}>
            {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>
        <button onClick={onDelete} aria-label="Remove member" className="p-1.5 rounded-lg shrink-0" style={{ color: V.faint }}><Trash2 size={15} /></button>
      </div>

      {/* WhatsApp row */}
      <div className="mt-3 flex items-center gap-2.5 rounded-xl px-3 py-2.5" style={{ background: active ? 'rgba(37,211,102,0.06)' : V.field }}>
        <WhatsAppGlyph size={15} color={active ? WA : V.faint} />
        <p className="flex-1 min-w-0 truncate" style={{ color: active ? V.inkSoft : V.sys, ...font, ...T.xs }}>
          {active ? 'Can send to Briklay on WhatsApp' : showNumber ? 'WhatsApp off — turn on to let them send' : 'Add a number to enable WhatsApp'}
        </p>
        {active && phase !== 'capture' && phase !== 'edit' && (
          <VoiceLangSelect value={sender?.preferred_language ?? ''} onChange={(v) => onLang(v || null)} />
        )}
        {phase === 'sent' ? (
          <span className="w-7 h-7 rounded-full inline-flex items-center justify-center shrink-0 db-ring" style={{ background: 'rgba(37,211,102,0.16)' }}>
            <Check size={14} color={WA} strokeWidth={3} />
          </span>
        ) : (
          <WaToggle on={active} busy={phase === 'saving'} onClick={onToggle} />
        )}
      </div>

      {phase === 'capture' && (
        <NumberEditor initial="" cta="Enable"
          label={`What number does ${member.name?.split(' ')[0] || 'this teammate'} use on WhatsApp?`}
          onSave={(ph) => doEnable(ph)} onCancel={() => setPhase('idle')} />
      )}
      {phase === 'edit' && (
        <NumberEditor initial={knownPhone} cta="Save" label="Change WhatsApp number"
          onSave={onChangeNumber} onCancel={() => setPhase('idle')} />
      )}

      {/* project assignment (supervisors) */}
      {member.role === 'supervisor' && projects.length > 0 && (
        <div className="mt-3">
          <button onClick={() => setShowProjects((s) => !s)} className="inline-flex items-center gap-1.5" style={{ color: V.sys, ...font, ...T.xs }}>
            <span className="uppercase font-medium" style={{ letterSpacing: '0.06em' }}>Site access</span>
            <span style={{ color: V.faint }}>· {assignedCount === 0 ? 'none' : `${assignedCount} site${assignedCount > 1 ? 's' : ''}`}</span>
            <span style={{ color: V.faint }}>{showProjects ? '▾' : '▸'}</span>
          </button>
          {showProjects && (
            <div className="flex flex-wrap gap-1.5 mt-2 db-drop">
              {projects.map((p) => {
                const on = member.assigned_projects?.includes(p.project_id);
                return (
                  <button key={p.project_id} onClick={() => onToggleProject(p.project_id)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full"
                    style={on
                      ? { background: V.sageWash, color: V.sage, border: `1px solid ${V.sage}33`, ...font, ...T.xs }
                      : { background: V.field, color: V.sys, ...font, ...T.xs }}>
                    {on ? <Check size={11} /> : <span style={{ opacity: 0.5 }}>+</span>}{p.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── legacy / phone-only sender ────────────────────────────────────────────────
function OtherSenderRow({ contact, onToggle, onLang, onChangeNumber }: {
  contact: WaContact; onToggle: () => void; onLang: (lang: string | null) => void; onChangeNumber: (phone: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="rounded-xl p-3 db-card" style={{ background: V.surface, opacity: contact.is_active ? 1 : 0.6 }}>
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="font-medium truncate" style={{ color: V.ink, ...font, ...T.sm }}>{contact.name || 'Site contact'}</p>
          <p className="truncate mt-0.5 inline-flex items-center gap-1" style={{ color: V.sys, ...font, ...nums, ...T.xs }}>
            <Phone size={10} style={{ color: V.faint }} /> +91 {prettyPhone(contact.phone_number)}
            {!editing && <button onClick={() => setEditing(true)} aria-label="Change number" className="ml-1 shrink-0" style={{ color: V.faint }}><Pencil size={11} /></button>}
          </p>
        </div>
        {!editing && <VoiceLangSelect value={contact.preferred_language ?? ''} onChange={(v) => onLang(v || null)} />}
        {!editing && <WaToggle on={contact.is_active} onClick={onToggle} />}
      </div>
      {editing && <NumberEditor initial={contact.phone_number} cta="Save" label="Change WhatsApp number" onSave={onChangeNumber} onCancel={() => setEditing(false)} />}
    </div>
  );
}

const labelCaps = { color: V.faint, letterSpacing: '0.09em', ...font, ...T.xs } as const;

// ── page ──────────────────────────────────────────────────────────────────────

export default function TeamAccess({ session }: { session: Session }) {
  const qc = useQueryClient();
  const { show } = useSnackbar();
  const orgId = useOrgId();
  const { data: profile } = useUserProfile(session.user.id);
  const isAdmin = profile?.role === 'management' || profile?.role === 'principal';

  // invite form
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
  const canInvite = phoneOk && (!emailProvided || emailOk);

  // ── data ──────────────────────────────────────────────────────────────────
  const { data: members = [], isLoading: membersLoading } = useQuery({
    queryKey: ['team_members', orgId],
    enabled: isAdmin && !!orgId,
    queryFn: async () => {
      const { data: rows, error } = await supabase
        .from('org_memberships').select('role, status, user_id, joined_at')
        .eq('org_id', orgId).eq('status', 'active').order('joined_at', { ascending: false });
      if (error) throw error;
      const ids = (rows ?? []).map((r: any) => r.user_id).filter(Boolean);
      if (!ids.length) return [] as Member[];
      const { data: profiles, error: pErr } = await supabase
        .from('user_profiles').select('id, name, role, assigned_projects').in('id', ids);
      if (pErr) throw pErr;
      const pById = new Map((profiles ?? []).map((p: any) => [p.id, p]));
      return (rows ?? []).filter((r: any) => pById.has(r.user_id)).map((r: any) => {
        const p = pById.get(r.user_id);
        // Display + edit the SAME column (user_profiles.role) so a role change reflects
        // immediately; fall back to the membership role if a profile role isn't set.
        return { id: r.user_id, name: p.name ?? 'Unnamed', role: (p.role ?? r.role) as UserRole, assigned_projects: (p.assigned_projects ?? []) as string[] } satisfies Member;
      });
    },
  });

  const { data: senders = [] } = useQuery({
    queryKey: ['wa_registered_numbers'],
    queryFn: async () => {
      const { data, error } = await supabase.from('wa_registered_numbers').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as WaContact[];
    },
  });

  const { data: invites = [] } = useQuery({
    queryKey: ['team_pending_invites', orgId],
    enabled: isAdmin && !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase.from('org_invites')
        .select('invite_id, email, role, token, expires_at').eq('org_id', orgId).eq('status', 'pending')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as PendingInvite[];
    },
  });

  const { data: projects = [] } = useQuery({
    queryKey: ['team_projects'],
    enabled: isAdmin,
    queryFn: async () => {
      const { data, error } = await supabase.from('projects').select('project_id, name');
      if (error) throw error;
      return (data ?? []) as { project_id: string; name: string }[];
    },
  });

  // ── derived ─────────────────────────────────────────────────────────────────
  const senderForMember = (m: Member) => senders.find((s) => s.user_id === m.id) ?? null;
  const suggestPhoneFor = (m: Member) => local10(senders.find((s) => !s.user_id && norm(s.name) === norm(m.name))?.phone_number ?? '');
  const memberNames = new Set(members.map((m) => norm(m.name)));
  const otherSenders = senders.filter((s) => !s.user_id && !memberNames.has(norm(s.name)));
  const principalCount = members.filter((m) => m.role === 'principal').length;
  const eligibleCount = members.filter((m) => senderForMember(m)?.is_active).length;

  const refreshWa = () => qc.invalidateQueries({ queryKey: ['wa_registered_numbers'] });
  const refreshMembers = () => qc.invalidateQueries({ queryKey: ['team_members'] });

  // ── WhatsApp actions (ported from the Day Book manage-team) ──────────────────
  const sendWelcome = async (firstName: string, ph: string) => {
    const to = ph.length === 10 ? `91${ph}` : ph;
    const first = (firstName || '').trim().split(/\s+/)[0] || firstName || 'there';
    const { data, error } = await supabase.functions.invoke('send-template', {
      body: { templateKey: 'teammate_welcome', to, params: { name: first } },
    });
    if (error) {
      let msg = error.message;
      try { const ctx = (error as any).context; const parsed = ctx?.json ? await ctx.json() : null; if (parsed?.error) msg = parsed.error; } catch { /* noop */ }
      throw new Error(msg || 'Could not send the welcome message');
    }
    if (data && data.ok === false) throw new Error(data.error || 'Could not send the welcome message');
  };

  const enableMember = async (m: Member, phoneInput: string): Promise<boolean> => {
    const ph = local10(phoneInput);
    if (ph.length < 10) throw new Error('Enter a 10-digit WhatsApp number');
    const stored = intlPhone(ph);
    const existing = senders.find((s) => s.user_id === m.id) ?? senders.find((s) => local10(s.phone_number) === ph);
    let rowId: string | undefined;
    let alreadyWelcomed = false;
    if (existing) {
      const { data: upd, error } = await supabase.from('wa_registered_numbers')
        .update({ is_active: true, user_id: m.id, phone_number: stored }).eq('id', existing.id).select('id, welcomed_at').single();
      if (error) throw error;
      rowId = (upd as any)?.id; alreadyWelcomed = !!(upd as any)?.welcomed_at;
    } else {
      const { data, error } = await supabase.from('wa_registered_numbers')
        .insert({ user_id: m.id, name: m.name, phone_number: stored, role: roleLabel(m.role), is_active: true })
        .select('id, welcomed_at').single();
      if (error) {
        if (!/duplicate|unique/i.test(error.message)) throw error;
        const { data: dup } = await supabase.from('wa_registered_numbers').select('id, welcomed_at').eq('phone_number', stored).single();
        rowId = (dup as any)?.id; alreadyWelcomed = !!(dup as any)?.welcomed_at;
        if (rowId) await supabase.from('wa_registered_numbers').update({ is_active: true, user_id: m.id }).eq('id', rowId);
      } else { rowId = (data as any)?.id; }
    }
    let didWelcome = false;
    if (!alreadyWelcomed) {
      await sendWelcome(m.name, ph);
      if (rowId) await supabase.from('wa_registered_numbers').update({ welcomed_at: new Date().toISOString() }).eq('id', rowId);
      didWelcome = true;
    }
    await refreshWa();
    return didWelcome;
  };

  const disableMember = async (m: Member) => {
    const row = senders.find((s) => s.user_id === m.id);
    if (!row) return;
    const { error } = await supabase.from('wa_registered_numbers').update({ is_active: false }).eq('id', row.id);
    if (error) throw error;
    await refreshWa();
  };

  const changeNumber = async (id: string, phoneInput: string) => {
    const stored = intlPhone(phoneInput);
    const current = senders.find((s) => s.id === id);
    if (current && intlPhone(current.phone_number) === stored) return;
    if (senders.some((s) => s.id !== id && intlPhone(s.phone_number) === stored)) throw new Error('That number is already registered to someone else.');
    const { error } = await supabase.from('wa_registered_numbers')
      .update({ phone_number: stored, welcomed_at: null, oriented_at: null }).eq('id', id);
    if (error) { if (/duplicate|unique/i.test(error.message)) throw new Error('That number is already registered to someone else.'); throw error; }
    await refreshWa();
  };

  const setLang = useMutation({
    mutationFn: async ({ id, lang }: { id: string; lang: string | null }) => {
      const { error } = await supabase.from('wa_registered_numbers').update({ preferred_language: lang }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: refreshWa,
    onError: (e: any) => show(e.message || 'Could not set voice language', { type: 'error' }),
  });

  const toggleOther = useMutation({
    mutationFn: async ({ id, next }: { id: string; next: boolean }) => {
      const { error } = await supabase.from('wa_registered_numbers').update({ is_active: next }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: refreshWa,
    onError: (e: any) => show(e.message || 'Could not update access', { type: 'error' }),
  });

  // ── member admin actions ──────────────────────────────────────────────────
  const updateProfile = async (userId: string, updates: Record<string, unknown>) => {
    const { error } = await supabase.from('user_profiles').update(updates).eq('id', userId);
    if (error) throw error;
    await refreshMembers();
  };
  const changeRole = (m: Member, r: UserRole) => {
    if (r === m.role) return;
    if (r === 'principal' && members.some((x) => x.id !== m.id && x.role === 'principal')) {
      show('Only one Principal is allowed. Update the existing Principal first.', { type: 'error' }); refreshMembers(); return;
    }
    if (m.role === 'principal' && r !== 'principal' && principalCount <= 1) {
      show('Assign another Principal before changing this one.', { type: 'error' }); refreshMembers(); return;
    }
    updateProfile(m.id, { role: r }).then(() => show('Role updated')).catch((e) => show(e.message || 'Could not change role', { type: 'error' }));
  };
  const rename = (m: Member, n: string) => updateProfile(m.id, { name: n });
  const toggleProject = (m: Member, projectId: string) => {
    const cur = m.assigned_projects ?? [];
    const next = cur.includes(projectId) ? cur.filter((id) => id !== projectId) : [...cur, projectId];
    updateProfile(m.id, { assigned_projects: next }).catch((e) => show(e.message || 'Could not update sites', { type: 'error' }));
  };
  const removeMember = useMutation({
    mutationFn: async (userId: string) => { const { error } = await supabase.functions.invoke('admin-users', { body: { action: 'delete', userId } }); if (error) throw error; },
    onSuccess: () => { refreshMembers(); show('Member removed'); },
    onError: (e: any) => show(e.message || 'Could not remove member', { type: 'error' }),
  });

  // ── invite ─────────────────────────────────────────────────────────────────
  const resetForm = () => { setAdding(false); setName(''); setEmail(''); setPhone(''); setRole(INVITE_ROLES[0].value); setResult(null); };
  const refreshInvites = () => { qc.invalidateQueries({ queryKey: ['team_pending_invites'] }); refreshWa(); };

  const invite = useMutation({
    mutationFn: async () => {
      if (!phoneOk) throw new Error('Enter their WhatsApp number');
      const nm = name.trim();
      if (emailProvided) {
        if (!emailOk) throw new Error('Enter a valid email address');
        const { data, error } = await supabase.rpc('create_invite', {
          p_org_id: orgId, p_email: email.trim().toLowerCase(), p_role: role, p_invited_by: session.user.id,
        }).single();
        if (error) throw error;
        const row = data as { token: string; success: boolean; error: string | null };
        if (!row.success) throw new Error(row.error ?? 'Could not create the invite');
        const { error: waErr } = await supabase.from('wa_registered_numbers')
          .insert({ name: nm || email.trim(), phone_number: intlPhone(phone), role: roleLabel(role), is_active: true });
        if (waErr && !/duplicate|unique/i.test(waErr.message)) throw waErr;
        return { link: inviteLinkFor(row.token), phone: digits(phone), mode: 'email' as const, name: nm };
      }
      const { error } = await supabase.rpc('wa_invite_number', { p_phone: intlPhone(phone), p_name: nm || null, p_role: roleLabel(role) });
      if (error) throw error;
      return { phone: digits(phone), mode: 'wa' as const, name: nm };
    },
    onSuccess: (r) => { setResult(r); refreshInvites(); },
    onError: (e: any) => show(e.message || 'Could not send the invite', { type: 'error' }),
  });

  const revoke = useMutation({
    mutationFn: async (inviteId: string) => { const { error } = await supabase.from('org_invites').update({ status: 'revoked' }).eq('invite_id', inviteId); if (error) throw error; },
    onSuccess: () => { refreshInvites(); show('Invite revoked'); },
    onError: (e: any) => show(e.message || 'Could not revoke', { type: 'error' }),
  });

  const copyLink = (link: string) => { navigator.clipboard?.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); }).catch(() => { /* noop */ }); };

  // ── access gate ──────────────────────────────────────────────────────────
  if (!isAdmin) {
    return (
      <div className="db-scope" style={{ background: V.page, minHeight: '100%' }}>
        <div className="mx-auto px-5 py-16 text-center" style={{ maxWidth: 480 }}>
          <ShieldCheck size={28} style={{ color: V.faint }} className="mx-auto" />
          <p className="mt-3" style={{ color: V.ink, ...serif, fontSize: '1.25rem' }}>Team & Access</p>
          <p className="mt-1.5" style={{ color: V.sys, ...font, ...T.sm }}>Only Management and Principal can manage the team.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="db-scope" style={{ background: V.page, minHeight: '100%' }}>
      <style>{ANIM}{HERO_CSS}</style>
      <div className="mx-auto py-6 sm:py-8" style={{ width: '92%', maxWidth: 1100 }}>

        {/* ── Hero ─────────────────────────────────────────────────────────── */}
        <div className="relative overflow-hidden rounded-3xl px-6 py-7 db-fade" style={{ background: N.bg }}>
          <div aria-hidden className="team-glow" />
          <div className="relative">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full mb-3"
              style={{ background: N.field, border: `1px solid ${N.keyline}`, color: N.textSoft, ...font, ...T.xs }}>
              <WhatsAppGlyph size={11} color={WA} /> Team & Access
            </span>
            <h1 style={{ color: N.text, ...serif, fontSize: 'clamp(1.5rem,1.1rem+1.8vw,2rem)', lineHeight: 1.12 }}>
              Your people, and who<br />can send on WhatsApp
            </h1>
            <p className="mt-2 max-w-md" style={{ color: N.textSoft, ...font, ...T.sm }}>
              Invite teammates, set what they can do, and switch on WhatsApp so they log straight from site.
            </p>
            <div className="flex items-center gap-5 mt-4">
              <Stat n={members.length} label={members.length === 1 ? 'member' : 'members'} />
              <span style={{ width: 1, height: 26, background: N.keyline }} />
              <Stat n={eligibleCount} label="on WhatsApp" accent />
              {invites.length > 0 && <><span style={{ width: 1, height: 26, background: N.keyline }} /><Stat n={invites.length} label="invited" /></>}
            </div>
          </div>
        </div>

        {/* ── Invite ───────────────────────────────────────────────────────── */}
        <div className="mt-5">
          {!adding && !result && (
            <button onClick={() => setAdding(true)} className="btnp w-full inline-flex items-center justify-center gap-2 py-3 rounded-2xl font-medium"
              style={{ background: terraGrad, color: '#fff', ...font, ...T.sm, boxShadow: '0 6px 18px rgba(143,51,24,0.18)' }}>
              <UserPlus size={16} /> Invite a teammate
            </button>
          )}

          {adding && !result && (
            <div className="rounded-2xl p-4 db-card db-drop" style={{ background: V.surface }}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (optional)"
                  className="px-3 py-2.5 rounded-xl outline-none" style={{ background: V.field, color: V.ink, ...font, ...T.sm }} />
                <div className="inline-flex items-center gap-2 px-3 rounded-xl" style={{ background: V.field, height: 42 }}>
                  <Mail size={14} style={{ color: V.faint }} />
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email address (optional)" className="bg-transparent outline-none flex-1 min-w-0" style={{ color: V.ink, ...font, ...T.sm }} />
                </div>
                <div className="inline-flex items-center gap-2 px-3 rounded-xl" style={{ background: V.field, height: 42 }}>
                  <WhatsAppGlyph size={13} color={WA} />
                  <span style={{ color: V.faint, ...font, ...nums, ...T.sm }}>+91</span>
                  <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98765 43210" className="bg-transparent outline-none flex-1 min-w-0" style={{ color: V.ink, ...font, ...nums, ...T.sm }} />
                </div>
                <select value={role} onChange={(e) => setRole(e.target.value)} className="px-3 py-2.5 rounded-xl outline-none" style={{ background: V.field, color: V.ink, ...font, ...T.sm }}>
                  {INVITE_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>
              <p className="mt-3" style={{ color: V.faint, ...font, ...T.xs }}>
                {emailProvided
                  ? 'They get a join link, and their number can send to Briklay on WhatsApp.'
                  : 'WhatsApp-only — no email needed. They go live the moment they message Briklay.'}
              </p>
              <div className="flex gap-2 pt-3">
                <button onClick={resetForm} className="flex-1 py-2.5 rounded-xl" style={{ border: `1px solid ${V.line}`, color: V.sys, ...font, ...T.sm }}>Cancel</button>
                <button disabled={!canInvite || invite.isPending} onClick={() => invite.mutate()} className="flex-1 py-2.5 rounded-xl font-medium inline-flex items-center justify-center gap-1.5"
                  style={{ background: terraGrad, color: '#fff', opacity: canInvite ? 1 : 0.5, ...font, ...T.sm }}>
                  {invite.isPending ? <><Loader2 size={14} className="db-spin" /> Inviting…</> : emailProvided ? 'Send invite' : 'Add to WhatsApp'}
                </button>
              </div>
            </div>
          )}

          {result && (
            <div className="rounded-2xl p-4 db-card db-drop" style={{ background: V.surface }}>
              <p className="inline-flex items-center gap-1.5 font-medium" style={{ color: V.ink, ...font, ...T.sm }}>
                <span className="w-5 h-5 rounded-full inline-flex items-center justify-center db-pop" style={{ background: V.sageWash }}><Check size={12} color={V.sage} strokeWidth={3} /></span>
                {result.mode === 'email' ? 'Invite ready' : 'Added to WhatsApp'}
              </p>
              {result.mode === 'email' ? (
                <>
                  <p className="mt-1.5 leading-relaxed" style={{ color: V.sys, ...font, ...T.xs }}>Share this link so they can join. Their WhatsApp number can already send to Briklay.</p>
                  <button onClick={() => result.link && copyLink(result.link)} className="mt-3 w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl" style={{ background: V.field, color: V.inkSoft, ...font, ...T.xs }}>
                    <span className="truncate">{result.link}</span>
                    {copied ? <Check size={14} style={{ color: V.sage, flexShrink: 0 }} /> : <Copy size={13} style={{ color: V.faint, flexShrink: 0 }} />}
                  </button>
                </>
              ) : (
                <p className="mt-1.5 leading-relaxed" style={{ color: V.sys, ...font, ...T.xs }}>
                  <span style={{ ...nums }}>+91 {prettyPhone(result.phone)}</span>{result.name ? ` · ${result.name}` : ''} goes live the moment they send their first WhatsApp message to Briklay — they're greeted automatically.
                </p>
              )}
              <div className="flex gap-2 mt-3">
                <button onClick={resetForm} className="flex-1 py-2.5 rounded-xl font-medium" style={{ background: terraGrad, color: '#fff', ...font, ...T.sm }}>Done</button>
              </div>
            </div>
          )}
        </div>

        {/* ── Pending invites ──────────────────────────────────────────────── */}
        {invites.length > 0 && (
          <div className="mt-7">
            <p className="uppercase font-medium mb-2.5" style={labelCaps}>Pending invites</p>
            <div className="space-y-2">
              {invites.map((inv) => (
                <div key={inv.invite_id} className="rounded-xl p-3 flex items-center gap-3 db-card" style={{ background: V.surface }}>
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

        {/* ── Members ──────────────────────────────────────────────────────── */}
        <div className="mt-7">
          <div className="flex items-baseline justify-between mb-2.5">
            <p className="uppercase font-medium inline-flex items-center gap-1.5" style={labelCaps}><WhatsAppGlyph size={11} color={WA} /> Your team</p>
            {members.length > 0 && <p style={{ color: V.faint, ...font, ...nums, ...T.xs }}>{eligibleCount}/{members.length} on WhatsApp</p>}
          </div>
          {membersLoading ? (
            <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="rounded-2xl h-20 shimmer" style={{ background: V.field }} />)}</div>
          ) : members.length === 0 ? (
            <p className="py-8 text-center" style={{ color: V.faint, ...font, ...T.sm }}>No one yet. Invite the people who handle money on site.</p>
          ) : (
            <div className="space-y-2.5">
              {members.map((m) => (
                <MemberCard key={m.id} member={m} sender={senderForMember(m)} suggestPhone={suggestPhoneFor(m)} projects={projects}
                  onEnable={(ph) => enableMember(m, ph)}
                  onDisable={() => disableMember(m)}
                  onChangeNumber={(ph) => changeNumber(senderForMember(m)!.id, ph)}
                  onLang={(lang) => { const row = senderForMember(m); if (row) setLang.mutate({ id: row.id, lang }); }}
                  onRole={(r) => changeRole(m, r)}
                  onRename={(n) => rename(m, n)}
                  onDelete={() => { if (confirm(`Remove ${m.name} from the team?`)) removeMember.mutate(m.id); }}
                  onToggleProject={(pid) => toggleProject(m, pid)}
                />
              ))}
            </div>
          )}
          <p className="mt-3 leading-relaxed" style={{ color: V.faint, ...font, ...T.xs }}>
            Turning someone on lets their WhatsApp number send to Briklay, and sends a one-time welcome. Turn it off when they leave the site — their history stays.
          </p>
        </div>

        {/* ── Other site senders ───────────────────────────────────────────── */}
        {otherSenders.length > 0 && (
          <div className="mt-7 pb-4">
            <p className="uppercase font-medium mb-2.5" style={labelCaps}>Other site senders</p>
            <div className="space-y-2">
              {otherSenders.map((m) => (
                <OtherSenderRow key={m.id} contact={m}
                  onToggle={() => toggleOther.mutate({ id: m.id, next: !m.is_active })}
                  onLang={(lang) => setLang.mutate({ id: m.id, lang })}
                  onChangeNumber={(ph) => changeNumber(m.id, ph)} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ n, label, accent }: { n: number; label: string; accent?: boolean }) {
  return (
    <div>
      <p style={{ color: accent ? WA : N.text, ...serif, ...nums, fontSize: '1.5rem', lineHeight: 1 }}>{n}</p>
      <p className="mt-1" style={{ color: N.textFaint, ...font, ...T.xs }}>{label}</p>
    </div>
  );
}

// A slow terra/whatsapp glow on the dark hero — the one decorative flourish.
const HERO_CSS = `
@keyframes teamGlowPulse { 0%,100% { opacity:.5; transform:translate(0,0) scale(1);} 50% { opacity:.8; transform:translate(8px,-6px) scale(1.08);} }
.team-glow { position:absolute; top:-40%; right:-10%; width:340px; height:340px; border-radius:9999px; pointer-events:none;
  background: radial-gradient(circle, rgba(217,106,67,0.42) 0%, rgba(37,211,102,0.10) 45%, transparent 70%);
  filter: blur(8px); animation: teamGlowPulse 9s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) { .team-glow { animation:none; } }
`;
