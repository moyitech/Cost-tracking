import { Item, money, statusLabels } from './domain'

export type LifecycleEvent = {
  id: string
  kind: 'purchase' | 'expense' | 'sold' | 'retired'
  title: string
  occurredOn: string | null
  amount: string
  detail?: string
}

// The lifecycle describes current business facts, never audit operations.
// Stable source IDs keep corrections from becoming duplicate milestones.
export function lifecycleEvents(item: Item): LifecycleEvent[] {
  if (item.deleted) return []
  const events: LifecycleEvent[] = [{
    id: `${item.id}:purchase`, kind: 'purchase', title: '购买',
    occurredOn: item.purchaseDate,
    amount: item.purchaseAmount === null ? '购买金额待补充' : `¥${money(item.purchaseAmount)}`,
  }]
  for (const expense of item.expenses) {
    events.push({
      id: `${item.id}:expense:${expense.id}`, kind: 'expense',
      title: expense.category === '配件' ? '添加配件' : expense.category === '其他' ? '追加支出' : expense.category,
      occurredOn: expense.date, amount: `¥${money(expense.amount)}`,
      detail: expense.note.trim() || undefined,
    })
  }
  if (item.status === 'sold' || item.status === 'retired') {
    events.push({
      id: `${item.id}:disposal`, kind: item.status, title: statusLabels[item.status],
      occurredOn: item.disposalDate,
      amount: item.recoveryAmount === null ? '回收金额待补充' : `回收 ¥${money(item.recoveryAmount)}`,
    })
  }
  return events.sort(compareLifecycleEvents)
}

export function compareLifecycleEvents(a: LifecycleEvent, b: LifecycleEvent) {
  const order = { purchase: 0, expense: 1, sold: 2, retired: 2 }
  return (b.occurredOn || '').localeCompare(a.occurredOn || '') || order[b.kind] - order[a.kind] || a.id.localeCompare(b.id)
}
