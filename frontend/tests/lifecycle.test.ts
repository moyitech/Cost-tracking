import test from 'node:test'
import assert from 'node:assert/strict'
import { Item, newItem } from '../src/domain'
import { compareLifecycleEvents, dayLabel, groupByMonth, lifecycleEvents } from '../src/lifecycle'
const item = (): Item => ({
  ...newItem({ name: '平板', image: '', note: '', purchaseAmount: 229900, purchaseDate: '2024-04-12' }, 'personal', 'tablet'),
  expenses: [{ id: 'case', category: '配件', amount: 9900, date: '2024-04-13', note: '保护壳' }],
})
test('business dates and amounts replace audit operations, even without loaded history', () => {
  const source = item(); source.history = []
  const events = lifecycleEvents(source)
  assert.deepEqual(events.map(e => [e.title, e.occurredOn, e.amount]), [
    ['添加配件', '2024-04-13', '¥99.00'], ['购买', '2024-04-12', '¥2,299.00'],
  ])
  assert.equal(events[0].detail, '保护壳')
})
test('corrections replace milestones and removed expenses disappear', () => {
  const source = item(); const original = lifecycleEvents(source)
  source.expenses[0].amount = 0; source.purchaseDate = '2024-04-11'
  const corrected = lifecycleEvents(source)
  assert.deepEqual(corrected.map(e => e.id), original.map(e => e.id))
  assert.equal(corrected[0].amount, '¥0.00')
  assert.equal(corrected[1].occurredOn, '2024-04-11')
  source.expenses = []; assert.equal(lifecycleEvents(source).length, 1)
  source.deleted = true; assert.deepEqual(lifecycleEvents(source), [])
})
test('disposal uses current status and sorts after same-day expenses', () => {
  const source = item()
  source.status = 'sold'; source.disposalDate = '2024-04-13'; source.recoveryAmount = 100000
  assert.equal(lifecycleEvents(source)[0].title, '已出售')
  assert.equal(lifecycleEvents(source)[0].amount, '回收 ¥1,000.00')
  source.status = 'retired'; source.recoveryAmount = 0
  assert.equal(lifecycleEvents(source)[0].title, '已淘汰')
  assert.equal(lifecycleEvents(source).filter(e => e.kind === 'sold').length, 0)
})
test('unknown values stay unknown and cross-item records sort by occurrence', () => {
  const source = item(); source.purchaseDate = null; source.purchaseAmount = null
  const events = lifecycleEvents(source)
  assert.equal(events[1].occurredOn, null)
  assert.equal(events[1].amount, '购买金额待补充')
  const other = item(); other.id = 'other'; other.purchaseDate = '2025-01-01'
  assert.equal([...events, ...lifecycleEvents(other)].sort(compareLifecycleEvents)[0].id, 'other:purchase')
})
test('events carry structured amounts, expense identity and missing facts', () => {
  const source = item()
  const [expense, purchase] = lifecycleEvents(source)
  assert.equal(expense.cents, 9900); assert.equal(expense.expenseId, 'case'); assert.ok(!expense.missing)
  assert.equal(purchase.cents, 229900); assert.equal(purchase.missing, false)
  source.purchaseAmount = null
  const unknown = lifecycleEvents(source).find(e => e.kind === 'purchase')!
  assert.equal(unknown.cents, null); assert.equal(unknown.missing, true); assert.equal(unknown.amount, '购买金额待补充')
  source.status = 'retired'; source.disposalDate = null; source.recoveryAmount = null
  const disposal = lifecycleEvents(source).find(e => e.kind === 'retired')!
  assert.equal(disposal.missing, true); assert.equal(disposal.cents, null)
})
test('records group by month, newest first, with undated records last', () => {
  const rows = [
    { event: { occurredOn: '2026-10-23' }, id: 'a' }, { event: { occurredOn: null }, id: 'b' },
    { event: { occurredOn: '2025-06-07' }, id: 'c' }, { event: { occurredOn: '2026-10-01' }, id: 'd' },
  ]
  const groups = groupByMonth(rows)
  assert.deepEqual(groups.map(g => [g.label, g.rows.map(r => r.id)]), [['2026年10月', ['a', 'd']], ['2025年6月', ['c']], ['日期待补充', ['b']]])
  assert.deepEqual(groupByMonth([]), [])
  assert.equal(dayLabel('2026-01-05'), '1月5日')
  assert.equal(dayLabel(null), '日期待补充')
})
