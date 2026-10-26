import test from 'node:test'
import assert from 'node:assert/strict'
import { completionHint, dailyRanking, isIncompleteHolding, ItemInput, Ledger, migrateLedger, metrics, missingFields, moneyShort, newItem, parseMoney, spaceDaily, validateDisposal, validateExpense, validateInput } from '../src/domain'
import { applyCommand } from '../src/commands'

const input: ItemInput = { name: '电脑', purchaseAmount: 800000, purchaseDate: '2025-06-07', image: '', note: '' }
const item = () => newItem(input, 'personal', 'computer')

test('retired attributes in old snapshots and drafts never return after create or edit', () => {
  const retired = { category: '数码', brand: '旧品牌', model: '旧型号', location: '书房', channel: '商店', serial: 'SN', warranty: '一年' }
  const old = { ...item(), ...retired }
  const snapshot: Ledger = { version: 1, items: [old], spaces: [{ id: 'personal', name: '个人', kind: 'personal', role: 'admin', members: [] }] }
  const migrated = migrateLedger(snapshot)
  assert.equal(migrated.items[0].name, old.name)
  assert.deepEqual(migrated.items[0].history, old.history)
  assert.equal(migrated.items[0].purchaseAmount, old.purchaseAmount)
  assert.equal(migrateLedger(migrated), migrated)
  const created = newItem({ ...input, ...retired }, 'personal')
  const edited = applyCommand(migrated, { type: 'edit', id: old.id, revision: old.revision, input: { ...input, ...retired, note: '保留备注' } })
  for (const key of Object.keys(retired)) {
    assert.equal(key in migrated.items[0], false)
    assert.equal(key in created, false)
    assert.equal(key in edited.items[0], false)
  }
  assert.equal(edited.items[0].note, '保留备注')
})
const ledger = (): Ledger => ({ version: 1, items: [item()], spaces: [
  { id: 'personal', name: '个人', kind: 'personal', role: 'admin', members: [] },
  { id: 'family', name: '家庭', kind: 'family', role: 'editor', members: [] },
  { id: 'readonly', name: '只读家庭', kind: 'family', role: 'viewer', members: [] },
] })

