/**
 * The invitation: a warm-dark banner inviting site people onto WhatsApp, plus
 * the Manage-team slide-over. Wired to wa_registered_numbers (name, role, phone,
 * is_active). The is_active toggle is the real "can capture" gate the webhook
 * enforces — turning it off stops that contact's future captures.
 *
 * HONEST INVITE: there is no approved outbound template yet, so "Start on
 * WhatsApp" does the two things we can do truthfully — authorize the contact
 * (insert the number) and hand the owner a wa.me deep link to send the first
 * hello. No fake "invite sent" confirmation. (Follow-up ticket: automated
 * template invite; this degrades to copy + open-WhatsApp until then.)
 *
 * project-per-contact is intentionally not shown — wa_registered_numbers has no
 * project column yet (follow-up schema ticket).
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Users, UserPlus, X, Phone, ExternalLink, Copy } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useSnackbar } from '../Snackbar';
import { N, V, WA, font, serif, nums, terraGrad, T } from './tokens';
import { WhatsAppGlyph } from './atoms';

interface WaContact {
  id: string;
  phone_number: string;
  name: string;
  role: string;
  is_active: boolean;
  stakeholder_id: string | null;
  created_at: string;
}

const ROLES = ['Supervisor', 'Site engineer', 'Mason lead', 'Accountant', 'Owner'];
const digits = (s: string) => s.replace(/\D/g, '');
const waLink = (phone: string) => `https://wa.me/91${digits(phone)}`;

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

// ── Manage team slide-over ──────────────────────────────────────────────────────
export function ManageTeam({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { show } = useSnackbar();
  const { data: team = [] } = useTeam();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState(ROLES[0]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['wa_registered_numbers'] });

  const toggle = useMutation({
    mutationFn: async ({ id, next }: { id: string; next: boolean }) => {
      const { error } = await supabase.from('wa_registered_numbers').update({ is_active: next }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e: any) => show(e.message || 'Could not update access', { type: 'error' }),
  });

  const setContactRole = useMutation({
    mutationFn: async ({ id, role }: { id: string; role: string }) => {
      const { error } = await supabase.from('wa_registered_numbers').update({ role }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const add = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('wa_registered_numbers')
        .insert({ name: name.trim(), phone_number: digits(phone), role, is_active: true });
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); setAdding(false); setName(''); setPhone(''); setRole(ROLES[0]); show('Added to your site team'); },
    onError: (e: any) => show(e.message || 'Could not add (number may already exist)', { type: 'error' }),
  });

  return (
    <div className="fixed inset-0 z-50 flex justify-end" style={{ background: 'rgba(30,26,21,0.32)' }} onClick={onClose}>
      <div
        className="h-full overflow-y-auto db-fade"
        style={{ width: 'min(92%, 460px)', background: V.page, boxShadow: '-12px 0 32px rgba(30,26,21,0.18)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 px-5 py-4 flex items-center justify-between" style={{ background: V.page, borderBottom: `1px solid ${V.line}` }}>
          <div>
            <p style={{ color: V.ink, ...serif, fontSize: '1.3rem' }}>Your site team</p>
            <p className="mt-0.5" style={{ color: V.faint, ...font, ...T.xs }}>People who can message Briklay on WhatsApp</p>
          </div>
          <button onClick={onClose} aria-label="Close"><X size={18} style={{ color: V.faint }} /></button>
        </div>

        <div className="px-5 py-4">
          {!adding ? (
            <button onClick={() => setAdding(true)} className="w-full inline-flex items-center justify-center gap-1.5 py-2.5 rounded-xl font-medium" style={{ background: terraGrad, color: '#fff', ...font, ...T.sm }}>
              <UserPlus size={15} /> Add a person
            </button>
          ) : (
            <div className="rounded-xl p-3.5 space-y-2.5" style={{ background: V.surface, border: '1px solid #E3DDD4' }}>
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="w-full px-3 py-2 rounded-lg outline-none" style={{ background: V.field, color: V.ink, ...font, ...T.sm }} />
              <div className="inline-flex items-center gap-2 px-3 rounded-lg w-full" style={{ background: V.field, height: 40 }}>
                <span style={{ color: V.faint, ...font, ...nums, ...T.sm }}>+91</span>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98765 43210" className="bg-transparent outline-none flex-1" style={{ color: V.ink, ...font, ...nums, ...T.sm }} />
              </div>
              <select value={role} onChange={(e) => setRole(e.target.value)} className="w-full px-3 py-2 rounded-lg outline-none" style={{ background: V.field, color: V.ink, ...font, ...T.sm }}>
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              <div className="flex gap-2 pt-1">
                <button onClick={() => setAdding(false)} className="flex-1 py-2 rounded-lg" style={{ border: `1px solid ${V.line}`, color: V.sys, ...font, ...T.sm }}>Cancel</button>
                <button disabled={name.trim().length < 1 || digits(phone).length < 10 || add.isPending} onClick={() => add.mutate()} className="flex-1 py-2 rounded-lg font-medium" style={{ background: terraGrad, color: '#fff', opacity: (name.trim() && digits(phone).length >= 10) ? 1 : 0.5, ...font, ...T.sm }}>
                  {add.isPending ? 'Adding…' : 'Add'}
                </button>
              </div>
            </div>
          )}

          <div className="mt-4 space-y-2">
            {team.length === 0 && !adding && (
              <p className="text-center py-8" style={{ color: V.faint, ...font, ...T.sm }}>No one yet. Add the people who handle money on site.</p>
            )}
            {team.map((m) => (
              <div key={m.id} className="rounded-xl p-3.5 flex items-center gap-3" style={{ background: V.surface, border: '1px solid #E3DDD4', opacity: m.is_active ? 1 : 0.6 }}>
                <span className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 font-medium" style={{ background: V.terraWash, color: V.terraDeep, ...font, ...T.sm }}>
                  {m.name.split(' ')[0].slice(0, 2).toUpperCase()}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate" style={{ color: V.ink, ...font, ...T.sm }}>{m.name}</p>
                  <select
                    value={ROLES.includes(m.role) ? m.role : ROLES[0]}
                    onChange={(e) => setContactRole.mutate({ id: m.id, role: e.target.value })}
                    className="bg-transparent outline-none -ml-0.5 mt-0.5"
                    style={{ color: V.faint, ...font, ...T.xs }}
                  >
                    {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
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

          <p className="mt-4 leading-relaxed" style={{ color: V.faint, ...font, ...T.xs }}>
            The green toggle controls who can send records to Briklay. Turn it off for anyone who has left the site, without deleting their history.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── The banner ──────────────────────────────────────────────────────────────────
export function Invitation({ canManage }: { canManage: boolean }) {
  const { show } = useSnackbar();
  const { data: team = [] } = useTeam();
  const [manage, setManage] = useState(false);
  const [stage, setStage] = useState<'idle' | 'asking' | 'added'>('idle');
  const [name, setName] = useState('');
  const [num, setNum] = useState('');

  const qc = useQueryClient();
  const activeCount = team.filter((t) => t.is_active).length;

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('wa_registered_numbers')
        .insert({ name: name.trim() || 'Site contact', phone_number: digits(num), role: 'Supervisor', is_active: true });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['wa_registered_numbers'] }); setStage('added'); },
    onError: (e: any) => show(e.message || 'Could not add (number may already exist)', { type: 'error' }),
  });

  if (!canManage) return null;

  // collapsed: once the org has active contacts, don't hold the top banner forever
  if (activeCount > 0 && stage === 'idle') {
    return (
      <>
        {manage && <ManageTeam onClose={() => setManage(false)} />}
        <div style={{ background: N.bg }}>
          <div className="mx-auto py-3 flex items-center gap-3" style={{ width: '92%', maxWidth: 1100 }}>
            <span className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'rgba(37,211,102,0.14)' }}>
              <WhatsAppGlyph size={15} color={WA} />
            </span>
            <p className="flex-1 min-w-0 truncate" style={{ color: N.text, ...font, ...T.sm }}>
              {activeCount} {activeCount === 1 ? 'person' : 'people'} on site can message Briklay
            </p>
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={() => setStage('asking')} className="inline-flex items-center gap-1.5 font-medium py-1.5 px-3 rounded-lg whitespace-nowrap" style={{ background: terraGrad, color: '#fff', ...font, ...T.xs }}>
                <UserPlus size={13} /> Add person
              </button>
              <button onClick={() => setManage(true)} className="inline-flex items-center gap-1.5 py-1.5 px-3 rounded-lg whitespace-nowrap" style={{ background: 'transparent', border: `1px solid ${N.keyline}`, color: N.textSoft, ...font, ...T.xs }}>
                <Users size={13} /> Manage team
              </button>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      {manage && <ManageTeam onClose={() => setManage(false)} />}
      <div className="relative overflow-hidden" style={{ background: N.bg }}>
        <div aria-hidden className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(420px circle at 88% 0%, rgba(37,211,102,0.10), transparent 60%)' }} />
        <div className="mx-auto py-5 relative" style={{ width: '92%', maxWidth: 1100 }}>
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'rgba(37,211,102,0.14)' }}>
              <WhatsAppGlyph size={20} color={WA} />
            </span>
            <div className="flex-1 min-w-0">
              {stage === 'idle' && (
                <div className="db-fade flex items-center justify-between" style={{ gap: '4%' }}>
                  <div className="min-w-0" style={{ flexBasis: '62%', flexGrow: 1 }}>
                    <p className="font-medium" style={{ color: N.text, ...font, ...T.sm }}>Add whoever handles money on site</p>
                    <p className="mt-1 leading-relaxed" style={{ color: N.textSoft, ...font, ...T.xs }}>
                      They message Briklay on WhatsApp with payments, bills, and photos. Nothing to install.
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button onClick={() => setStage('asking')} className="inline-flex items-center justify-center gap-1.5 font-medium py-2 px-4 rounded-lg whitespace-nowrap" style={{ background: terraGrad, color: '#fff', ...font, ...T.sm }}>
                      Start on WhatsApp <ArrowRight size={14} />
                    </button>
                    <button onClick={() => setManage(true)} className="inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg whitespace-nowrap" style={{ background: 'transparent', border: `1px solid ${N.keyline}`, color: N.textSoft, ...font, ...T.sm }}>
                      <Users size={14} /> Manage team
                    </button>
                  </div>
                </div>
              )}

              {stage !== 'idle' && (
                <p className="font-medium" style={{ color: N.text, ...font, ...T.sm }}>Add whoever handles money on site</p>
              )}

              {stage === 'asking' && (
                <div className="db-fade">
                  <p className="mt-1 leading-relaxed" style={{ color: N.textSoft, ...font, ...T.xs }}>
                    Their name and WhatsApp number. They will be able to send records right away.
                  </p>
                  <div className="flex flex-wrap gap-2 mt-3.5">
                    <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="px-3 rounded-lg outline-none" style={{ background: N.field, border: `1px solid ${N.keyline}`, color: N.text, height: 38, width: 130, ...font, ...T.sm }} />
                    <div className="inline-flex items-center gap-2 px-3 rounded-lg" style={{ background: N.field, border: `1px solid ${N.keyline}`, height: 38 }}>
                      <span style={{ color: N.textFaint, ...font, ...nums, ...T.sm }}>+91</span>
                      <input autoFocus value={num} onChange={(e) => setNum(e.target.value)} placeholder="98765 43210" className="bg-transparent outline-none" style={{ color: N.text, width: 120, ...font, ...nums, ...T.sm }} />
                    </div>
                    <button onClick={() => save.mutate()} disabled={digits(num).length < 10 || save.isPending} className="inline-flex items-center gap-1.5 font-medium px-4 py-2 rounded-lg" style={digits(num).length < 10 ? { background: N.field, color: N.textFaint, ...font, ...T.sm } : { background: terraGrad, color: '#fff', ...font, ...T.sm }}>
                      {save.isPending ? 'Adding…' : <>Add <ArrowRight size={14} /></>}
                    </button>
                  </div>
                </div>
              )}

              {stage === 'added' && (
                <div className="db-fade flex flex-wrap items-center gap-2.5 mt-2">
                  <span className="w-6 h-6 rounded-full flex items-center justify-center db-pop shrink-0" style={{ background: 'rgba(37,211,102,0.18)' }}>
                    <WhatsAppGlyph size={13} color={WA} />
                  </span>
                  <p style={{ color: N.text, ...font, ...nums, ...T.sm }}>
                    {name.trim() || 'They'} can now message Briklay. Send the first hello:
                  </p>
                  <a href={waLink(num)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium" style={{ background: 'rgba(37,211,102,0.16)', color: WA, ...font, ...T.xs }}>
                    Open WhatsApp <ExternalLink size={13} />
                  </a>
                  <button onClick={() => { navigator.clipboard?.writeText(`+91 ${num}`); show('Number copied'); }} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg" style={{ border: `1px solid ${N.keyline}`, color: N.textSoft, ...font, ...T.xs }}>
                    <Copy size={12} /> Copy number
                  </button>
                  <button onClick={() => { setStage('idle'); setName(''); setNum(''); }} className="ml-auto" style={{ color: N.textFaint, ...font, ...T.xs }}>Done</button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
