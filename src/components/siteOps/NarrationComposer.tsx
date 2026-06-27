// Platform-UI narration entry + confirmation-back (Block A, Part 1 — UI channel).
// Type a site update; it runs the same pipeline as WhatsApp (via the siteops-narrate edge
// function) and shows the readback confirmation in the UI. An ambiguous progress item shows
// a "which one?" picker right here — the UI mirror of the WhatsApp disambiguation.

import { useState } from 'react'
import { supabase } from '../../lib/supabase'

const INK = '#221A13', INK_SOFT = 'rgba(34,26,19,0.55)', INK_FAINT = 'rgba(34,26,19,0.34)'
const TERRA = '#C8603A', SAGE = '#5E8157', LINE = 'rgba(34,26,19,0.10)'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ambiguous = { item: any; candidates: { task_id: string; name: string; floor: string | null; unit: string | null }[] }

export function NarrationComposer({ projectId, onLogged }: { projectId: string; onLogged?: () => void }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const [ambiguous, setAmbiguous] = useState<Ambiguous[]>([])
  const [narrationId, setNarrationId] = useState<string | null>(null)

  async function submit() {
    const t = text.trim()
    if (!t || busy) return
    setBusy(true); setConfirm(null); setError(false); setAmbiguous([])
    const { data, error: e } = await supabase.functions.invoke('siteops-narrate', { body: { project_id: projectId, text: t } })
    setBusy(false)
    if (e || !data?.ok) { setError(true); setConfirm(data?.confirm ?? 'Could not log that — try again.'); return }
    setConfirm(data.confirm); setAmbiguous(data.ambiguous ?? []); setNarrationId(data.narration_id ?? null); setText('')
    onLogged?.()
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function pick(amb: Ambiguous, taskId: string) {
    setBusy(true)
    const { data } = await supabase.functions.invoke('siteops-narrate', { body: { project_id: projectId, narration_id: narrationId, pick: { item: amb.item, task_id: taskId } } })
    setBusy(false)
    setAmbiguous((prev) => prev.filter((a) => a !== amb))
    if (data?.confirm) setConfirm(data.confirm)
    onLogged?.()
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 9, marginTop: 18, padding: '12px 16px', background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, cursor: 'pointer', color: INK_SOFT, fontSize: 13.5, textAlign: 'left' }}>
        <span style={{ fontSize: 16, color: TERRA }}>✎</span> Log a site update…
      </button>
    )
  }

  return (
    <div style={{ marginTop: 18, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, padding: 14 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <textarea
          autoFocus value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit() } }}
          placeholder='e.g. "Ground floor slab poured, continuous pour no cold joint, cement short tomorrow"'
          rows={2}
          style={{ flex: 1, resize: 'vertical', minHeight: 44, fontSize: 13.5, fontFamily: 'inherit', lineHeight: 1.5, color: INK, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 10, padding: '10px 12px', outline: 'none', boxSizing: 'border-box' }}
        />
        <button onClick={submit} disabled={busy || !text.trim()}
          style={{ flexShrink: 0, fontSize: 13.5, fontWeight: 600, color: '#fff', background: TERRA, border: 'none', borderRadius: 10, padding: '10px 18px', cursor: busy || !text.trim() ? 'default' : 'pointer', opacity: busy || !text.trim() ? 0.5 : 1 }}>
          {busy ? '…' : 'Log'}
        </button>
      </div>

      {confirm && (
        <div style={{ marginTop: 12, padding: '10px 13px', borderRadius: 10, background: error ? '#B2402A10' : `${SAGE}12`, border: `1px solid ${error ? '#B2402A33' : `${SAGE}33`}`, fontSize: 13, lineHeight: 1.5, color: error ? '#B2402A' : INK, whiteSpace: 'pre-wrap' }}>
          {confirm}
        </div>
      )}

      {ambiguous.map((amb, i) => (
        <div key={i} style={{ marginTop: 10, padding: '10px 13px', borderRadius: 10, border: `1px solid ${LINE}` }}>
          <p style={{ fontSize: 12.5, color: INK_SOFT, margin: '0 0 8px' }}>Which one is "<strong style={{ color: INK }}>{amb.item.text}</strong>"?</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {amb.candidates.map((c) => (
              <button key={c.task_id} onClick={() => pick(amb, c.task_id)} disabled={busy}
                style={{ fontSize: 12.5, fontWeight: 600, color: INK, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 999, padding: '6px 13px', cursor: 'pointer' }}>
                {c.name}{c.floor ? <span style={{ color: INK_FAINT, fontWeight: 400 }}> · {c.floor}</span> : null}
              </button>
            ))}
          </div>
        </div>
      ))}

      <button onClick={() => { setOpen(false); setConfirm(null); setAmbiguous([]) }}
        style={{ marginTop: 10, fontSize: 12, color: INK_FAINT, background: 'none', border: 'none', cursor: 'pointer' }}>Close</button>
    </div>
  )
}
