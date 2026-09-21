/**
 * NEW BILL — the one door, wearing one face.
 *
 * Three places record a vendor bill: the Bills page, a PO's "record the bill", and a payment being
 * attached to the paper it settles. This is that moment, once: the "Add bill" composer.
 *
 * The composer itself is the reference design, rendered VERBATIM inside a full-viewport iframe
 * (src/components/bills/addBillComposer.html) so its bespoke stylesheet and interactions run exactly
 * as authored, with zero CSS leakage. This host wires it to the real app over a small postMessage
 * bridge: vendors + sites go IN via the __BRIK_BILL_INIT__ placeholder; OCR (extractBill) and the
 * save (each door's own `commit`) happen back here via brik-bill-req / brik-bill-res. The prop
 * contract (NewBillModalProps / BillDraft) is unchanged, so every existing caller keeps working.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useOrgId } from '../../lib/auth/AuthProvider';
import { extractBill, type ExtractedBill, type DuplicateBill } from '../../lib/billsApi';
import { createParty, errMessage } from '../day-book/fileEntry';
import composerHtml from './addBillComposer.html?raw';

export interface BillDraft {
  file: File | null;
  vendorId: string; vendorName: string;
  billNo: string | null; billDate: string | null; amount: number;
  projectId: string | null;
  lines: ExtractedBill['lines'];
  allowDuplicate: boolean;
}

interface Vendor { stakeholder_id: string; name: string; aliases?: string[] | null }

export interface NewBillModalProps {
  open: boolean;
  onClose: () => void;
  /** 'New bill' on the Bills page; a door with context names what it is doing instead. */
  title?: string;
  /** Doors that already know who is billing (a PO, a payment) show the party rather than ask. */
  lockVendor?: { id: string; name: string } | null;
  /** A pre-known site — the PO's project. Shown, not asked. The name is looked up if not given. */
  lockProject?: { id: string; name?: string } | null;
  /** A file the page already has in hand (dragged onto the Bills page): read it straight away. */
  initialFile?: File | null;
  /** Extraction the door has already done — skip straight to the confirmed form. */
  initialExtract?: ExtractedBill | null;
  /** Bills page multi-drop: how many more are waiting behind this one. */
  queueMore?: number;
  /** Offered when the same vendor + number is already on the books. */
  onOpenBill?: (billId: string) => void;
  /** What that offer is called. A door mid-payment reconciles rather than navigates. */
  openBillLabel?: string;
  /** The door's own write. Return a duplicate to surface it instead of closing. */
  commit: (d: BillDraft) => Promise<{ duplicate?: DuplicateBill } | void>;
  /** A door that opens on top of another overlay says how high to stack (default 120). */
  stackAbove?: number;
  /** Embed the composer INLINE (in the page header flow, auto-height) instead of as a fixed overlay.
   *  The desktop Bills page uses this so the form opens inside the header, revealing the list below. */
  inline?: boolean;
}

type ReqMsg = {
  type?: string; id?: number; action?: string;
  payload?: { file?: File | null; vendorName?: string; billNo?: string | null; date?: string | null; amount?: number; site?: string | null; allowDuplicate?: boolean };
};

