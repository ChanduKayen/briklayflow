/**
 * CertificationWizard — the accountable "certify work" flow. Reusable: mounted from the attendance
 * sheet (a day/week cell on a contract/measurement stage) and from the party page. Keeps the familiar
 * slider as step 1, shows the ₹ the reading asserts, captures a date + note (+ optional evidence), and
 * submits through submit_work_certification — which auto-approves within the submitter's authority or
 * routes to the project's Works Approver (project-first, member-fallback). Only APPROVED becomes a payable.
 */
import { useMemo, useState } from 'react';
import { V, font } from '../txn-ledger/ledgerTokens';
import {
  submitWorkCertification, computeCertAmount, type CertifyResult,
} from '../../lib/workCertification';

const inr = (n: number) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');

export interface CertifyContext {
  orgId: string; projectId: string | null; projectName?: string;
  woId: string | null; milestoneId: string | null;
  crewId: string | null; stakeholderId: string | null; partyName?: string;
  milestoneName: string;
  kind: 'lump' | 'measured' | 'piece';
  planned: number;      // lump: contract ₹ for this milestone; measured: unused
  rate: number;         // measured: ₹ per unit; lump: unused
  unit?: string;        // measured unit label
  priorReading?: number; // lump: the last certified %; measured: cumulative qty so far (context only)
}

