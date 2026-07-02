// STEP 4a — JOURNEY TESTS for the outbound-wamid capture spine. Given a WhatsApp send-response body +
// the ref send() carried, assert the recovered wamid and the map row the drainer will write (or that
// nothing is written when there's no wamid / no target). PURE, no DB, no network.

import { suite, test, expect } from './harness'
import { parseSentWamid, buildMapRow, type CaptureRef } from '../_wa_message_map.ts'

suite('wa message map — parseSentWamid', () => {
  test('lifts messages[0].id from a normal send response', () => {
    const body = JSON.stringify({ messaging_product: 'whatsapp', contacts: [{ wa_id: '9199' }], messages: [{ id: 'wamid.HBgLABC123' }] })
    expect(parseSentWamid(body)).toBe('wamid.HBgLABC123')
  })

  test('an error response (no messages) → null', () => {
    expect(parseSentWamid(JSON.stringify({ error: { message: 'bad', code: 131 } }))).toBeNull()
  })

  test('malformed / empty body → null (never throws)', () => {
    expect(parseSentWamid('not json')).toBeNull()
    expect(parseSentWamid('')).toBeNull()
    expect(parseSentWamid(JSON.stringify({ messages: [{}] }))).toBeNull()   // message with no id
  })
})

suite('wa message map — buildMapRow', () => {
  const cap: CaptureRef = { ref_kind: 'readback', project_id: 'P1', object_refs: [{ kind: 'problem', id: 'pr1' }, { kind: 'site_task', id: 't1' }] }

  test('full capture + wamid → a map row pointing at the objects', () => {
    const r = buildMapRow('org1', cap, 'wamid.X')
    expect(r).toEqual({
      outbound_wamid: 'wamid.X', org_id: 'org1', ref_kind: 'readback', convo_id: null,
      project_id: 'P1', object_refs: [{ kind: 'problem', id: 'pr1' }, { kind: 'site_task', id: 't1' }],
    })
  })

  test('a pick capture keyed by convo (no object_refs) still maps', () => {
    const r = buildMapRow('org1', { ref_kind: 'pick', convo_id: 'c9' }, 'wamid.Y')
    expect(r?.convo_id).toBe('c9')
    expect(r?.object_refs).toBeNull()
  })

  test('no wamid → null (nothing learned to map)', () => {
    expect(buildMapRow('org1', cap, null)).toBeNull()
    expect(buildMapRow('org1', cap, '')).toBeNull()
  })

  test('no capture, or a capture naming NO target → null (never a dangling row)', () => {
    expect(buildMapRow('org1', null, 'wamid.X')).toBeNull()
    expect(buildMapRow('org1', { ref_kind: 'readback', object_refs: [] }, 'wamid.X')).toBeNull()
    expect(buildMapRow('org1', { ref_kind: 'readback' }, 'wamid.X')).toBeNull()
  })

  test('no org → null', () => {
    expect(buildMapRow(null, cap, 'wamid.X')).toBeNull()
  })
})
