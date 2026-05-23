import { useState } from 'react';
import { useSelectVendor } from '../hooks/useProcurement';
import type { RFQSummary, RFQQuote } from '../types/procurement';
import { useSnackbar } from './Snackbar';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  rfq: RFQSummary;
  poId: string;
}

function fmtMoney(n: number) {
  if (n >= 100000) return `₹${(n / 100000).toFixed(2)}L`;
  return `₹${n.toLocaleString('en-IN')}`;
}

export default function QuoteComparisonModal({ isOpen, onClose, rfq, poId }: Props) {
  const [selecting, setSelecting] = useState<string | null>(null);
  const selectVendor = useSelectVendor();
  const { show: showSnackbar } = useSnackbar();

  if (!isOpen) return null;

  const received = rfq.rfq_quotes.filter((q) => q.status === 'received' || q.status === 'selected');
  const pending = rfq.rfq_quotes.filter((q) => q.status === 'pending');
  const allItems = rfq.rfq_items;

  const lowestTotal = received.length > 0
    ? Math.min(...received.map((q) => q.total_quoted))
    : null;

  const handleSelect = async (quote: RFQQuote) => {
    setSelecting(quote.id);
    try {
      await selectVendor.mutateAsync({
        quote_id: quote.id,
        rfq_id: rfq.id,
        po_id: poId,
        vendor_id: quote.vendor_id,
      });
      showSnackbar(`${quote.vendor_name} selected — PO is now Ordered!`);
      onClose();
    } catch (err: any) {
      showSnackbar(err.message || 'Failed to select vendor', { type: 'error' });
    } finally {
      setSelecting(null);
    }
  };

  return (
    <>
      <style>{`
        @keyframes modal-in {
          from { opacity: 0; transform: scale(0.97) translateY(8px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>

      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 80,
          background: 'rgba(6,16,28,0.6)',
          backdropFilter: 'blur(4px)',
        }}
      />

      {/* Modal */}
      <div
        style={{
          position: 'fixed', inset: 0, zIndex: 81,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '16px',
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            background: '#fff',
            borderRadius: 24,
            boxShadow: '0 32px 80px rgba(0,0,0,0.22)',
            width: '100%',
            maxWidth: 880,
            maxHeight: '90vh',
            display: 'flex',
            flexDirection: 'column',
            pointerEvents: 'auto',
            animation: 'modal-in 0.25s cubic-bezier(0.34,1.56,0.64,1) both',
          }}
        >
          {/* Modal header */}
          <div style={{
            padding: '20px 24px 16px',
            borderBottom: '1px solid rgba(0,0,0,0.06)',
            display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
            flexShrink: 0,
          }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{
                  fontSize: 10, fontWeight: 700, color: '#C8603A',
                  background: '#FCF7F2', border: '1px solid rgba(200,96,58,0.2)',
                  borderRadius: 6, padding: '2px 7px', letterSpacing: '0.05em',
                }}>
                  COMPARE QUOTES
                </span>
                <span style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', fontWeight: 500 }}>
                  {rfq.rfq_number}
                </span>
              </div>
              <h2 style={{ fontSize: 20, fontWeight: 800, color: '#0b1c30', letterSpacing: '-0.02em' }}>
                {rfq.title}
              </h2>
              <p style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)', marginTop: 2 }}>
                {received.length} quote{received.length !== 1 ? 's' : ''} received
                {pending.length > 0 && ` · ${pending.length} awaiting`}
              </p>
            </div>
            <button
              onClick={onClose}
              style={{
                width: 36, height: 36, borderRadius: '50%',
                background: 'rgba(0,0,0,0.05)', border: 'none',
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'rgba(0,0,0,0.5)',
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>close</span>
            </button>
          </div>

          {received.length === 0 ? (
            <div style={{ padding: '48px 24px', textAlign: 'center' }}>
              <span className="material-symbols-outlined" style={{ fontSize: 40, color: 'rgba(0,0,0,0.2)', display: 'block', marginBottom: 12 }}>
                hourglass_empty
              </span>
              <p style={{ fontSize: 15, fontWeight: 600, color: 'rgba(0,0,0,0.6)' }}>No quotes received yet</p>
              <p style={{ fontSize: 13, color: 'rgba(0,0,0,0.4)', marginTop: 4 }}>
                {pending.length} vendor{pending.length !== 1 ? 's' : ''} yet to respond
              </p>
            </div>
          ) : (
            /* Scrollable comparison table */
            <div style={{ overflowX: 'auto', overflowY: 'auto', flex: 1 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                    {/* Item column header */}
                    <th style={{
                      textAlign: 'left', padding: '10px 24px',
                      fontSize: 10, fontWeight: 700, color: 'rgba(0,0,0,0.4)',
                      textTransform: 'uppercase', letterSpacing: '0.08em',
                      position: 'sticky', left: 0, background: '#fff',
                      minWidth: 160,
                    }}>
                      Item
                    </th>
                    {received.map((q) => {
                      const isLowest = q.total_quoted === lowestTotal && lowestTotal !== null;
                      return (
                        <th key={q.id} style={{
                          textAlign: 'center', padding: '10px 16px',
                          background: isLowest ? '#F0FAF4' : '#FAFAFA',
                          borderLeft: '1px solid rgba(0,0,0,0.05)',
                          minWidth: 160,
                        }}>
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                            <div style={{
                              width: 30, height: 30, borderRadius: 10,
                              background: isLowest ? '#D1FAE5' : '#F0F0F5',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontSize: 11, fontWeight: 800, color: isLowest ? '#065F46' : '#515154',
                              marginBottom: 2,
                            }}>
                              {q.vendor_name.slice(0, 2).toUpperCase()}
                            </div>
                            <p style={{ fontSize: 12, fontWeight: 700, color: '#0b1c30' }}>{q.vendor_name}</p>
                            {q.vendor_category && (
                              <p style={{ fontSize: 10, color: 'rgba(0,0,0,0.4)' }}>{q.vendor_category}</p>
                            )}
                            {isLowest && (
                              <span style={{
                                fontSize: 9, fontWeight: 700, color: '#059669',
                                background: '#D1FAE5', borderRadius: 100,
                                padding: '1px 7px', letterSpacing: '0.04em',
                              }}>
                                LOWEST
                              </span>
                            )}
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {/* Per-item rows */}
                  {allItems.map((item, iIdx) => (
                    <tr key={item.id} style={{ borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                      <td style={{
                        padding: '10px 24px',
                        fontSize: 12, fontWeight: 500, color: '#0b1c30',
                        position: 'sticky', left: 0, background: iIdx % 2 === 0 ? '#fff' : '#FAFAFA',
                      }}>
                        <p style={{ fontWeight: 600 }}>{item.material}</p>
                        <p style={{ fontSize: 10, color: 'rgba(0,0,0,0.4)', marginTop: 1 }}>
                          {item.qty} {item.unit}
                        </p>
                      </td>
                      {received.map((q) => {
                        const rateRow = q.rates.find((r) => r.rfq_item_id === item.id);
                        const lineTotal = rateRow ? rateRow.rate * item.qty : null;
                        return (
                          <td key={q.id} style={{
                            textAlign: 'center', padding: '10px 16px',
                            borderLeft: '1px solid rgba(0,0,0,0.05)',
                            background: iIdx % 2 === 0 ? (q.total_quoted === lowestTotal ? '#F0FAF4' : '#fff') : (q.total_quoted === lowestTotal ? '#EBFAF2' : '#FAFAFA'),
                          }}>
                            {rateRow ? (
                              <>
                                <p style={{ fontSize: 13, fontWeight: 700, color: '#0b1c30', fontVariantNumeric: 'tabular-nums' }}>
                                  ₹{rateRow.rate.toLocaleString('en-IN')}
                                </p>
                                <p style={{ fontSize: 10, color: 'rgba(0,0,0,0.4)', marginTop: 1 }}>
                                  {lineTotal ? fmtMoney(lineTotal) : ''} total
                                </p>
                                {rateRow.delivery_days > 0 && (
                                  <p style={{ fontSize: 9.5, color: 'rgba(0,0,0,0.35)', marginTop: 1 }}>
                                    {rateRow.delivery_days}d delivery
                                  </p>
                                )}
                              </>
                            ) : (
                              <span style={{ color: 'rgba(0,0,0,0.2)', fontSize: 16 }}>—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}

                  {/* Total row */}
                  <tr style={{ borderTop: '2px solid rgba(0,0,0,0.08)' }}>
                    <td style={{
                      padding: '12px 24px',
                      fontSize: 12, fontWeight: 700, color: 'rgba(0,0,0,0.5)',
                      textTransform: 'uppercase', letterSpacing: '0.05em',
                      position: 'sticky', left: 0, background: '#fff',
                    }}>
                      Grand Total
                    </td>
                    {received.map((q) => {
                      const isLowest = q.total_quoted === lowestTotal;
                      return (
                        <td key={q.id} style={{
                          textAlign: 'center', padding: '12px 16px',
                          borderLeft: '1px solid rgba(0,0,0,0.05)',
                          background: isLowest ? '#F0FAF4' : '#fff',
                        }}>
                          <p style={{
                            fontSize: 18, fontWeight: 800,
                            color: isLowest ? '#065F46' : '#0b1c30',
                            fontVariantNumeric: 'tabular-nums',
                            letterSpacing: '-0.02em',
                          }}>
                            {fmtMoney(q.total_quoted)}
                          </p>
                          {q.validity_date && (
                            <p style={{ fontSize: 10, color: 'rgba(0,0,0,0.4)', marginTop: 2 }}>
                              Valid till {new Date(q.validity_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                            </p>
                          )}
                        </td>
                      );
                    })}
                  </tr>

                  {/* Select row */}
                  <tr>
                    <td style={{ padding: '12px 24px', position: 'sticky', left: 0, background: '#fff' }} />
                    {received.map((q) => {
                      const alreadySelected = rfq.selected_quote_id === q.id;
                      const isLowest = q.total_quoted === lowestTotal;
                      const isSelecting = selecting === q.id;
                      return (
                        <td key={q.id} style={{
                          textAlign: 'center', padding: '12px 16px',
                          borderLeft: '1px solid rgba(0,0,0,0.05)',
                          background: isLowest ? '#F0FAF4' : '#fff',
                        }}>
                          {alreadySelected ? (
                            <span style={{
                              display: 'inline-flex', alignItems: 'center', gap: 5,
                              fontSize: 11, fontWeight: 700, color: '#059669',
                              background: '#D1FAE5', borderRadius: 10, padding: '5px 12px',
                            }}>
                              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>check_circle</span>
                              Selected
                            </span>
                          ) : (
                            <button
                              onClick={() => handleSelect(q)}
                              disabled={isSelecting || selectVendor.isPending}
                              style={{
                                height: 36, paddingInline: 16, borderRadius: 10,
                                background: isLowest ? '#0b1c30' : 'transparent',
                                color: isLowest ? '#fff' : '#0b1c30',
                                border: isLowest ? 'none' : '1.5px solid rgba(0,0,0,0.15)',
                                fontSize: 12, fontWeight: 700, cursor: 'pointer',
                                transition: 'all 0.15s',
                                display: 'inline-flex', alignItems: 'center', gap: 5,
                                opacity: isSelecting ? 0.6 : 1,
                              }}
                            >
                              {isSelecting ? 'Selecting…' : 'Select Vendor'}
                            </button>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* Footer note */}
          {pending.length > 0 && received.length > 0 && (
            <div style={{
              padding: '10px 24px',
              borderTop: '1px solid rgba(0,0,0,0.05)',
              background: '#FAFAFA',
              flexShrink: 0,
            }}>
              <p style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)' }}>
                <span className="material-symbols-outlined" style={{ fontSize: 12, verticalAlign: 'middle', marginRight: 4 }}>info</span>
                {pending.length} vendor{pending.length !== 1 ? 's' : ''} yet to respond — selecting a vendor now will finalise the PO.
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
