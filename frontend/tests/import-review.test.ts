import test from 'node:test'
import assert from 'node:assert/strict'
import { adoptRevision, reviewBody, reviewCards, reviewDraft, reviewInput } from '../src/import-review'
import type { ImportEntry, ImportTask } from '../src/import-api'
const entry = { revision: 2, values: { name: '相机', purchase_amount_cents: null, purchase_date: null }, input_mode: 'recognized', duplicate_decision: null, existing_item_id: null } as ImportEntry

test('review preserves unknown vs explicit zero and explicit confirmation', () => {
  const d = reviewDraft(entry)
  assert.equal(d.amount, '')
  assert.equal(reviewBody(d, false).values.purchase_amount_cents, null)
  assert.equal(reviewBody({ ...d, amount: '0.00' }, true).values.purchase_amount_cents, 0)
  assert.equal(reviewBody(d, false).confirmed, false)
  assert.equal('quantity_resolved' in reviewBody(d, true), false)
  assert.equal('quantity' in d, false)
  assert.throws(() => reviewBody({ ...d, amount: '-5' }, true))
})
test('version adoption preserves edits and clears stale duplicate decisions', () => {
  const d = { ...reviewDraft(entry), name: '手工修改', amount: '12.34', decision: 'create_independent' as const }
  const next = adoptRevision(d, 5)
  assert.equal(next.name, '手工修改'); assert.equal(next.amount, '12.34'); assert.equal(next.revision, 5)
  assert.equal(next.decision, null); assert.equal(d.revision, 2)
})
test('manual review keeps import semantics and duplicate skip does not create another item', () => {
  const p = reviewBody({ ...reviewDraft(entry), manual: true, decision: 'skip_existing', existing: 'existing-id' }, true)
  assert.equal(p.input_mode, 'manual'); assert.equal(p.included, false); assert.equal(p.existing_item_id, 'existing-id')
})

test('editing a skipped order never restores it implicitly', () => {
  const draft = { ...reviewDraft(entry), name: '校对后的名称' }
  assert.equal(reviewBody(draft, false, false).included, false)
  assert.equal(reviewBody(draft, true, false).included, false)
  assert.equal(reviewBody(draft, true, true).included, true)
})

test('AI prefill uses all manual form fields without attaching a private source screenshot', () => {
  const e = { ...entry, values: { ...entry.values, name: null, category: '游戏手柄', location: '书房', serial: 'SN-1', warranty: '一年', image_file_id: 'photo', attachment_file_ids: ['receipt'] } }
  const input = reviewInput({ ...reviewDraft(e), amount: '0.00' })
  assert.equal(input.name, '')
  for (const field of ['category', 'brand', 'model', 'location', 'channel', 'serial', 'warranty']) assert.equal(field in input, false)
  assert.equal(input.purchaseAmount, 0); assert.equal(input.purchaseDate, null)
  assert.equal(input.imageFileId, 'photo'); assert.deepEqual(input.attachments?.map(a => a.fileId), ['receipt'])
})

test('card deck hides skipped, saved, queued and failed placeholders', () => {
  const candidate = (id: string, props = {}) => ({ ...entry, id, included: true, source_ids: ['ready'], ...props })
  const task = { sources: [{ id: 'ready', status: 'ready' }, { id: 'failed', status: 'failed' }, { id: 'pending', status: 'processing' }], entries: [candidate('a'), candidate('ignored', { included: false }), candidate('saved', { saved_item_id: 'item' }), candidate('waiting', { source_ids: ['pending'] }), candidate('failed', { source_ids: ['failed'] })] } as ImportTask
  assert.deepEqual(reviewCards(task).map(e => e.id), ['a'])
})
