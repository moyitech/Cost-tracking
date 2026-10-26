import { Item, money, statusLabels } from './domain'

export type LifecycleEvent = {
  id: string
  kind: 'purchase' | 'expense' | 'sold' | 'retired'
  title: string
  occurredOn: string | null
  amount: string
  // Structured value for display; `amount` keeps the original text form.
  cents: number | null
  expenseId?: string
  detail?: string
  // The business record still lacks its amount or date.
  missing?: boolean
}

// The lifecycle describes current business facts, never audit operations.
// Stable source IDs keep corrections from becoming duplicate milestones.
export function lifecycleEvents(item: Item): LifecycleEvent[] {
  if (item.deleted) return []
  const events: LifecycleEvent[] = [{
    id: `${item.id}:purchase`, kind: 'purchase', title: '购买',
    occurredOn: item.purchaseDate,
    amount: item.purchaseAmount === null ? '购买金额待补充' : `¥${money(item.purchaseAmount)}`,
    cents: item.purchaseAmount, missing: item.purchaseAmount === null || !item.purchaseDate,
  }]
  for (const expense of item.expenses) {
    events.push({
      id: `${item.id}:expense:${expense.id}`, kind: 'expense',
      title: expense.category === '配件' ? '添加配件' : expense.category === '其他' ? '追加支出' : expense.category,
      occurredOn: expense.date, amount: `¥${money(expense.amount)}`, cents: expense.amount, expenseId: expense.id,
      detail: expense.note.trim() || undefined,
    })
  }
  if (item.status === 'sold' || item.status === 'retired') {
    events.push({
      id: `${item.id}:disposal`, kind: item.status, title: statusLabels[item.status],
      occurredOn: item.disposalDate,
      amount: item.recoveryAmount === null ? '回收金额待补充' : `回收 ¥${money(item.recoveryAmount)}`,
      cents: item.recoveryAmount, missing: item.recoveryAmount === null || !item.disposalDate,
    })
  }
  return events.sort(compareLifecycleEvents)
}

export function compareLifecycleEvents(a: LifecycleEvent, b: LifecycleEvent) {
  const order = { purchase: 0, expense: 1, sold: 2, retired: 2 }
  return (b.occurredOn || '').localeCompare(a.occurredOn || '') || order[b.kind] - order[a.kind] || a.id.localeCompare(b.id)
}

export const dateLabel = (date: string | null) => date ? date.replace(/-/g, '.') : '日期待补充'
export const dayLabel = (date: string | null) => date ? `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日` : '日期待补充'

// Newest month first; undated records stay together at the end.
export function groupByMonth<T extends { event: Pick<LifecycleEvent, 'occurredOn'> }>(rows: T[]) {
  const months = new Map<string, T[]>()
  for (const row of rows) {
    const key = row.event.occurredOn?.slice(0, 7) || ''
    months.set(key, [...(months.get(key) || []), row])
  }
  return [...months.entries()]
    .sort(([a], [b]) => !a ? 1 : !b ? -1 : b.localeCompare(a))
    .map(([key, monthRows]) => ({ key: key || 'undated', label: key ? `${Number(key.slice(0, 4))}年${Number(key.slice(5, 7))}月` : '日期待补充', rows: monthRows }))
}
