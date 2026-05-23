import { useState, useEffect } from 'react';
import { useSubmitQuote } from '../hooks/useProcurement';
import type { RFQQuote, RFQItem, QuoteRate } from '../types/procurement';
import { useSnackbar } from './Snackbar';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  quote: RFQQuote;
  rfqItems: RFQItem[];
  rfqId: string;
}

interface RateRow {
  rfq_item_id: string;
  material: string;
  qty: number;
  unit: string;
  rate: string;
  available_qty: string;
  delivery_days: string;
}

export default function QuoteEntryDrawer({ isOpen, onClose, quote, rfqItems, rfqId }: Props) {
  const [mounted, setMounted] = useState(false);
  const [closing, setClosing] = useState(false);
  const [rows, setRows] = useState<RateRow[]>([]);
  const [validity, setValidity] = useState('');
  const [terms, setTerms] = useState('');

  const submitQuote = useSubmitQuote();
  const { show: showSnackbar } = useSnackbar();

  useEffect(() => {
    if (isOpen) {
      setMounted(true);
      setClosing(false);
      const existing = new Map((quote.rates ?? []).map((r) => [r.rfq_item_id, r]));
      setRows(
        rfqItems.map((item) => {
          const ex = existing.get(item.id);
          return {
            rfq_item_id: item.id,
            material: item.material,
            qty: item.qty,
            unit: item.unit,
            rate: ex ? String(ex.rate) : '',
            available_qty: ex ? String(ex.available_qty) : String(item.qty),
            delivery_days: ex ? String(ex.delivery_days) : '',
          };
        })
      );
      setValidity(quote.validity_date ?? '');
      setTerms(quote.terms ?? '');
    }
  }, [isOpen, rfqItems, quote]);

  const handleClose = () => {
    setClosing(true);
    setTimeout(() => { setMounted(false); setClosing(false); onClose(); }, 340);
  };

  const updateRow = (idx: number, patch: Partial<RateRow>) =>
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

  const totalQuoted = rows.reduce((sum, r) => {
    const rate = parseFloat(r.rate) || 0;
    const qty = r.qty;
    return sum + rate * qty;
  }, 0);

  const canSubmit = rows.some((r) => parseFloat(r.rate) > 0);

  const handleSubmit = async () => {
    const rates: QuoteRate[] = rows
      .filter((r) => parseFloat(r.rate) > 0)
      .map((r) => ({
        rfq_item_id: r.rfq_item_id,
        rate: parseFloat(r.rate),
        available_qty: parseFloat(r.available_qty) || r.qty,
        delivery_days: parseInt(r.delivery_days) || 0,
      }));

    try {
      await submitQuote.mutateAsync({
        quote_id: quote.id,
        rfq_id: rfqId,
        rates,
        total_quoted: totalQuoted,
        validity_date: validity || null,
        terms: terms || null,
      });
      showSnackbar(`Quote from ${quote.vendor_name} submitted!`);
      handleClose();
    } catch (err: any) {
      showSnackbar(err.message || 'Failed to submit quote', { type: 'error' });
    }
  };

  if (!mounted && !isOpen) return null;

  const sheetVisible = mounted && !closing;

  return (
    <>
      <style>{`
        @keyframes qed-backdrop-in { from { opacity:0 } to { opacity:1 } }
      `}</style>

      {/* Backdrop */}
      <div
        onClick={handleClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 49,
          background: 'rgba(6,16,28,0.55)',
          backdropFilter: 'blur(2px)',
          opacity: sheetVisible ? 1 : 0,
          transition: 'opacity 0.3s ease',
        }}
      />

      {/* Sheet */}
      <div
        style={{
          position: 'fixed', bottom: 0, left: 0, right: 0,
          zIndex: 50,
          background: '#F8F9FC',
          borderRadius: '22px 22px 0 0',
          maxHeight: '92vh',
          display: 'flex', flexDirection: 'column',
          transform: sheetVisible ? 'translateY(0)' : 'translateY(100%)',
          transition: 'transform 0.38s cubic-bezier(0.32,0.72,0,1)',
          boxShadow: '0 -8px 40px rgba(0,0,0,0.18)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          background: 'linear-gradient(160deg, #0e2236 0%, #0b1c30 100%)',
          padding: '10px 16px 18px',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10 }}>
            <div style={{ width: 36, height: 4, borderRadius: 99, background: 'rgba(255,255,255,0.18)' }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
                <span style={{
                  background: 'rgba(200,96,58,0.25)', border: '1px solid rgba(200,96,58,0.4)',
                  borderRadius: 8, padding: '2px 8px',
                  fontSize: 10, fontWeight: 700, color: '#FBA07A',
                  letterSpacing: '0.04em', fontFamily: 'monospace',
                }}>
                  QUOTE ENTRY
                </span>
              </div>
              <p style={{ fontSize: 20, fontWeight: 800, color: '#fff', letterSpacing: '-0.02em', lineHeight: 1.2 }}>
                {quote.vendor_name}
              </p>
              <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 3 }}>
                {quote.vendor_category ?? 'Vendor'} · Enter rates per item
              </p>
            </div>
            <button
              onClick={handleClose}
              style={{
                width: 32, height: 32, borderRadius: '50%',
                background: 'rgba(255,255,255,0.10)',
                border: '1px solid rgba(255,255,255,0.15)',
                cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'rgba(255,255,255,0.7)',
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>close</span>
            </button>
          </div>
        </div>

        {/* Scrollable content */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '16px 16px 0' }}>
          {/* Rate rows */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
            {rows.map((row, idx) => {
              const hasRate = parseFloat(row.rate) > 0;
              const lineTotal = (parseFloat(row.rate) || 0) * row.qty;
              return (
                <div key={row.rfq_item_id} style={{
                  background: hasRate ? '#fff' : '#F9FAFB',
                  border: `1.5px solid ${hasRate ? 'rgba(200,96,58,0.20)' : 'rgba(0,0,0,0.07)'}`,
                  borderRadius: 16,
                  padding: '12px 14px',
                  transition: 'all 0.2s',
                }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 13, fontWeight: 600, color: '#0b1c30', marginBottom: 2 }}>{row.material}</p>
                      <p style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)' }}>
                        {row.qty} {row.unit}
                      </p>
                    </div>
                    {hasRate && (
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <p style={{ fontSize: 12, fontWeight: 700, color: '#0b1c30', fontVariantNumeric: 'tabular-nums' }}>
                          ₹{lineTotal.toLocaleString('en-IN')}
                        </p>
                        <p style={{ fontSize: 10, color: 'rgba(0,0,0,0.35)' }}>total</p>
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: 8 }}>
                    {/* Rate */}
                    <div style={{ flex: '0 0 100px' }}>
                      <label style={{ fontSize: 10, fontWeight: 600, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 4 }}>
                        Rate / {row.unit}
                      </label>
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: 4,
                        background: '#fff', border: `1.5px solid ${hasRate ? 'rgba(200,96,58,0.3)' : 'rgba(0,0,0,0.1)'}`,
                        borderRadius: 10, padding: '0 8px', height: 38,
                        transition: 'border-color 0.15s',
                      }}>
                        <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)', fontWeight: 600 }}>₹</span>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={row.rate}
                          onChange={(e) => updateRow(idx, { rate: e.target.value })}
                          placeholder="0.00"
                          style={{
                            flex: 1, border: 'none', outline: 'none', background: 'transparent',
                            fontSize: 14, fontWeight: 700, color: '#0b1c30',
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        />
                      </div>
                    </div>

                    {/* Available qty */}
                    <div style={{ flex: '0 0 76px' }}>
                      <label style={{ fontSize: 10, fontWeight: 600, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 4 }}>
                        Avail.
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={row.available_qty}
                        onChange={(e) => updateRow(idx, { available_qty: e.target.value })}
                        style={{
                          width: '100%', height: 38, borderRadius: 10,
                          border: '1.5px solid rgba(0,0,0,0.1)',
                          padding: '0 8px', fontSize: 13, fontWeight: 600,
                          color: '#0b1c30', background: '#fff', outline: 'none',
                          boxSizing: 'border-box',
                        }}
                      />
                    </div>

                    {/* Delivery days */}
                    <div style={{ flex: '0 0 68px' }}>
                      <label style={{ fontSize: 10, fontWeight: 600, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 4 }}>
                        Days
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={row.delivery_days}
                        onChange={(e) => updateRow(idx, { delivery_days: e.target.value })}
                        placeholder="—"
                        style={{
                          width: '100%', height: 38, borderRadius: 10,
                          border: '1.5px solid rgba(0,0,0,0.1)',
                          padding: '0 8px', fontSize: 13, fontWeight: 600,
                          color: '#0b1c30', background: '#fff', outline: 'none',
                          boxSizing: 'border-box',
                        }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Validity + Terms */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.5)', display: 'block', marginBottom: 5 }}>
                Quote valid until
              </label>
              <input
                type="date"
                value={validity}
                onChange={(e) => setValidity(e.target.value)}
                style={{
                  width: '100%', height: 40, borderRadius: 12,
                  border: '1.5px solid rgba(0,0,0,0.1)',
                  padding: '0 10px', fontSize: 13, color: '#0b1c30',
                  background: '#fff', outline: 'none', boxSizing: 'border-box',
                }}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.5)', display: 'block', marginBottom: 5 }}>
                Payment terms
              </label>
              <input
                type="text"
                value={terms}
                onChange={(e) => setTerms(e.target.value)}
                placeholder="e.g. Net 30"
                style={{
                  width: '100%', height: 40, borderRadius: 12,
                  border: '1.5px solid rgba(0,0,0,0.1)',
                  padding: '0 10px', fontSize: 13, color: '#0b1c30',
                  background: '#fff', outline: 'none', boxSizing: 'border-box',
                }}
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: '14px 16px 24px',
          background: '#fff',
          borderTop: '1px solid rgba(0,0,0,0.06)',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div>
              <p style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Total Quoted
              </p>
              <p style={{ fontSize: 22, fontWeight: 800, color: '#0b1c30', fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em' }}>
                ₹{totalQuoted.toLocaleString('en-IN')}
              </p>
            </div>
            <button
              onClick={handleSubmit}
              disabled={!canSubmit || submitQuote.isPending}
              style={{
                height: 48, paddingInline: 28, borderRadius: 14,
                background: canSubmit ? '#0b1c30' : 'rgba(0,0,0,0.08)',
                color: canSubmit ? '#fff' : 'rgba(0,0,0,0.3)',
                fontSize: 14, fontWeight: 700, border: 'none', cursor: canSubmit ? 'pointer' : 'not-allowed',
                transition: 'all 0.2s',
                display: 'flex', alignItems: 'center', gap: 8,
              }}
            >
              {submitQuote.isPending ? (
                <span style={{ opacity: 0.7 }}>Saving…</span>
              ) : (
                <>
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>send</span>
                  Submit Quote
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