export default function NewBillModal(props: NewBillModalProps) {
  const { open, onClose, lockVendor = null, lockProject = null, initialFile = null, initialExtract = null, title = 'New bill', commit, stackAbove = 120, inline = false } = props;
  const orgId = useOrgId();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const lastExtract = useRef<ExtractedBill | null>(initialExtract);
  const [pop, setPop] = useState(0);   // inline: extra px the iframe grows BELOW the fixed header to fit an open dropdown

  // Vendors (typeahead) + active sites (chips) — the two lists the composer needs at init.
  const vq = useQuery<Vendor[]>({
    queryKey: ['bill_vendors'],
    queryFn: async () => ((await supabase.from('stakeholders').select('stakeholder_id, name, aliases').eq('type', 'Vendor').is('merged_into', null).order('name')).data ?? []) as Vendor[],
    enabled: open,
  });
  const pq = useQuery<{ project_id: string; name: string }[]>({
    queryKey: ['projects_active_min'],
    queryFn: async () => ((await supabase.from('projects').select('project_id, name').eq('status', 'Active').order('name')).data ?? []) as { project_id: string; name: string }[],
    enabled: open,
  });
  const vendors = vq.data ?? [];
  const projects = pq.data ?? [];

  // Build only once both lists have loaded, so the composer gets real vendors/sites (not empty).
  const ready = open && !!orgId && vq.isSuccess && pq.isSuccess;

  // Data goes IN by replacing the placeholder token (the app's established idiom), so it is available
  // to the composer synchronously at init. Freeze once built so the iframe never remounts mid-edit.
  const builtRef = useRef<string>('');
  const srcDoc = useMemo(() => {
    if (builtRef.current) return builtRef.current;
    if (!ready) return '';
    const init = {
      title,
      lockVendor: lockVendor ? { id: lockVendor.id, name: lockVendor.name } : null,
      lockProject: lockProject ? { id: lockProject.id, name: lockProject.name } : null,
      // aliases ride along so the composer's "on file" test is the same test resolveVendorId makes.
      vendors: vendors.map((v) => ({ name: v.name, open: 0, site: null, aliases: v.aliases ?? [] })),
      vendorCount: vendors.length,
      sites: projects.map((p) => ({ id: p.project_id, name: p.name })),
      initialExtract: initialExtract ? { vendor: initialExtract.vendor, billNo: initialExtract.billNo, billDate: initialExtract.billDate, amount: initialExtract.amount } : null,
      inline,
    };
    const json = JSON.stringify(init).replace(/</g, '\\u003c');
    builtRef.current = composerHtml.replace('__BRIK_BILL_INIT__', () => json);   // fn replacer: no $-substitution
    return builtRef.current;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // A name the org has never billed before becomes a vendor — through createParty, the ONE place that
  // mints a stakeholder. stakeholders.stakeholder_id is a text primary key the app assigns (STK-####);
  // it has no database default, so a bare insert of { org_id, name, type } is rejected for a null key
  // and the whole save fails. That is why adding a bill for a new (or differently-spelled) vendor died
  // here on desktop while the phone — which always hands over a vendor already picked from the list —
  // went through. Match on aliases too, so "SRI BALAJI STEELS & CO" finds the vendor it already is.
  async function resolveVendorId(name: string): Promise<string> {
    if (lockVendor) return lockVendor.id;
    const n = (name || '').trim();
    if (!n) throw new Error('Say who billed you');
    const low = n.toLowerCase();
    const hit = vendors.find((v) => v.name.trim().toLowerCase() === low)
      ?? vendors.find((v) => (v.aliases ?? []).some((a) => String(a).trim().toLowerCase() === low));
    if (hit) return hit.stakeholder_id;
    const made = await createParty(n, 'Vendor', orgId);
    return made.id;
  }

  // The bridge: OCR + save happen here; a close message unmounts the modal.
  useEffect(() => {
    if (!open) return;
    const onMsg = async (e: MessageEvent) => {
      if (iframeRef.current && e.source !== iframeRef.current.contentWindow) return;   // only our frame
      const d = e.data as ReqMsg | null;
      if (!d) return;
      if (d.type === 'brik-bill-close') { onClose(); return; }
      if (d.type === 'brik-bill-height') {
        // The header is a fixed band; the iframe fills it and grows below only to fit an open dropdown.
        setPop(Math.max(0, Math.ceil(Number((d as { pop?: number }).pop) || 0)));
        return;
      }
      if (d.type !== 'brik-bill-req') return;
      const win = iframeRef.current?.contentWindow;
      const reply = (r: Record<string, unknown>) => win?.postMessage({ type: 'brik-bill-res', id: d.id, ...r }, '*');
      try {
        if (d.action === 'extract') {
          const file = d.payload?.file;
          if (!file) { reply({ ok: false, error: 'no file' }); return; }
          const r = await extractBill(file);
          lastExtract.current = r;
          reply({ ok: true, vendor: r.vendor, billNo: r.billNo, date: r.billDate, amount: r.amount, site: null });
        } else if (d.action === 'commit') {
          const p = d.payload || {};
          const vendorId = await resolveVendorId(p.vendorName || lockVendor?.name || '');
          const draft: BillDraft = {
            file: p.file ?? null,
            vendorId, vendorName: (p.vendorName || lockVendor?.name || '').trim(),
            billNo: p.billNo || null, billDate: p.date || null, amount: Number(p.amount) || 0,
            projectId: p.site ?? lockProject?.id ?? null,
            lines: lastExtract.current?.lines ?? [],
            allowDuplicate: !!p.allowDuplicate,
          };
          const res = await commit(draft);
          if (res && res.duplicate) reply({ status: 'duplicate', existing: res.duplicate });
          else reply({ status: 'ok' });
        }
      } catch (err) {
        // Say WHY. A Supabase failure is a plain { message, details, hint, code } object, not an Error —
        // testing `instanceof Error` threw every database reason away and left the composer showing a
        // bare "Couldn't save", which is unactionable for the user and undiagnosable for us. errMessage
        // is the app's usual reader for both shapes.
        const full = errMessage(err, 'Couldn’t save — try again');
        const msg = full.length > 200 ? full.slice(0, 197) + '…' : full;   // the status line is one strip, not a log
        console.error('[NewBillModal] ' + (d.action ?? 'request') + ' failed', err);
        reply({ ok: false, status: 'error', error: msg, message: msg });
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, vendors, orgId, lockVendor, lockProject]);

  // Reset the header lock whenever the composer (re)opens; the freeze itself is armed by the first
  // Whenever the composer (re)opens, forget any dropdown overflow from a previous open.
  useEffect(() => { if (open) setPop(0); }, [open]);

  if (!open) return null;

  // Inline (Bills page desktop): the iframe FILLS the header's own fixed band (100%), so pressing
  // "Add bill" never changes the header height — the form is laid out to fit inside it. The iframe
  // grows below by `pop` px only while a dropdown is open, so the popover floats over the list
  // unclipped, then snaps back the instant it closes.
  if (inline) {
    return (
      <div style={{ position: 'relative', height: '100%' }}>
        {srcDoc && (
          <iframe
            ref={iframeRef}
            title="Add bill"
            srcDoc={srcDoc}
            onLoad={() => { if (initialFile) iframeRef.current?.contentWindow?.postMessage({ type: 'brik-bill-file', file: initialFile }, '*'); }}
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: pop ? `calc(100% + ${pop}px)` : '100%', border: 0, display: 'block', background: 'transparent' }}
          />
        )}
      </div>
    );
  }

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: stackAbove, background: 'transparent' }}>
      {srcDoc ? (
        <iframe
          ref={iframeRef}
          title="Add bill"
          srcDoc={srcDoc}
          onLoad={() => { if (initialFile) iframeRef.current?.contentWindow?.postMessage({ type: 'brik-bill-file', file: initialFile }, '*'); }}
          style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', border: 0, display: 'block' }}
        />
      ) : (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(20,13,8,.55)' }} onClick={onClose} />
      )}
    </div>,
    document.body,
  );
}
