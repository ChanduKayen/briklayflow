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
import { UserPlus, X, Phone, Mail, Copy, Check, Clock } from 'lucide-react';
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
  stakeholder_id: string | null;
  created_at: string;
}

const digits = (s: string) => s.replace(/\D/g, '');

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
  const [result, setResult] = useState<{ link: string; phone: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const phoneOk = digits(phone).length >= 10;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['daybook_pending_invites'] });
    qc.invalidateQueries({ queryKey: ['wa_registered_numbers'] });
  };
  const resetForm = () => { setAdding(false); setName(''); setEmail(''); setPhone(''); setRole(INVITE_ROLES[0].value); setResult(null); };

  // Invite: the platform email route (create_invite) + register their WhatsApp number
  // so they can send the moment they join. One action, both kinds of access.
  const invite = useMutation({
    mutationFn: async () => {
      if (!emailOk) throw new Error('Enter a valid email address');
      if (!phoneOk) throw new Error('Enter their WhatsApp number');
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
        .insert({ name: name.trim() || email.trim(), phone_number: digits(phone), role: roleLabel(role), is_active: true });
      if (waErr && !/duplicate|unique/i.test(waErr.message)) throw waErr;
      return { link: inviteLinkFor(row.token), phone: digits(phone) };
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

  const copyLink = (link: string) => {
    navigator.clipboard?.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); }).catch(() => { /* noop */ });
  };
  const waInviteUrl = (p: string, link: string) => `https://wa.me/91${p}?text=${encodeURIComponent(`You're invited to Briklay. Join here: ${link}`)}`;

  const labelCaps = { color: V.faint, letterSpacing: '0.08em', ...font, ...T.xs } as const;

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
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email address" className="bg-transparent outline-none flex-1" style={{ color: V.ink, ...font, ...T.sm }} />
              </div>
              <div className="inline-flex items-center gap-2 px-3 rounded-lg w-full" style={{ background: V.field, height: 40 }}>
                <WhatsAppGlyph size={13} color={WA} />
                <span style={{ color: V.faint, ...font, ...nums, ...T.sm }}>+91</span>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98765 43210" className="bg-transparent outline-none flex-1" style={{ color: V.ink, ...font, ...nums, ...T.sm }} />
              </div>
              <select value={role} onChange={(e) => setRole(e.target.value)} className="w-full px-3 py-2 rounded-lg outline-none" style={{ background: V.field, color: V.ink, ...font, ...T.sm }}>
                {INVITE_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
              <p style={{ color: V.faint, ...font, ...T.xs }}>They get a join link, and their number can send to Briklay on WhatsApp.</p>
              <div className="flex gap-2 pt-1">
                <button onClick={resetForm} className="flex-1 py-2 rounded-lg" style={{ border: `1px solid ${V.line}`, color: V.sys, ...font, ...T.sm }}>Cancel</button>
                <button disabled={!emailOk || !phoneOk || invite.isPending} onClick={() => invite.mutate()} className="flex-1 py-2 rounded-lg font-medium" style={{ background: terraGrad, color: '#fff', opacity: emailOk && phoneOk ? 1 : 0.5, ...font, ...T.sm }}>
                  {invite.isPending ? 'Inviting…' : 'Send invite'}
                </button>
              </div>
            </div>
          )}

          {result && (
            <div className="rounded-xl p-3.5 db-drop" style={{ background: V.surface, border: '1px solid #E3DDD4' }}>
              <p className="inline-flex items-center gap-1.5 font-medium" style={{ color: V.ink, ...font, ...T.sm }}>
                <span className="w-5 h-5 rounded-full inline-flex items-center justify-center db-pop" style={{ background: V.sageWash }}><Check size={12} color={V.sage} strokeWidth={3} /></span>
                Invite ready
              </p>
              <p className="mt-1.5 leading-relaxed" style={{ color: V.sys, ...font, ...T.xs }}>Share this link so they can join. Their WhatsApp number can already send to Briklay.</p>
              <button onClick={() => copyLink(result.link)} className="mt-3 w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg" style={{ background: V.field, color: V.inkSoft, ...font, ...T.xs }}>
                <span className="truncate">{result.link}</span>
                {copied ? <Check size={14} style={{ color: V.sage, flexShrink: 0 }} /> : <Copy size={13} style={{ color: V.faint, flexShrink: 0 }} />}
              </button>
              <div className="flex gap-2 mt-2.5">
                <a href={waInviteUrl(result.phone, result.link)} target="_blank" rel="noopener noreferrer" className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 rounded-lg font-medium" style={{ background: 'rgba(37,211,102,0.16)', color: WA, ...font, ...T.sm }}>
                  <WhatsAppGlyph size={14} color={WA} /> Send on WhatsApp
                </a>
                <button onClick={resetForm} className="px-4 py-2 rounded-lg" style={{ border: `1px solid ${V.line}`, color: V.sys, ...font, ...T.sm }}>Done</button>
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

          {/* platform members */}
          <div className="mt-5">
            <p className="uppercase font-medium mb-2" style={labelCaps}>Members</p>
            {members.length === 0 ? (
              <p className="py-6 text-center" style={{ color: V.faint, ...font, ...T.sm }}>No one yet. Invite the people who handle money on site.</p>
            ) : (
              <div className="space-y-2">
                {members.map((m) => (
                  <div key={m.id} className="rounded-xl p-3.5 flex items-center gap-3" style={{ background: V.surface, border: '1px solid #E3DDD4' }}>
                    <span className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 font-medium" style={{ background: V.terraWash, color: V.terraDeep, ...font, ...T.sm }}>
                      {(m.name || '?').split(' ')[0].slice(0, 2).toUpperCase()}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate" style={{ color: V.ink, ...font, ...T.sm }}>{m.name || 'Unnamed'}</p>
                      <p className="truncate mt-0.5" style={{ color: V.faint, ...font, ...T.xs }}>{roleLabel(m.role)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* whatsapp send-access */}
          {senders.length > 0 && (
            <div className="mt-5">
              <p className="uppercase font-medium mb-2 inline-flex items-center gap-1.5" style={labelCaps}><WhatsAppGlyph size={11} color={WA} /> Can send on WhatsApp</p>
              <div className="space-y-2">
                {senders.map((m) => (
                  <div key={m.id} className="rounded-xl p-3 flex items-center gap-3" style={{ background: V.surface, border: '1px solid #E3DDD4', opacity: m.is_active ? 1 : 0.55 }}>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate" style={{ color: V.ink, ...font, ...T.sm }}>{m.name || 'Site contact'}</p>
                      <p className="truncate mt-0.5 inline-flex items-center gap-1" style={{ color: V.sys, ...font, ...nums, ...T.xs }}>
                        <Phone size={10} style={{ color: V.faint }} /> +91 {m.phone_number}
                      </p>
                    </div>
                    <button
                      aria-label="Toggle WhatsApp access"
                      onClick={() => toggle.mutate({ id: m.id, next: !m.is_active })}
                      className="w-9 h-5 rounded-full relative shrink-0"
                      style={{ background: m.is_active ? V.sage : V.line, transition: 'background .15s' }}
                    >
                      <span className="absolute top-0.5 w-4 h-4 rounded-full" style={{ background: '#fff', left: m.is_active ? 18 : 2, transition: 'left .15s' }} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="mt-5 leading-relaxed" style={{ color: V.faint, ...font, ...T.xs }}>
            Inviting someone sends them a join link and lets their WhatsApp number send to Briklay. The green toggle turns sending off for anyone who has left the site, without deleting their history.
          </p>
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
