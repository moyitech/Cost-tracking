import test from 'node:test'
import assert from 'node:assert/strict'
import { cacheSnapshot, collectItems, emptyRemote, mergeItems, SyncGate, validCache } from '../src/ledger-cache'
import { Item, Ledger, metrics, newItem, today } from '../src/domain'
import { purchaseAmount, purchaseDefaults } from '../src/item-form-defaults'
import { stageImportPictures, takeImportPictures } from '../src/import-selection'
const item = (id: string) => newItem({ name: id, image: '', note: '', purchaseAmount: 200, purchaseDate: '2026-10-22' }, 's', id)
const ledger = (items: Item[]): Ledger => ({ version: 1, items, spaces: [{ id: 's', name: '个人', kind: 'personal', role: 'admin', members: [] }] })

test('all pages are fetched and deduplicated before publishing the list', async () => {
  const calls: (string | null | undefined)[] = []
  const result = await collectItems(async cursor => {
    calls.push(cursor)
    return !cursor ? { items: Array.from({ length: 100 }, (_, i) => item(String(i))), cursor: 'next' } : { items: [item('99'), item('100')], cursor: null }
  })
  assert.equal(result?.length, 101); assert.deepEqual(calls, [null, 'next'])
  const callsBeforeFilter = calls.length
  assert.equal(result?.filter(i => i.status === 'active' && i.name === '100').length, 1)
  assert.equal(calls.length, callsBeforeFilter)
})
test('failed or invalidated page collection never returns a partial snapshot', async () => {
  await assert.rejects(collectItems(async cursor => { if (cursor) throw new Error('offline'); return { items: [item('a')], cursor: 'next' } }), /offline/)
  assert.equal(await collectItems(async () => ({ items: [item('a')], cursor: null }), () => false), null)
  await assert.rejects(collectItems(async () => ({ items: [], cursor: 'loop' })), /同步未完成/)
})
test('refreshes share a flight; writes and space changes fence old completions', async () => {
  const gate = new SyncGate(); let release!: () => void; let calls = 0; let applied = ''
  const first = gate.run(async token => { calls++; await new Promise<void>(resolve => { release = resolve }); if (gate.accepts(token)) applied = 'stale' })
  assert.equal(gate.run(async () => { calls++ }), first); assert.equal(calls, 1)
  gate.invalidate()
  await gate.run(async token => { if (gate.accepts(token)) applied = 'fresh' })
  release(); await first; assert.equal(applied, 'fresh')
})
test('merge keeps new revisions and cached history, including after restore/delete', () => {
  const saved = { ...item('a'), revision: 3, deleted: true }
  const other = { ...item('b'), spaceId: 'other' }
  const merged = mergeItems(ledger([saved, other]), [{ ...item('a'), revision: 2, history: [] }])
  assert.equal(merged.items[0].deleted, true); assert.equal(merged.items[1].spaceId, 'other')
  assert.deepEqual(mergeItems(ledger([saved]), [{ ...saved, history: [] }]).items[0].history, saved.history)
})
test('remote snapshots retain space partitions but strip image bytes and picker paths', () => {
  const original = { ...item('a'), image: 'data:image/png;base64,private', imageFileId: 'file', attachments: [{ name: '凭证', path: '/tmp/photo', fileId: 'receipt' }] }
  const cache = cacheSnapshot(ledger([original]), ['s'], { s: emptyRemote })
  assert.ok(validCache(cache)); assert.ok(!validCache({ version: 0 }))
  assert.equal(cache.data.items[0].image, ''); assert.equal(cache.data.items[0].imageFileId, 'file')
  assert.equal(cache.data.items[0].attachments![0].path, ''); assert.equal(original.image.startsWith('data:'), true)
  assert.deepEqual(cache.readySpaces, ['s'])
})
test('cached active metrics recompute across midnight; disposed metrics stay frozen', () => {
  const cached = { ...item('a'), serverMetrics: { as_of_date: '2026-10-22', extra_cents: 0, known_investment_cents: 200, total_investment_cents: 200, holding_days: 1, net_cost_cents: 200, current_daily_yuan: '2.00', actual_daily_yuan: null } }
  assert.equal(metrics(cached, '2026-10-23').days, 2); assert.equal(metrics(cached, '2026-10-23').daily, 100)
  assert.equal(metrics({ ...cached, status: 'sold', serverMetrics: { ...cached.serverMetrics, actual_daily_yuan: '2.00' } }, '2026-10-23').daily, 200)
})
test('manual defaults differ from AI and old drafts without rewriting unknown fields', () => {
  const manual = purchaseDefaults(); assert.equal(manual.date, today()); assert.equal(manual.amount, '')
  assert.equal(purchaseAmount(manual.amount, manual.blankPriceAsZero), 0)
  const ai = purchaseDefaults(undefined, { purchaseDate: null, purchaseAmount: null })
  assert.equal(ai.date, ''); assert.equal(purchaseAmount(ai.amount, ai.blankPriceAsZero), null)
  const edit = purchaseDefaults({ purchaseDate: null, purchaseAmount: null })
  assert.equal(edit.date, ''); assert.equal(purchaseAmount('', edit.blankPriceAsZero), null)
  assert.equal(purchaseAmount(''), null) // pre-existing draft without the new flag
  assert.equal(purchaseAmount('12.34', true), 1234)
  assert.throws(() => purchaseAmount('-1', true))
})
test('album handoff is one-use and caps sources at nine', () => {
  stageImportPictures(Array.from({ length: 10 }, (_, i) => String(i)), 'space-a')
  const selected = takeImportPictures(); assert.equal(selected?.paths.length, 9); assert.equal(selected?.spaceId, 'space-a')
  assert.equal(takeImportPictures(), null)
})

test('daily summary rounds only after summing raw costs', async () => {
  const { spaceDaily } = await import('../src/domain')
  const source = { ...item('tiny'), purchaseAmount: 1, purchaseDate: '2026-10-22', serverMetrics: { as_of_date: '2026-10-23', extra_cents: 0, known_investment_cents: 1, total_investment_cents: 1, holding_days: 2, net_cost_cents: 1, current_daily_yuan: '0.01', actual_daily_yuan: null } }
  assert.equal(spaceDaily([source, { ...source, id: 'second' }], '2026-10-23').amount, 1)
})

test('home creation order survives detail merges and edits, independent of purchase date', async () => {
  const { newestItemsFirst } = await import('../src/domain')
  const older = { ...item('older'), createdAt: '2026-10-20T10:00:00Z', purchaseDate: '2026-10-23' }
  const newer = { ...item('newer'), createdAt: '2026-10-23T10:00:00Z', purchaseDate: '2025-01-01' }
  const merged = mergeItems(ledger([newer, older]), [{ ...older, revision: 2 }])
  assert.deepEqual(newestItemsFirst(merged.items).map(i => i.id), ['newer', 'older'])
  assert.deepEqual(merged.items.map(i => i.id), ['older', 'newer'])
  const legacy = { ...older, createdAt: undefined, history: [{ ...older.history[0], recordedAt: '2026-10-21T10:00:00Z' }] }
  assert.deepEqual(newestItemsFirst([legacy, newer]).map(i => i.id), ['newer', 'older'])
})
