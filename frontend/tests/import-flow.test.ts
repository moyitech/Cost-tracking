import test from 'node:test'
import assert from 'node:assert/strict'
import { ImportLifetime, importReviewComplete, mergeReviewDrafts, shouldPoll } from '../src/import-flow'
import type { ImportEntry, ImportTask } from '../src/import-api'

test('return home only after all review items are saved or skipped', () => {
  const pending = { included: true, saved_item_id: null } as ImportEntry
  const saved = { ...pending, saved_item_id: 'saved-item' }
  const skipped = { ...pending, included: false }
  const task = { status: 'ready', entries: [saved] } as ImportTask
  assert.equal(importReviewComplete(task), true)
  assert.equal(importReviewComplete({ ...task, entries: [saved, pending] }), false)
  assert.equal(importReviewComplete({ ...task, entries: [saved, skipped] }), true)
  assert.equal(importReviewComplete({ ...task, entries: [skipped] }), true)
  assert.equal(importReviewComplete({ ...task, entries: [] }), false)
  assert.equal(importReviewComplete({ ...task, status: 'processing' }), false)
  assert.equal(importReviewComplete(null), false)
})

test('completed tasks never poll on resume; only visible unfinished tasks poll', () => {
  const task = { status: 'processing', poll_after_ms: 2000 } as ImportTask
  assert.equal(shouldPoll(task, true), true); assert.equal(shouldPoll(task, false), false)
  assert.equal(shouldPoll({ ...task, status: 'ready', poll_after_ms: null }, true), false)
  assert.equal(shouldPoll({ ...task, status: 'ready' }, true), false)
  assert.equal(shouldPoll({ ...task, status: 'failed' }, true), false)
})
test('page lifetime drops late upload/picker/AI callbacks after exit or restart', async () => {
  const run = new ImportLifetime(); const original = run.token()
  assert.equal(run.accepts(original), true) // backgrounding does not dispose the page
  run.reset(); assert.equal(run.accepts(original), false)
  const next = run.token(); assert.equal(run.accepts(next), true)
  const response = Promise.resolve().then(() => run.accepts(next))
  run.dispose(); assert.equal(await response, false)
  assert.equal(run.accepts(run.reset()), false)
})
test('page-level drafts survive distant card unmounts and never overwrite edits', () => {
  const entries = Array.from({ length: 5 }, (_, i) => ({ id: String(i), revision: 1, included: true, values: { name: `物品${i}`, purchase_amount_cents: null, purchase_date: null }, input_mode: 'recognized' } as ImportEntry))
  const task = { entries } as ImportTask
  const memory = mergeReviewDrafts({}, task)
  memory['0'].name = '自己修改'; memory['0'].amount = '12.'
  const next = mergeReviewDrafts(memory, task)
  assert.equal(next['0'].name, '自己修改'); assert.equal(next['0'].amount, '12.')
  assert.equal(Object.keys(next).length, 5)
  assert.equal(mergeReviewDrafts({}, task)['0'].name, '物品0') // new page has no edits
  assert.equal(mergeReviewDrafts(next, { ...task, entries: entries.map(e => e.id === '0' ? { ...e, saved_item_id: 'saved' } : e) })['0'], undefined)
})

test('upload failures never submit incomplete batches; repeated uploaded IDs are deduplicated', async () => {
  const { uploadSources } = await import('../src/import-flow')
  const cache = new Map<string, string>(); const uploaded: string[] = []; const created: string[][] = []
  let failing = true
  const upload = async (path: string) => {
    if (cache.has(path)) return cache.get(path)!
    if (path === 'b' && failing) throw new Error('network')
    uploaded.push(path); cache.set(path, `file-${path}`); return `file-${path}`
  }
  const run = async () => { const ids = await uploadSources(['a', 'b', 'a'], upload, () => {}, () => true); if (ids) created.push(ids) }
  await assert.rejects(run, /network/); assert.deepEqual(created, [])
  failing = false; await run()
  assert.deepEqual(uploaded, ['a', 'b']); assert.deepEqual(created, [['file-a', 'file-b']])
  let active = true
  assert.equal(await uploadSources(['a', 'b'], async () => { active = false; return 'file' }, () => assert.fail('late progress'), () => active), null)
})

test('bubbling form change events cannot corrupt the swiper index', async () => {
  const { carouselIndex } = await import('../src/import-flow')
  for (const value of [undefined, null, NaN, '1', -1, 1.5, 3]) assert.equal(carouselIndex(value, 3), null)
  assert.equal(carouselIndex(0, 3), 0); assert.equal(carouselIndex(2, 3), 2)
})
