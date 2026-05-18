import { useState, useEffect, useRef } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

// ── Types ─────────────────────────────────────────────────────────────────────

interface LineItemProp {
  id: string;
  item_name: string;
  unit: string;
  quantity_ordered: number;
  unit_rate: number;
  qty_received_so_far: number;
}

interface POProp {
  po_id: string;
  org_id: string;
  project_id: string;
  stakeholder_id: string;
  stakeholder_name: string;
  line_items: LineItemProp[];
}

interface DrawerItem extends LineItemProp {
  qty_this_delivery: number;
  condition: 'good' | 'damaged' | 'rejected';
  item_remarks: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (grnId: string) => void;
  po: POProp;
  session: Session;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const todayStr = () => new Date().toISOString().split('T')[0];



function autoDC() {
  const d = new Date();
  const yy = String(d.getFullYear()).slice(2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const seq = String(Math.floor(Math.random() * 9000) + 1000);
  return `DC-${yy}${mm}${dd}-${seq}`;
}

// ── ItemCard ──────────────────────────────────────────────────────────────────

function ItemCard({
  item, idx, updateItem, animDelay,
}: {
  item: DrawerItem;
  idx: number;
  updateItem: (idx: number, patch: Partial<DrawerItem>) => void;
  animDelay: number;
}) {
  const pendingQty   = Math.max(0, item.quantity_ordered - item.qty_received_so_far);
  const isActive     = item.qty_this_delivery > 0;
  const inputRef     = useRef<HTMLInputElement>(null);

  const step = (delta: number) => {
    const next = Math.max(0, Math.min(item.quantity_ordered, (item.qty_this_delivery || 0) + delta));
    updateItem(idx, { qty_this_delivery: next });
  };

  const COND = [
    { key: 'good',     label: '✓ Good',    bg: '#DCFCE7', ring: '#86EFAC', text: '#15803D' },
    { key: 'damaged',  label: '⚠ Damaged', bg: '#FEF9C3', ring: '#FDE047', text: '#A16207' },
    { key: 'rejected', label: '✕ Rejected',bg: '#FEE2E2', ring: '#FCA5A5', text: '#B91C1C' },
  ] as const;

  return (
    <div
      style={{
        background: isActive ? '#fff' : '#F9FAFB',
        border: `1.5px solid ${isActive ? 'rgba(200,96,58,0.20)' : 'rgba(0,0,0,0.07)'}`,
        borderRadius: 18,
        padding: '14px 14px 12px',
        transition: 'all 0.2s cubic-bezier(0.4,0,0.2,1)',
        boxShadow: isActive ? '0 2px 12px rgba(200,96,58,0.08)' : 'none',
        animation: `item-card-in 0.3s cubic-bezier(0.34,1.56,0.64,1) ${animDelay}ms both`,
      }}
    >
      {/* Item name + qty stepper */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: '#0b1c30', lineHeight: 1.35, marginBottom: 3 }}>
            {item.item_name}
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ fontSize: 10.5, color: 'rgba(0,0,0,0.38)' }}>
              Ordered <strong style={{ color: 'rgba(0,0,0,0.55)' }}>{item.quantity_ordered}</strong> {item.unit}
            </span>
            {pendingQty < item.quantity_ordered && pendingQty > 0 && (
              <>
                <span style={{ color: 'rgba(0,0,0,0.2)', fontSize: 10 }}>·</span>
                <span style={{ fontSize: 10.5, color: '#D97706', fontWeight: 500 }}>
                  Pending {pendingQty}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Stepper */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 0,
            background: isActive ? '#FFF7F4' : '#F3F4F6',
            borderRadius: 14,
            border: `1.5px solid ${isActive ? 'rgba(200,96,58,0.25)' : 'rgba(0,0,0,0.08)'}`,
            overflow: 'hidden',
            transition: 'all 0.2s ease',
          }}>
            <button
              onClick={() => step(-1)}
              style={{
                width: 36, height: 44, fontSize: 20, fontWeight: 300,
                color: item.qty_this_delivery > 0 ? '#C8603A' : 'rgba(0,0,0,0.25)',
                background: 'transparent', border: 'none', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'color 0.15s',
              }}
            >−</button>
            <input
              ref={inputRef}
              type="number"
              min={0}
              max={item.quantity_ordered}
              value={item.qty_this_delivery || ''}
              onChange={e => updateItem(idx, { qty_this_delivery: parseFloat(e.target.value) || 0 })}
              placeholder="0"
              style={{
                width: 46, height: 44, textAlign: 'center',
                fontSize: 17, fontWeight: 700, color: '#0b1c30',
                background: 'transparent', border: 'none', outline: 'none',
                fontVariantNumeric: 'tabular-nums',
              }}
            />
            <button
              onClick={() => step(1)}
              style={{
                width: 36, height: 44, fontSize: 20, fontWeight: 300,
                color: item.qty_this_delivery < item.quantity_ordered ? '#C8603A' : 'rgba(0,0,0,0.25)',
                background: 'transparent', border: 'none', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'color 0.15s',
              }}
            >+</button>
          </div>
          <span style={{ fontSize: 9.5, color: 'rgba(0,0,0,0.30)', paddingRight: 2 }}>
            of {item.quantity_ordered} {item.unit}
          </span>
        </div>
      </div>