export function CertificationWizard({ ctx, onClose, onDone, onReading }: {
  ctx: CertifyContext; onClose: () => void; onDone: (r: CertifyResult) => void;
  // Persist the raw reading for the muster grid + progress bar (display-only; the obligation is the
  // certification). Called on a successful submit with the entered reading + its date.
  onReading?: (value: number, date: string) => void;
}) {
  const [step, setStep] = useState<'reading' | 'confirm' | 'busy' | 'done'>('reading');
  const [reading, setReading] = useState<number>(ctx.kind === 'lump' ? (ctx.priorReading ?? 0) : 0);
  const [date, setDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<CertifyResult | null>(null);

  // For a lump milestone the reading is the NEW cumulative %; the credit is the delta over prior.
  const amount = useMemo(() => {
    if (ctx.kind === 'lump') {
      const full = computeCertAmount('lump', reading, ctx.planned, 0);
      const prior = computeCertAmount('lump', ctx.priorReading ?? 0, ctx.planned, 0);
      return Math.max(0, full - prior);
    }
    return computeCertAmount(ctx.kind, reading, 0, ctx.rate);
  }, [ctx, reading]);

  const submit = async () => {
    setStep('busy'); setErr(null);
    try {
      const r = await submitWorkCertification({
        orgId: ctx.orgId, projectId: ctx.projectId, woId: ctx.woId, milestoneId: ctx.milestoneId,
        crewId: ctx.crewId, stakeholderId: ctx.stakeholderId,
        readingKind: ctx.kind, readingValue: reading, computedAmount: amount, readingDate: date, note,
      });
      try { onReading?.(reading, date); } catch { /* display-only, never block the certification */ }
      setResult(r); setStep('done'); onDone(r);
      window.setTimeout(onClose, 1400);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not submit'); setStep('confirm'); }
  };

  return (
    <div style={{ ...font, position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(20,16,12,0.42)', display: 'grid', placeItems: 'center', padding: 16 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(440px,100%)', background: V.surface, border: `1px solid ${V.line}`, borderRadius: 16, overflow: 'hidden', boxShadow: '0 24px 60px -20px rgba(20,16,12,0.5)' }}>
        {/* header */}
        <div style={{ padding: '16px 18px 12px', borderBottom: `1px solid ${V.line}` }}>
          <p style={{ fontSize: 15, fontWeight: 700, color: V.ink }}>Certify work</p>
          <p style={{ fontSize: 12.5, color: V.sys, marginTop: 2 }}>
            {ctx.milestoneName}{ctx.partyName ? ` · ${ctx.partyName}` : ''}{ctx.projectName ? ` · ${ctx.projectName}` : ''}
          </p>
        </div>

        <div style={{ padding: '16px 18px' }}>
          {(step === 'reading') && (
            <>
              {ctx.kind === 'lump' && (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <span style={{ fontSize: 13, color: V.sys }}>Progress</span>
                    <span style={{ fontSize: 22, fontWeight: 700, color: V.terraDeep }}>{Math.round(reading)}%</span>
                  </div>
                  <input type="range" min={ctx.priorReading ?? 0} max={100} value={reading} onChange={(e) => setReading(Number(e.target.value))}
                    style={{ width: '100%', marginTop: 8, accentColor: V.terra }} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: V.faint, marginTop: 2 }}>
                    <span>was {Math.round(ctx.priorReading ?? 0)}%</span><span>100%</span>
                  </div>
                </>
              )}
              {ctx.kind === 'measured' && (
                <>
                  <span style={{ fontSize: 13, color: V.sys }}>Quantity done{ctx.unit ? ` (${ctx.unit})` : ''}</span>
                  <input inputMode="decimal" value={reading || ''} onChange={(e) => setReading(parseFloat(e.target.value.replace(/[^\d.]/g, '')) || 0)}
                    placeholder="0" style={{ width: '100%', marginTop: 6, padding: '10px 12px', borderRadius: 10, border: `1px solid ${V.line}`, fontSize: 16, color: V.ink, outline: 'none' }} />
                  <p style={{ fontSize: 11.5, color: V.faint, marginTop: 4 }}>at {inr(ctx.rate)} / {ctx.unit || 'unit'}</p>
                </>
              )}
              {ctx.kind === 'piece' && (
                <>
                  <span style={{ fontSize: 13, color: V.sys }}>Amount for this job (₹)</span>
                  <input inputMode="numeric" value={reading || ''} onChange={(e) => setReading(parseFloat(e.target.value.replace(/[^\d.]/g, '')) || 0)}
                    placeholder="0" style={{ width: '100%', marginTop: 6, padding: '10px 12px', borderRadius: 10, border: `1px solid ${V.line}`, fontSize: 16, color: V.ink, outline: 'none' }} />
                </>
              )}
              <div style={{ marginTop: 14, padding: '10px 12px', borderRadius: 10, background: V.sageWash, border: `1px solid ${V.sage}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12.5, color: V.sage }}>Certifies</span>
                <span style={{ fontSize: 18, fontWeight: 700, color: V.sage }}>{inr(amount)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
                <button onClick={onClose} style={{ fontSize: 13, color: V.sys, background: 'none', border: 0, cursor: 'pointer' }}>Cancel</button>
                <button disabled={amount <= 0} onClick={() => setStep('confirm')}
                  style={{ fontSize: 13, fontWeight: 600, color: '#fff', background: amount > 0 ? V.terra : V.line, border: 0, borderRadius: 999, padding: '8px 16px', cursor: amount > 0 ? 'pointer' : 'default' }}>
                  Next
                </button>
              </div>
            </>
          )}

          {(step === 'confirm' || step === 'busy') && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
                <span style={{ fontSize: 13, color: V.sys }}>Certifying</span>
                <span style={{ fontSize: 20, fontWeight: 700, color: V.terraDeep }}>{inr(amount)}</span>
              </div>
              <label style={{ fontSize: 12, color: V.faint }}>Date of the reading</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
                style={{ width: '100%', marginTop: 4, padding: '9px 11px', borderRadius: 10, border: `1px solid ${V.line}`, fontSize: 14, color: V.ink, outline: 'none' }} />
              <label style={{ fontSize: 12, color: V.faint, display: 'block', marginTop: 10 }}>Note (optional)</label>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="e.g. 2nd-floor slab measured with the site engineer"
                style={{ width: '100%', marginTop: 4, padding: '9px 11px', borderRadius: 10, border: `1px solid ${V.line}`, fontSize: 13.5, color: V.ink, outline: 'none', resize: 'none' }} />
              {err && <p style={{ fontSize: 12.5, color: V.terra, marginTop: 8 }}>{err}</p>}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
                <button onClick={() => setStep('reading')} disabled={step === 'busy'} style={{ fontSize: 13, color: V.sys, background: 'none', border: 0, cursor: 'pointer' }}>Back</button>
                <button onClick={submit} disabled={step === 'busy'}
                  style={{ fontSize: 13, fontWeight: 600, color: '#fff', background: V.terra, border: 0, borderRadius: 999, padding: '8px 16px', cursor: 'pointer' }}>
                  {step === 'busy' ? 'Submitting…' : 'Submit certification'}
                </button>
              </div>
            </>
          )}

          {step === 'done' && result && (
            <div style={{ textAlign: 'center', padding: '10px 0' }}>
              <div style={{ fontSize: 30 }}>{result.status === 'approved' ? '✓' : '⏳'}</div>
              <p style={{ fontSize: 15, fontWeight: 700, color: result.status === 'approved' ? V.sage : V.ask, marginTop: 4 }}>
                {result.status === 'approved' ? 'Certified' : 'Sent for approval'}
              </p>
              <p style={{ fontSize: 12.5, color: V.sys, marginTop: 4 }}>
                {result.status === 'approved'
                  ? `${inr(amount)} added to what's owed.`
                  : `${inr(amount)} awaits the Works Approver — it becomes payable once approved.`}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
