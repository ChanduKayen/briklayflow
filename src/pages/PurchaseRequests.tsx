/**
 * Purchase Requests — a read-only overview of the WhatsApp-captured PR drafts. The
 * Day Book PR rows point here. Approval does NOT happen on this page: there is one
 * approval surface — the /purchase-orders draft queue — where the approver sets
 * vendor/site and promotes the request into a live PO in a single action. This page
 * lists requests and routes approvers there ("Review & approve →").
 */
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { useOrgId } from '../lib/auth/AuthProvider';
import { PageSkeleton } from '../components/SkeletonLoader';
import { V, font, serif } from '../components/day-book/tokens';
import { Check, Package, ArrowRight } from 'lucide-react';

interface PRItem { item_name: string; quantity: number | null; unit: string | null }
interface PR {
  id: string; status: string; title: string | null;
  site_id: string | null; site_raw: string | null;
  vendor_id: string | null; vendor_raw: string | null;
  sourcing_mode: string | null; created_at: string; approved_at: string | null;
  purchase_request_items: PRItem[];
  projects: { name: string } | null;
  stakeholders: { name: string } | null;
}

const STATUS = (s: string): { label: string; color: string; bg: string } => {
  if (s === 'placed' || s === 'approved') return { label: 'Ordered', color: V.sage, bg: V.sageWash };
  if (s === 'sent_for_approval') return { label: 'Awaiting approval', color: V.ask, bg: V.askWash };
  return { label: 'Draft', color: V.inkSoft, bg: V.field };
};
const isSettled = (s: string) => s === 'placed' || s === 'approved' || s === 'fulfilled' || s === 'closed';

const itemLine = (pr: PR): string => {
  const items = pr.purchase_request_items ?? [];
  if (items.length === 0) return pr.title ?? 'Purchase request';
  if (items.length <= 2) return items.map((i) => `${i.quantity ?? ''}${i.unit ? ' ' + i.unit : ''} ${i.item_name}`.trim()).join(', ');
  const base = pr.title ?? `${items[0].item_name} + ${items.length - 1} more`;
  return `${base} · ${items.length} items`;
};

export default function PurchaseRequests({ session }: { session: Session }) {
  const orgId = useOrgId();
  const navigate = useNavigate();

  const { data: canApprove = false } = useQuery({
    queryKey: ['can_approve_procurement', session.user.id, orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data } = await supabase.from('org_memberships')
        .select('can_approve_procurement').eq('user_id', session.user.id).eq('org_id', orgId).maybeSingle();
      return !!(data as { can_approve_procurement?: boolean } | null)?.can_approve_procurement;
    },
  });

  const { data: requests = [], isLoading } = useQuery({
    queryKey: ['purchase_requests', orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase.from('purchase_requests')
        .select('id, status, title, site_id, site_raw, vendor_id, vendor_raw, sourcing_mode, created_at, approved_at, purchase_request_items(item_name, quantity, unit), projects(name), stakeholders(name)')
        .eq('org_id', orgId).order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as PR[];
    },
  });

  // One approval surface: the PO draft queue. Approvers review there (set vendor/site,
  // then promote to a live PO). This page never writes approval state itself.
  const goReview = () => navigate('/purchase-orders?status=draft');

  return (
    <div className="min-h-screen" style={{ background: V.page, ...font }}>
      <div className="mx-auto px-5 sm:px-8 py-8 max-w-[860px]">
        <h1 className="text-3xl" style={{ color: V.ink, ...serif }}>Purchase requests</h1>
        <p className="text-sm mt-2" style={{ color: V.sys, ...font }}>
          Material requests raised on WhatsApp.{canApprove ? ' Review and approve them in the purchase-order queue.' : ' An approver will review them.'}
        </p>

        {isLoading ? (
          <div className="mt-7"><PageSkeleton /></div>
        ) : requests.length === 0 ? (
          <div className="py-20 text-center">
            <p style={{ color: V.faint, ...font }}>No purchase requests yet.</p>
          </div>
        ) : (
          <div className="mt-7 space-y-2.5">
            {requests.map((pr) => {
              const st = STATUS(pr.status);
              const site = pr.projects?.name ?? pr.site_raw ?? null;
              const vendor = pr.stakeholders?.name ?? pr.vendor_raw ?? null;
              const settled = isSettled(pr.status);
              const showReview = canApprove && !settled;
              return (
                <div key={pr.id} onClick={showReview ? goReview : undefined} className="rounded-2xl p-4" style={{ background: V.surface, border: '1px solid #E3DDD4', cursor: showReview ? 'pointer' : 'default' }}>
                  <div className="flex items-start gap-3">
                    <span className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: V.terraWash, color: V.terraDeep }}>
                      <Package size={16} />
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium" style={{ color: V.ink, ...font }}>{itemLine(pr)}</p>
                      <p className="text-[12px] mt-0.5" style={{ color: V.sys, ...font }}>
                        {[site ?? 'site not set', vendor ? `to ${vendor}` : null].filter(Boolean).join(' · ')}
                      </p>
                      <div className="flex items-center gap-2 mt-2">
                        <span className="text-[11px] font-medium px-2 py-0.5 rounded-full" style={{ background: st.bg, color: st.color }}>{st.label}</span>
                        {!site && <span className="text-[11px]" style={{ color: V.ask }}>needs site</span>}
                      </div>
                    </div>
                    {showReview && (
                      <button
                        onClick={(e) => { e.stopPropagation(); goReview(); }}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg font-medium shrink-0 self-center active:scale-95 transition-transform"
                        style={{ background: V.terraWash, color: V.terraDeep, border: `1px solid ${V.terraDeep}22`, ...font, fontSize: 13 }}
                      >
                        Review &amp; approve <ArrowRight size={14} />
                      </button>
                    )}
                    {settled && (
                      <span className="inline-flex items-center gap-1 shrink-0 self-center" style={{ color: V.sage, ...font, fontSize: 12 }}>
                        <Check size={14} /> Ordered
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
