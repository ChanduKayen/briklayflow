import { useState, useRef, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { IconPlus, IconCheck, IconX, IconChevronLeft } from '@tabler/icons-react';

type PartyType = 'Worker' | 'Vendor' | 'Client';
type RowStatus = 'idle' | 'saving' | 'saved' | 'error';

interface PartyRow {
  idx: number;
  type: PartyType;
  name: string;
  phone: string;
  trade: string;
  status: RowStatus;
  error?: string;
}

const TYPE_STYLES: Record<PartyType, { bg: string; color: string }> = {
  Vendor: { bg: '#F0F9FF', color: '#075985' },
  Worker: { bg: '#FFF7ED', color: '#9A3412' },
  Client: { bg: '#F0FDF4', color: '#14532D' },
};

const TYPES: PartyType[] = ['Worker', 'Vendor', 'Client'];

function genId() {
  return 'STK-' + Math.random().toString(36).substr(2, 8).toUpperCase();
}

function emptyRow(idx: number): PartyRow {
  return { idx, type: 'Worker', name: '', phone: '', trade: '', status: 'idle' };
}

interface Props {
  orgId: string;
  onSaved: () => void;
  onCancel: () => void;
}

export default function PartySpreadsheet({ orgId, onSaved, onCancel }: Props) {
  const [rows, setRows] = useState<PartyRow[]>([emptyRow(0), emptyRow(1), emptyRow(2)]);
  const refs = useRef<Record<string, HTMLInputElement | null>>({});

  const savedCount = rows.filter(r => r.status === 'saved').length;

  useEffect(() => {
    refs.current['name-0']?.focus();
  }, []);

  function patchRow(idx: number, patch: Partial<PartyRow>) {
    setRows(prev => prev.map(r => r.idx === idx ? { ...r, ...patch } : r));
  }

  async function saveRow(idx: number) {
    const row = rows.find(r => r.idx === idx);
    if (!row || !row.name.trim() || row.status === 'saving' || row.status === 'saved') return;

    patchRow(idx, { status: 'saving', error: undefined });

    const { error } = await supabase.from('stakeholders').insert([{
      stakeholder_id: genId(),
      name: row.name.trim(),
      type: row.type,
      category: row.trade.trim() || null,
      contact: row.phone.trim() || null,
      org_id: orgId,
    }]);

    if (error) {
      patchRow(idx, { status: 'error', error: error.message });
      return;
    }
    patchRow(idx, { status: 'saved' });
  }

  function handleKeyDown(
    e: React.KeyboardEvent<HTMLInputElement>,
    idx: number,
    field: 'name' | 'phone' | 'trade',
  ) {
    if (e.key === 'Enter') {
      e.preventDefault();
      void saveRow(idx);
      return;
    }
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      if (field === 'name') {
        setTimeout(() => refs.current[`phone-${idx}`]?.focus(), 20);
      } else if (field === 'phone') {
        setTimeout(() => refs.current[`trade-${idx}`]?.focus(), 20);
      } else {
        void saveRow(idx);
        setRows(prev => {
          const sorted = [...prev].sort((a, b) => a.idx - b.idx);
          const pos = sorted.findIndex(r => r.idx === idx);
          const next = sorted[pos + 1];
          if (next) {
            setTimeout(() => refs.current[`name-${next.idx}`]?.focus(), 50);
            return prev;
          }
          const newIdx = Math.max(...prev.map(r => r.idx)) + 1;
          setTimeout(() => refs.current[`name-${newIdx}`]?.focus(), 60);
          return [...prev, emptyRow(newIdx)];
        });
      }
    }
  }

  function addRow() {
    setRows(prev => {
      const newIdx = Math.max(...prev.map(r => r.idx)) + 1;
      setTimeout(() => refs.current[`name-${newIdx}`]?.focus(), 60);
      return [...prev, emptyRow(newIdx)];
    });
  }

  const sortedRows = [...rows].sort((a, b) => a.idx - b.idx);

  const cellBase: React.CSSProperties = {
    border: 'none', outline: 'none', background: 'transparent',
    fontSize: 13, color: 'var(--color-text-primary)',
    width: '100%', padding: '10px 12px', fontFamily: 'inherit',
  };

  const COL = '40px 168px 1fr 140px 180px 100px';
  const COL_HEADS = ['#', 'Type', 'Name *', 'Phone', 'Trade / Category', ''];

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'var(--color-background-tertiary)',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 24px', flexShrink: 0,
        background: 'var(--color-background-primary)',
        borderBottom: '0.5px solid var(--color-border-tertiary)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={onCancel} style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            fontSize: 12, color: 'var(--color-text-secondary)',
            background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0',
          }}>
            <IconChevronLeft size={15} />
            Parties
          </button>
          <div style={{ width: 1, height: 14, background: 'var(--color-border-tertiary)' }} />
          <span style={{
            fontSize: 14, fontWeight: 500, letterSpacing: '-.01em',
            color: 'var(--color-text-primary)',
          }}>
            Add parties in bulk
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {savedCount > 0 && (
            <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
              {savedCount} saved
            </span>
          )}
          <button onClick={onCancel} style={{
            fontSize: 12, fontWeight: 500, color: 'var(--color-text-secondary)',
            background: 'none', border: '0.5px solid var(--color-border-tertiary)',
            borderRadius: 8, padding: '8px 14px', cursor: 'pointer',
          }}>
            Cancel
          </button>
          <button
            disabled={savedCount === 0}
            onClick={onSaved}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              fontSize: 12, fontWeight: 500,
              background: 'var(--color-text-primary)',
              color: 'var(--color-background-primary)',
              border: 'none', borderRadius: 8, padding: '8px 16px',
              cursor: savedCount === 0 ? 'not-allowed' : 'pointer',
              opacity: savedCount === 0 ? 0.4 : 1,
              transition: 'opacity .15s',
            }}
          >
            <IconCheck size={13} />
            Done{savedCount > 0 ? ` (${savedCount})` : ''}
          </button>
        </div>
      </div>

      {/* Hint bar */}
      <div style={{
        padding: '6px 24px', flexShrink: 0,
        background: 'var(--color-background-secondary)',
        borderBottom: '0.5px solid var(--color-border-tertiary)',
        fontSize: 11, color: 'var(--color-text-tertiary)',
        letterSpacing: '.01em',
      }}>
        Tab to navigate cells · Tab past Trade auto-saves & moves to next row · Enter saves current row
      </div>

      {/* Spreadsheet */}
      <div style={{ flex: 1, overflow: 'auto', padding: '20px 24px' }}>
        <div style={{
          background: 'var(--color-background-primary)',
          border: '0.5px solid var(--color-border-tertiary)',
          borderRadius: 12, overflow: 'hidden',
        }}>
          {/* Column headers */}
          <div style={{
            display: 'grid', gridTemplateColumns: COL,
            background: 'var(--color-background-secondary)',
            borderBottom: '0.5px solid var(--color-border-tertiary)',
          }}>
            {COL_HEADS.map((h, i) => (
              <div key={i} style={{
                padding: '8px 12px', fontSize: 10, letterSpacing: '.09em',
                color: 'var(--color-text-tertiary)', fontWeight: 400,
                textTransform: 'uppercase', textAlign: i === 0 ? 'center' : 'left',
              }}>
                {h}
              </div>
            ))}
          </div>

          {/* Rows */}
          {sortedRows.map((row, vi) => {
            const saved   = row.status === 'saved';
            const errored = row.status === 'error';
            const saving  = row.status === 'saving';

            return (
              <div
                key={row.idx}
                style={{
                  display: 'grid', gridTemplateColumns: COL,
                  borderBottom: vi < sortedRows.length - 1 ? '0.5px solid var(--color-border-tertiary)' : 'none',
                  background: saved ? 'rgba(34,197,94,0.05)' : errored ? 'rgba(239,68,68,0.04)' : 'transparent',
                  transition: 'background .4s',
                  opacity: saving ? 0.65 : 1,
                }}
              >
                {/* Row number */}
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  padding: '10px 8px',
                  fontSize: 11, color: 'var(--color-text-tertiary)',
                  borderRight: '0.5px solid var(--color-border-tertiary)',
                }}>
                  {saved   ? <IconCheck size={12} style={{ color: '#22c55e' }} />
                  : errored ? <IconX size={12} style={{ color: '#ef4444' }} />
                  : vi + 1}
                </div>

                {/* Type pills */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 3, padding: '8px 10px',
                  borderRight: '0.5px solid var(--color-border-tertiary)',
                }}>
                  {TYPES.map(t => (
                    <button
                      key={t}
                      disabled={saved}
                      onClick={() => patchRow(row.idx, { type: t })}
                      style={{
                        fontSize: 10, padding: '2px 6px', borderRadius: 4,
                        cursor: saved ? 'default' : 'pointer', letterSpacing: '.01em',
                        border: row.type === t ? 'none' : '0.5px solid var(--color-border-tertiary)',
                        background: row.type === t ? TYPE_STYLES[t].bg : 'transparent',
                        color: row.type === t ? TYPE_STYLES[t].color : 'var(--color-text-tertiary)',
                        fontWeight: row.type === t ? 600 : 400,
                      }}
                    >
                      {t[0]}
                    </button>
                  ))}
                  <span style={{ fontSize: 10, color: TYPE_STYLES[row.type].color, marginLeft: 4, letterSpacing: '.01em' }}>
                    {row.type}
                  </span>
                </div>

                {/* Name */}
                <div style={{ display: 'flex', alignItems: 'center', borderRight: '0.5px solid var(--color-border-tertiary)' }}>
                  <input
                    ref={el => { refs.current[`name-${row.idx}`] = el; }}
                    value={row.name}
                    onChange={e => patchRow(row.idx, { name: e.target.value, status: 'idle', error: undefined })}
                    onKeyDown={e => handleKeyDown(e, row.idx, 'name')}
                    placeholder={vi === 0 ? 'Ramesh Kumar' : ''}
                    disabled={saved}
                    style={{ ...cellBase, fontWeight: 500 }}
                  />
                </div>

                {/* Phone */}
                <div style={{ display: 'flex', alignItems: 'center', borderRight: '0.5px solid var(--color-border-tertiary)' }}>
                  <input
                    ref={el => { refs.current[`phone-${row.idx}`] = el; }}
                    value={row.phone}
                    onChange={e => patchRow(row.idx, { phone: e.target.value })}
                    onKeyDown={e => handleKeyDown(e, row.idx, 'phone')}
                    placeholder={vi === 0 ? '9876543210' : ''}
                    disabled={saved}
                    style={cellBase}
                  />
                </div>

                {/* Trade */}
                <div style={{ display: 'flex', alignItems: 'center', borderRight: '0.5px solid var(--color-border-tertiary)' }}>
                  <input
                    ref={el => { refs.current[`trade-${row.idx}`] = el; }}
                    value={row.trade}
                    onChange={e => patchRow(row.idx, { trade: e.target.value })}
                    onKeyDown={e => handleKeyDown(e, row.idx, 'trade')}
                    placeholder={vi === 0 ? 'Mason / Electrician' : ''}
                    disabled={saved}
                    style={cellBase}
                  />
                </div>

                {/* Status */}
                <div style={{ display: 'flex', alignItems: 'center', padding: '8px 12px', fontSize: 11 }}>
                  {saving  && <span style={{ color: 'var(--color-text-tertiary)' }}>Saving…</span>}
                  {saved   && <span style={{ color: '#22c55e', fontWeight: 500 }}>Saved</span>}
                  {errored && (
                    <span style={{ color: '#ef4444', fontSize: 10, lineHeight: 1.3 }} title={row.error}>
                      {row.error?.slice(0, 28) || 'Error'}
                    </span>
                  )}
                  {row.status === 'idle' && row.name.trim() && (
                    <button
                      onClick={() => void saveRow(row.idx)}
                      style={{
                        fontSize: 11, color: 'var(--color-text-secondary)',
                        background: 'none', border: '0.5px solid var(--color-border-tertiary)',
                        borderRadius: 5, padding: '3px 8px', cursor: 'pointer',
                      }}
                    >
                      Save
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Add row */}
        <button onClick={addRow} style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          marginTop: 10, fontSize: 12, color: 'var(--color-text-tertiary)',
          background: 'none', border: 'none', cursor: 'pointer', padding: '4px 6px',
        }}>
          <IconPlus size={13} />
          Add row
        </button>
      </div>
    </div>
  );
}