test('AC03–AC08: inclusive calendar days, maintenance, continuous usage, disposal freeze and same-day disposal', () => {
  const computer = item()
  assert.equal(metrics(computer, '2026-10-19').days, 500)
  assert.equal(metrics(computer, '2026-10-19').daily, 1600)
  computer.expenses.push({ id: 'repair', amount: 50000, date: '2026-10-19', category: '维修', note: '' })
  assert.equal(metrics(computer, '2026-10-19').total, 850000)
  assert.equal(metrics(computer, '2026-10-19').daily, 1700)
  assert.equal(computer.status, 'active')
  assert.equal(metrics(computer, '2026-10-20').days, 501)
  computer.status = 'sold'; computer.disposalDate = '2026-10-19'; computer.recoveryAmount = 300000
  assert.equal(metrics(computer, '2026-10-19').net, 550000)
  assert.equal(metrics(computer, '2026-10-20').daily, 1100)
  assert.equal(metrics(computer, '2030-01-01').days, 500)
  computer.purchaseDate = computer.disposalDate
  assert.equal(metrics(computer).days, 1)
})
test('PRD headphones and sold camera examples', () => {
  const headphones = { ...item(), purchaseDate: '2024-10-20', purchaseAmount: 300000, status: 'active' as const }
  assert.equal(metrics(headphones, '2026-10-19').days, 730)
  assert.equal((metrics(headphones, '2026-10-19').daily! / 100).toFixed(2), '4.11')
  const camera = { ...headphones, purchaseAmount: 500000, status: 'sold' as const, disposalDate: '2025-10-19', recoveryAmount: 300000 }
  assert.equal(metrics(camera, '2026-10-19').days, 365)
  assert.equal((metrics(camera).daily! / 100).toFixed(2), '5.48')
})
test('AC02, AC20: unknown is distinct from explicit zero, including disposed records', () => {
  const unknown = newItem({ ...input, purchaseAmount: null, purchaseDate: null }, 'personal')
  assert.equal(metrics(unknown).daily, null); assert.equal(metrics(unknown).days, null)
  unknown.purchaseDate = '2026-10-19'
  assert.equal(metrics(unknown, '2026-10-19').days, 1); assert.equal(metrics(unknown).total, null)
  unknown.expenses.push({ id: 'extra', amount: 10000, date: '2026-10-19', category: '维修', note: '' })
  assert.equal(metrics(unknown).known, 10000); assert.equal(metrics(unknown).daily, null)
  unknown.status = 'sold'; unknown.disposalDate = '2026-10-19'; unknown.recoveryAmount = 0
  assert.equal(metrics(unknown).net, null)
  unknown.purchaseAmount = 0
  assert.equal(metrics(unknown).net, 10000)
})
test('money accepts cents exactly and rejects negative, extra decimals, exponent and unsafe input', () => {
  assert.equal(parseMoney(''), null); assert.equal(parseMoney('0'), 0); assert.equal(parseMoney('1.01'), 101)
  for (const value of ['-1', '1.001', '1e3', 'NaN', '1,000', '999999999999999999']) assert.throws(() => parseMoney(value))
  assert.throws(() => parseMoney('', true))
})
test('AC08–AC09: invalid dates are rejected; zero recovery needs explicit confirmation', () => {
  assert.throws(() => validateInput({ ...input, purchaseDate: '2026-02-30' }))
  assert.throws(() => validateInput({ ...input, purchaseDate: '2099-01-01' }))
  assert.throws(() => validateDisposal(item(), '2025-06-06', 0, true))
  assert.throws(() => validateDisposal(item(), '2026-10-19', null, false))
  assert.throws(() => validateDisposal(item(), '2026-10-19', 0, false))
  assert.doesNotThrow(() => validateDisposal(item(), '2026-10-19', 0, true))
})
test('AC13: retry import with same idempotency key creates only one record', () => {
  const cmd = { type: 'create' as const, input, spaceId: 'personal', key: 'request-1' }
  const first = applyCommand(ledger(), cmd); const retried = applyCommand(first, cmd)
  assert.equal(retried.items.length, 2)
  assert.equal(retried.items[0].id, first.items[0].id)
})
test('AC15, AC17: write permission is checked by the command layer, including restore and import', () => {
  const data = ledger(); data.items[0].spaceId = 'readonly'
  assert.throws(() => applyCommand(data, { type: 'edit', id: 'computer', revision: 1, input: { ...input, name: '新电脑' } }), /只读/)
  assert.throws(() => applyCommand(data, { type: 'import', spaceId: 'readonly', entries: [{ key: 'a', input }] }), /只读/)
  data.items[0].deleted = true
  assert.throws(() => applyCommand(data, { type: 'restore', id: 'computer', revision: 1 }), /只读/)
})
test('AC16: transfer preserves identity/history and moves exactly one record', () => {
  const moved = applyCommand(ledger(), { type: 'move', id: 'computer', revision: 1, spaceId: 'family' })
  assert.equal(moved.items.length, 1); assert.equal(moved.items[0].id, 'computer')
  assert.equal(moved.items[0].spaceId, 'family'); assert.equal(moved.items[0].history.length, 2)
  assert.throws(() => applyCommand(moved, { type: 'move', id: 'computer', revision: 2, spaceId: 'personal' }), /规则待确认/)
})
test('AC18: stale revisions fail without modifying stored snapshot', () => {
  const before = ledger(); const changed = applyCommand(before, { type: 'edit', id: 'computer', revision: 1, input: { ...input, name: '新电脑' } })
  assert.equal(before.items[0].status, 'active')
  assert.throws(() => applyCommand(changed, { type: 'edit', id: 'computer', revision: 1, input }), /已被其他操作更新/)
  assert.equal(changed.items[0].name, '新电脑')
})
test('AC19: delete and restore preserve identity, costs and historical entries', () => {
  const removed = applyCommand(ledger(), { type: 'delete', id: 'computer', revision: 1 })
  assert.equal(removed.items.filter(i => !i.deleted).length, 0)
  const restored = applyCommand(removed, { type: 'restore', id: 'computer', revision: 2 })
  assert.equal(restored.items.filter(i => !i.deleted).length, 1)
  assert.equal(restored.items[0].id, 'computer'); assert.equal(metrics(restored.items[0]).total, 800000)
  assert.equal(restored.items[0].history.length, 3)
})
test('AC22: correct an expense without double counting; retain prior amount in history', () => {
  const expense = { id: 'repair', amount: 50000, date: '2026-10-19', category: '维修', note: '更换电池' }
  const first = applyCommand(ledger(), { type: 'expense', id: 'computer', revision: 1, expense })
  const corrected = applyCommand(first, { type: 'expense', id: 'computer', revision: 2, expense: { ...expense, amount: 30000 } })
  assert.equal(corrected.items[0].expenses.length, 1); assert.equal(metrics(corrected.items[0]).total, 830000)
  assert.match(corrected.items[0].history[0].detail!, /500.00 → ¥300.00/)
})
test('disposed item accepts historic expense, rejects later expense after disposal', () => {
  const disposed = applyCommand(ledger(), { type: 'dispose', id: 'computer', revision: 1, status: 'sold', date: '2026-10-18', recovery: 300000, confirmedZero: false })
  assert.doesNotThrow(() => validateExpense(disposed.items[0], { id: 'h', amount: 10000, date: '2026-10-17', category: '维修', note: '' }))
  assert.throws(() => validateExpense(disposed.items[0], { id: 'h', amount: 10000, date: '2026-10-19', category: '维修', note: '' }))
})
test('negative net costs remain truthful instead of being clamped to zero', () => {
  const sold = { ...item(), status: 'sold' as const, disposalDate: '2026-10-19', recoveryAmount: 900000 }
  assert.equal(metrics(sold).net, -100000)
})
test('AC23–AC24: space daily includes active items, excludes disposed/deleted, and reports incomplete items', () => {
  const computer = item()
  const headphones = { ...item(), id: 'headphones', status: 'active' as const, purchaseDate: '2024-10-20', purchaseAmount: 300000 }
  const sold = { ...item(), status: 'sold' as const, disposalDate: '2026-10-19', recoveryAmount: 100000 }
  const deleted = { ...item(), deleted: true }
  const result = spaceDaily([computer, headphones, sold, deleted], '2026-10-19')
  assert.equal((result.amount / 100).toFixed(2), '20.11'); assert.equal(result.count, 2)
  assert.equal(result.incomplete, 0)
  assert.equal(spaceDaily([{ ...item(), purchaseAmount: null }]).incomplete, 1)
  assert.deepEqual(spaceDaily([]), { amount: 0, incomplete: 0, count: 0 })
})