      {/* Condition pills */}
      <div style={{ display: 'flex', gap: 6 }}>
        {COND.map(c => {
          const active = item.condition === c.key;
          return (
            <button
              key={c.key}
              onClick={() => updateItem(idx, { condition: c.key })}
              style={{
                height: 28, paddingInline: 11, borderRadius: 100,
                fontSize: 11, fontWeight: active ? 600 : 500,
                background: active ? c.bg : 'transparent',
                color:  active ? c.text : 'rgba(0,0,0,0.38)',
                border: `1.5px solid ${active ? c.ring : 'rgba(0,0,0,0.10)'}`,
                cursor: 'pointer',
                transition: 'all 0.15s cubic-bezier(0.4,0,0.2,1)',
                transform: active ? 'scale(1.03)' : 'scale(1)',
              }}
            >
              {c.label}
            </button>
          );
        })}
      </div>

      {/* Remarks — only shown for non-good */}
      {item.condition !== 'good' && (
        <div style={{
          marginTop: 8,
          animation: 'detail-reveal-in 180ms ease-out both',
        }}>
          <input
            type="text"
            value={item.item_remarks}
            onChange={e => updateItem(idx, { item_remarks: e.target.value })}
            placeholder="Describe the issue…"
            style={{
              width: '100%', height: 36, paddingInline: 12,
              fontSize: 12, color: '#0b1c30',
              background: '#FFFBF7', borderRadius: 10,
              border: '1.5px solid rgba(253,186,116,0.5)',
              outline: 'none', boxSizing: 'border-box',
            }}
          />
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ReceiveAtSiteDrawer({ isOpen, onClose, onSuccess, po, session }: Props) {
  const [mounted,       setMounted]       = useState(false);
  const [closing,       setClosing]       = useState(false);

  const [receiptDate,   setReceiptDate]   = useState<string>(todayStr);
  const [dcMode,        setDcMode]        = useState<'auto' | 'manual'>('auto');
  const [dcAuto,        setDcAuto]        = useState<string>(() => autoDC());
  const [dcManual,      setDcManual]      = useState('');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [driverName,    setDriverName]    = useState('');
  const [remarks,       setRemarks]       = useState('');
  const [showTransport, setShowTransport] = useState(false);

  const [items,         setItems]         = useState<DrawerItem[]>(() =>
    po.line_items.map(li => ({
      ...li,
      qty_this_delivery: 0,
      condition:         'good',
      item_remarks:      '',
    }))
  );

  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  const dcNumber = dcMode === 'auto' ? dcAuto : dcManual;
  const activeCount = items.filter(i => i.qty_this_delivery > 0).length;

  // ── Animate in/out ───────────────────────────────────────────────────────

  useEffect(() => {
    if (isOpen) {
      setClosing(false);
      requestAnimationFrame(() => requestAnimationFrame(() => setMounted(true)));
    }
  }, [isOpen]);

  const handleClose = () => {
    setClosing(true);
    setTimeout(onClose, 340);
  };

  // ── Submit ───────────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    if (activeCount === 0) { setError('Enter quantity for at least one item'); return; }
    setError(null);
    setSubmitting(true);

    const { data, error: rpcError } = await supabase
      .rpc('create_grn', {
        p_org_id:         po.org_id,
        p_po_id:          po.po_id,
        p_project_id:     po.project_id,
        p_stakeholder_id: po.stakeholder_id,
        p_receipt_date:   receiptDate,
        p_dc_number:      dcNumber || null,
        p_vehicle_number: vehicleNumber || null,
        p_driver_name:    driverName || null,
        p_remarks:        remarks || null,
        p_received_by:    session.user.id,
        p_items:          items
          .filter(i => i.qty_this_delivery > 0)
          .map(i => ({
            po_line_item_id: i.id,
            item_name:       i.item_name,
            unit:            i.unit,
            qty_ordered:     i.quantity_ordered,
            qty_received:    i.qty_this_delivery,
            unit_rate:       i.unit_rate,
            condition:       i.condition,
            remarks:         i.item_remarks || null,
          })),
      })
      .single();

    setSubmitting(false);

    if (rpcError || !(data as any)?.success) {
      setError((data as any)?.error ?? rpcError?.message ?? 'Failed to save receipt');
      return;
    }

    onSuccess((data as any).grn_id);
  };

  const updateItem = (idx: number, patch: Partial<DrawerItem>) =>
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, ...patch } : it));

  if (!isOpen && !closing) return null;

  const sheetVisible = mounted && !closing;

  return (
    <>
      <style>{`
        @keyframes item-card-in {
          from { opacity: 0; transform: translateY(10px) scale(0.98); }
          to   { opacity: 1; transform: translateY(0)    scale(1);    }
        }
        @keyframes drawer-backdrop-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
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
          animation: 'drawer-backdrop-in 0.3s ease both',
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
          boxShadow: '0 -8px 40px rgba(0,0,0,0.18), 0 -1px 0 rgba(0,0,0,0.06)',
          overflow: 'hidden',
        }}
      >
        {/* ── Dark header ─────────────────────────────────────────────── */}
        <div style={{
          background: 'linear-gradient(160deg, #0e2236 0%, #0b1c30 100%)',
          padding: '10px 16px 18px',
          flexShrink: 0,
        }}>
          {/* Drag handle */}
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10 }}>
            <div style={{
              width: 36, height: 4, borderRadius: 99,
              background: 'rgba(255,255,255,0.18)',
            }} />
          </div>

          {/* Header row */}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
                <span style={{
                  background: 'rgba(200,96,58,0.25)', border: '1px solid rgba(200,96,58,0.4)',
                  borderRadius: 8, padding: '2px 8px',
                  fontSize: 10, fontWeight: 700, color: '#FBA07A',
                  letterSpacing: '0.04em', fontFamily: 'monospace',
                }}>
                  {po.po_id}
                </span>
              </div>
              <p style={{
                fontSize: 20, fontWeight: 800, color: '#fff',
                letterSpacing: '-0.02em', lineHeight: 1.2,
                fontFamily: 'Manrope, sans-serif',
              }}>
                Receive at site
              </p>
              <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 3 }}>
                {po.stakeholder_name}
              </p>
            </div>

            <button
              onClick={handleClose}
              style={{
                width: 32, height: 32, borderRadius: '50%',
                background: 'rgba(255,255,255,0.10)',
                border: '1px solid rgba(255,255,255,0.15)',
                cursor: 'pointer', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'rgba(255,255,255,0.7)',
                transition: 'background 0.15s',
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>close</span>
            </button>
          </div>

          {/* Date + item count row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: 'rgba(255,255,255,0.08)',
              borderRadius: 10, padding: '5px 10px',
              border: '1px solid rgba(255,255,255,0.10)',
            }}>
              <span className="material-symbols-outlined" style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>
                calendar_today
              </span>
              <input
                type="date"
                value={receiptDate}
                onChange={e => setReceiptDate(e.target.value)}
                style={{
                  background: 'transparent', border: 'none', outline: 'none',
                  fontSize: 12, fontWeight: 500, color: '#fff',
                  cursor: 'pointer', colorScheme: 'dark',
                  width: 120,
                }}
              />
            </div>
            {activeCount > 0 && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 5,
                background: 'rgba(200,96,58,0.2)',
                border: '1px solid rgba(200,96,58,0.35)',
                borderRadius: 10, padding: '5px 10px',
                animation: 'item-card-in 0.2s ease both',
              }}>
                <span className="material-symbols-outlined" style={{ fontSize: 13, color: '#FBA07A' }}>
                  inventory_2
                </span>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#FBA07A' }}>
                  {activeCount} item{activeCount !== 1 ? 's' : ''} to receive
                </span>
              </div>
            )}
          </div>
        </div>

        {/* ── Scrollable body ─────────────────────────────────────────── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 120px' }}>

          {/* ── DC Number ─────────────────────────────────────────────── */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <p style={{ fontSize: 10.5, fontWeight: 700, color: 'rgba(0,0,0,0.38)', letterSpacing: '0.07em', textTransform: 'uppercase' }}>
                Delivery Challan No.
              </p>
              {/* Toggle */}
              <div style={{
                display: 'flex', background: 'rgba(0,0,0,0.06)',
                borderRadius: 20, padding: 2, gap: 2,
              }}>
                {(['auto', 'manual'] as const).map(mode => (
                  <button
                    key={mode}
                    onClick={() => setDcMode(mode)}
                    style={{
                      height: 24, paddingInline: 12, borderRadius: 18,
                      fontSize: 11, fontWeight: dcMode === mode ? 600 : 400,
                      background: dcMode === mode ? '#fff' : 'transparent',
                      color: dcMode === mode ? '#0b1c30' : 'rgba(0,0,0,0.4)',
                      border: 'none', cursor: 'pointer',
                      boxShadow: dcMode === mode ? '0 1px 3px rgba(0,0,0,0.12)' : 'none',
                      transition: 'all 0.18s cubic-bezier(0.4,0,0.2,1)',
                      textTransform: 'capitalize',
                    }}
                  >
                    {mode === 'auto' ? 'Auto-generate' : 'Manual'}
                  </button>
                ))}
              </div>
            </div>

            {dcMode === 'auto' ? (
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                background: '#fff', borderRadius: 14,
                border: '1.5px solid rgba(0,0,0,0.08)',
                padding: '10px 14px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 15, color: '#C8603A' }}>
                    auto_awesome
                  </span>
                  <span style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 600, color: '#0b1c30' }}>
                    {dcAuto}
                  </span>
                </div>
                <button
                  onClick={() => setDcAuto(autoDC())}
                  title="Regenerate"
                  style={{
                    background: 'rgba(0,0,0,0.05)', border: 'none', cursor: 'pointer',
                    width: 28, height: 28, borderRadius: 8,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: 'rgba(0,0,0,0.35)',
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 14 }}>refresh</span>
                </button>
              </div>
            ) : (
              <input
                type="text"
                value={dcManual}
                onChange={e => setDcManual(e.target.value)}
                placeholder="e.g. DC/2026/1234"
                autoFocus
                style={{
                  width: '100%', height: 44, paddingInline: 14,
                  fontSize: 13, color: '#0b1c30',
                  background: '#fff', borderRadius: 14,
                  border: '1.5px solid rgba(200,96,58,0.3)',
                  outline: 'none', boxSizing: 'border-box',
                  fontFamily: 'monospace',
                }}
              />
            )}
          </div>

          {/* ── Transport details (collapsible) ───────────────────────── */}
          <button
            onClick={() => setShowTransport(v => !v)}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              background: '#fff', borderRadius: 14,
              border: '1.5px solid rgba(0,0,0,0.07)',
              padding: '10px 14px', cursor: 'pointer',
              marginBottom: showTransport ? 0 : 16,
              borderBottomLeftRadius: showTransport ? 0 : 14,
              borderBottomRightRadius: showTransport ? 0 : 14,
              transition: 'border-radius 0.2s',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 15, color: 'rgba(0,0,0,0.35)' }}>
                local_shipping
              </span>
              <span style={{ fontSize: 12.5, fontWeight: 500, color: 'rgba(0,0,0,0.55)' }}>
                Transport details
              </span>
              {(vehicleNumber || driverName) && (
                <span style={{
                  fontSize: 10, background: 'rgba(34,197,94,0.12)',
                  color: '#15803D', borderRadius: 6, padding: '1px 6px', fontWeight: 600,
                }}>
                  Filled
                </span>
              )}
            </div>
            <span
              className="material-symbols-outlined"
              style={{
                fontSize: 16, color: 'rgba(0,0,0,0.3)',
                transform: showTransport ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 0.2s',
              }}
            >
              expand_more
            </span>
          </button>

          {showTransport && (
            <div style={{
              background: '#fff',
              borderBottomLeftRadius: 14, borderBottomRightRadius: 14,
              border: '1.5px solid rgba(0,0,0,0.07)', borderTop: 'none',
              padding: '12px 14px 14px',
              marginBottom: 16,
              animation: 'detail-reveal-in 180ms ease-out both',
              display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10,
            }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 10.5, color: 'rgba(0,0,0,0.4)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Vehicle No.
                </span>
                <input
                  type="text" value={vehicleNumber} onChange={e => setVehicleNumber(e.target.value)}
                  placeholder="AP 05 TG XXXX"
                  style={{
                    height: 38, paddingInline: 12, borderRadius: 10,
                    fontSize: 13, color: '#0b1c30', background: '#F8F9FC',
                    border: '1.5px solid rgba(0,0,0,0.08)', outline: 'none',
                    fontFamily: 'monospace', textTransform: 'uppercase',
                  }}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 10.5, color: 'rgba(0,0,0,0.4)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Driver Name
                </span>
                <input
                  type="text" value={driverName} onChange={e => setDriverName(e.target.value)}
                  placeholder="Optional"
                  style={{
                    height: 38, paddingInline: 12, borderRadius: 10,
                    fontSize: 13, color: '#0b1c30', background: '#F8F9FC',
                    border: '1.5px solid rgba(0,0,0,0.08)', outline: 'none',
                  }}
                />
              </label>
            </div>
          )}

          {/* ── Items ─────────────────────────────────────────────────── */}
          <div style={{ marginBottom: 16 }}>
            <p style={{
              fontSize: 10.5, fontWeight: 700, color: 'rgba(0,0,0,0.38)',
              letterSpacing: '0.07em', textTransform: 'uppercase',
              marginBottom: 10,
            }}>
              What arrived today
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {items.map((item, idx) => (
                <ItemCard
                  key={item.id}
                  item={item}
                  idx={idx}
                  updateItem={updateItem}
                  animDelay={idx * 40}
                />
              ))}
            </div>
          </div>

          {/* ── Remarks ──────────────────────────────────────────────── */}
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{
                fontSize: 10.5, fontWeight: 700, color: 'rgba(0,0,0,0.38)',
                letterSpacing: '0.07em', textTransform: 'uppercase',
              }}>
                Notes
              </span>
              <textarea
                rows={2}
                value={remarks}
                onChange={e => setRemarks(e.target.value)}
                placeholder="e.g. 80 bags to follow per vendor call"
                style={{
                  padding: '10px 12px', borderRadius: 14,
                  fontSize: 13, color: '#0b1c30',
                  background: '#fff', border: '1.5px solid rgba(0,0,0,0.08)',
                  outline: 'none', resize: 'none',
                  lineHeight: 1.5,
                }}
              />
            </label>
          </div>

          {/* Error */}
          {error && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              background: '#FEF2F2', border: '1px solid #FECACA',
              borderRadius: 12, padding: '10px 14px',
              animation: 'item-card-in 0.2s ease both',
            }}>
              <span className="material-symbols-outlined" style={{ fontSize: 15, color: '#DC2626', flexShrink: 0 }}>
                error
              </span>
              <p style={{ fontSize: 12, color: '#DC2626', margin: 0 }}>{error}</p>
            </div>
          )}
        </div>

        {/* ── Sticky footer ────────────────────────────────────────────── */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          background: 'rgba(248,249,252,0.92)',
          backdropFilter: 'blur(12px)',
          borderTop: '1px solid rgba(0,0,0,0.07)',
          padding: '12px 16px',
          paddingBottom: 'max(12px, env(safe-area-inset-bottom))',
          display: 'flex', gap: 10,
        }}>
          <button
            onClick={handleClose}
            style={{
              height: 48, paddingInline: 20, borderRadius: 14,
              fontSize: 13, fontWeight: 500, color: 'rgba(0,0,0,0.5)',
              background: 'rgba(0,0,0,0.06)', border: 'none', cursor: 'pointer',
              flexShrink: 0, transition: 'background 0.15s',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || activeCount === 0}
            style={{
              flex: 1, height: 48, borderRadius: 14,
              fontSize: 13, fontWeight: 700, color: '#fff',
              background: activeCount > 0 && !submitting
                ? 'linear-gradient(135deg, #D4714A 0%, #C8603A 100%)'
                : 'rgba(0,0,0,0.12)',
              border: 'none', cursor: activeCount > 0 && !submitting ? 'pointer' : 'default',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              boxShadow: activeCount > 0 && !submitting
                ? '0 4px 16px rgba(200,96,58,0.35)' : 'none',
              transition: 'all 0.2s cubic-bezier(0.4,0,0.2,1)',
            }}
          >
            {submitting ? (
              <>
                <span className="material-symbols-outlined" style={{ fontSize: 18, animation: 'spin 1s linear infinite' }}>
                  progress_activity
                </span>
                Saving…
              </>
            ) : (
              <>
                Save receipt &amp; generate GRN
                <span className="material-symbols-outlined" style={{ fontSize: 17 }}>arrow_forward</span>
              </>
            )}
          </button>
        </div>
      </div>
    </>
  );
}