test('AC25: legacy idle snapshots migrate once without changing costs, dates, history or deleted state', () => {
  const before = ledger()
  const legacy = { ...before, items: [
    { ...before.items[0], status: 'idle' as const },
    { ...before.items[0], id: 'deleted', status: 'idle' as const, deleted: true },
    { ...before.items[0], id: 'sold', status: 'sold' as const, disposalDate: '2026-10-19', recoveryAmount: 100000 },
  ] }
  const migrated = migrateLedger(legacy)
  assert.equal(legacy.items[0].status, 'idle')
  assert.deepEqual(migrated.items[0], { ...legacy.items[0], status: 'active', revision: 2 })
  assert.equal(migrated.items[1].deleted, true)
  assert.equal(migrated.items[1].status, 'active')
  assert.deepEqual(migrated.items[2], legacy.items[2])
  assert.equal(metrics(migrated.items[0], '2026-10-20').days, 501)
  assert.equal(metrics(migrated.items[0], '2026-10-20').daily, 800000 / 501)
  assert.equal(migrateLedger(migrated), migrated)
  const restored = applyCommand(migrated, { type: 'restore', id: 'deleted', revision: 2 })
  assert.equal(restored.items[1].status, 'active')
})

test('secondary amounts drop only a zero fraction', () => {
  assert.equal(moneyShort(810500), '8,105')
  assert.equal(moneyShort(10550), '105.50')
  assert.equal(moneyShort(-120000), '-1,200')
  assert.equal(moneyShort(0), '0')
  assert.equal(moneyShort(null), '待补充')
})
test('missing fields name what to complete; disposed items also need disposal facts', () => {
  assert.deepEqual(missingFields(item()), [])
  const unknown = { ...item(), purchaseAmount: null, purchaseDate: null }
  assert.deepEqual(missingFields(unknown), ['价格', '购买日期'])
  assert.equal(completionHint(missingFields(unknown)), '补充价格和购买日期')
  const sold = { ...unknown, status: 'sold' as const, disposalDate: null, recoveryAmount: null }
  assert.deepEqual(missingFields(sold), ['价格', '购买日期', '处置日期', '回收金额'])
  assert.equal(completionHint(missingFields(sold)), '补充价格、购买日期等')
  assert.equal(completionHint([]), '')
})
test('AC24: the incomplete set matches the home metric count', () => {
  const now = '2026-10-19'
  const complete = item()
  const noPrice = { ...item(), id: 'no-price', purchaseAmount: null }
  const noDate = { ...item(), id: 'no-date', purchaseDate: null }
  const soldUnknown = { ...item(), id: 'sold', purchaseAmount: null, status: 'sold' as const, disposalDate: now, recoveryAmount: 0 }
  const deletedUnknown = { ...item(), id: 'deleted', purchaseAmount: null, deleted: true }
  const items = [complete, noPrice, noDate, soldUnknown, deletedUnknown]
  assert.deepEqual(items.filter(i => isIncompleteHolding(i, now)).map(i => i.id), ['no-price', 'no-date'])
  assert.equal(spaceDaily(items, now).incomplete, 2)
  // All held items unknown: the home shows "待补充"; an empty set shows 0.00.
  assert.deepEqual(spaceDaily([noPrice, noDate], now), { amount: 0, incomplete: 2, count: 2 })
})
test('daily ranking covers held items with a known daily cost, highest first', () => {
  const now = '2026-10-19'
  const computer = item()
  const phone = newItem({ name: '手机', purchaseAmount: 600000, purchaseDate: '2026-10-10', image: '', note: '' }, 'personal', 'phone')
  const unknown = { ...item(), id: 'unknown', name: '未知', purchaseAmount: null }
  const sold = { ...newItem({ name: '相机', purchaseAmount: 900000, purchaseDate: '2026-10-18', image: '', note: '' }, 'personal', 'camera'), status: 'sold' as const, disposalDate: now, recoveryAmount: 0 }
  const ranking = dailyRanking([computer, phone, unknown, sold], 5, now)
  assert.deepEqual(ranking.map(r => r.item.id), ['phone', 'computer'])
  assert.equal(ranking[0].daily, 60000)
  assert.equal(dailyRanking([computer, phone], 1, now).length, 1)
})
