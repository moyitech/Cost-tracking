export type Status = 'active' | 'sold' | 'retired'
export type Role = 'admin' | 'editor' | 'viewer'
export type Space = { id: string; name: string; kind: 'personal' | 'family'; role: Role; members: { id: string; name: string; role: Role }[] }
export type Expense = { id: string; category: string; amount: number; date: string; note: string }
export type Audit = { id: string; title: string; occurredOn: string | null; recordedAt: string; actor: string; detail?: string }
export type Item = {
  id: string; spaceId: string; name: string; category: string; brand: string; model: string;
  image: string; purchaseAmount: number | null; purchaseDate: string | null;
  status: Status; disposalDate: string | null; recoveryAmount: number | null;
  location: string; channel: string; serial: string; warranty: string; note: string; attachments?: { name: string; path: string }[];
  expenses: Expense[]; history: Audit[]; deleted: boolean; revision: number; importKey?: string;
}
export type ItemInput = Pick<Item, 'name' | 'category' | 'brand' | 'model' | 'image' | 'purchaseAmount' | 'purchaseDate' | 'location' | 'channel' | 'serial' | 'warranty' | 'note' | 'attachments'>
export type Invitation = { id: string; code: string; spaceId: string; role: 'editor' | 'viewer'; status: 'pending' | 'accepted' | 'revoked'; memberId?: string }
export type Ledger = { version: 1; items: Item[]; spaces: Space[]; invitations?: Invitation[] }
export const statusLabels: Record<Status, string> = { active: '在用', sold: '已出售', retired: '已淘汰' }
export const roleLabels: Record<Role, string> = { admin: '管理者', editor: '编辑者', viewer: '查看者' }
export const categories = ['数码', '数码摄影', '生活家电', '户外运动', '家具', '存储耗材与配件', '未分类']
export const isDisposed = (item: Pick<Item, 'status'>) => item.status === 'sold' || item.status === 'retired'
export const canEdit = (space?: Space) => !!space && space.role !== 'viewer'
export function today() {
  // UTC+8 calendar date; independent of the device's local timezone.
  return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
}
export function dateNumber(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('请输入有效日期')
  const n = Date.parse(`${date}T00:00:00Z`)
  if (!Number.isFinite(n) || new Date(n).toISOString().slice(0, 10) !== date) throw new Error('请输入有效日期')
  return n / 86400000
}
export function validateDate(date: string | null, label: string, now = today()) {
  if (date && dateNumber(date) > dateNumber(now)) throw new Error(`${label}不能晚于今天`)
}
export function parseMoney(value: string, required = false): number | null {
  const s = value.trim()
  if (!s) { if (required) throw new Error('请填写金额，0 元也需要明确填写'); return null }
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new Error('金额须为非负数字，最多两位小数')
  const [whole, fraction = ''] = s.split('.')
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  if (!Number.isSafeInteger(cents) || cents > 99999999900) throw new Error('金额超出可记录范围')
  return cents
}
export const moneyInput = (cents: number | null) => cents === null ? '' : (cents / 100).toFixed(2)
export const money = (cents: number | null, digits = 2) => cents === null ? '待补充' : (cents / 100).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
export function metrics(item: Item, now = today()) {
  const extra = item.expenses.reduce((sum, e) => sum + e.amount, 0)
  const known = (item.purchaseAmount ?? 0) + extra
  const total = item.purchaseAmount === null ? null : known
  const end = isDisposed(item) ? item.disposalDate : now
  const days = item.purchaseDate && end ? dateNumber(end) - dateNumber(item.purchaseDate) + 1 : null
  const validDays = days !== null && days > 0 ? days : null
  const net = isDisposed(item) ? total !== null && item.recoveryAmount !== null ? total - item.recoveryAmount : null : total
  return { extra, known, total, days: validDays, net, daily: validDays && net !== null ? net / validDays : null }
}
export function spaceDaily(items: Item[], now = today()) {
  const holding = items.filter(i => !i.deleted && !isDisposed(i))
  const values = holding.map(i => metrics(i, now).daily)
  return { amount: values.reduce<number>((sum, value) => sum + (value ?? 0), 0), incomplete: values.filter(v => v === null).length, count: holding.length }
}
export function validateInput(input: ItemInput, now = today()) {
  if (!input.name.trim()) throw new Error('请填写物品名称')
  validateDate(input.purchaseDate, '购买日期', now)
  if (input.purchaseAmount !== null && (!Number.isSafeInteger(input.purchaseAmount) || input.purchaseAmount < 0)) throw new Error('购入金额无效')
}
export function validateExpense(item: Item, expense: Expense, now = today()) {
  if (!expense.category) throw new Error('请选择支出类别')
  if (!expense.date) throw new Error('请填写支出日期')
  validateDate(expense.date, '支出日期', now)
  if (item.purchaseDate && expense.date < item.purchaseDate) throw new Error('支出日期不能早于购买日期')
  if (item.disposalDate && expense.date > item.disposalDate) throw new Error('请补录处置当天或之前发生的支出')
  if (!Number.isSafeInteger(expense.amount) || expense.amount < 0) throw new Error('支出金额无效')
}
export function validateDisposal(item: Item, date: string, recovery: number | null, confirmedZero: boolean, now = today()) {
  if (!date) throw new Error('请填写处置日期')
  validateDate(date, '处置日期', now)
  if (item.purchaseDate && date < item.purchaseDate) throw new Error('处置日期不能早于购买日期')
  if (item.expenses.some(e => e.date > date)) throw new Error('处置日期不能早于已有支出日期，请先核对支出')
  if (recovery === null) throw new Error('回收金额未知时，请先保留草稿')
  if (!Number.isSafeInteger(recovery) || recovery < 0) throw new Error('回收金额无效')
  if (recovery === 0 && !confirmedZero) throw new Error('请确认本次没有收到回收款')
}
export const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
export function audit(title: string, occurredOn: string | null = today(), detail = ''): Audit {
  return { id: uid(), title, occurredOn, recordedAt: new Date().toISOString(), actor: '我', detail }
}
export function newItem(input: ItemInput, spaceId: string, id = uid()): Item {
  validateInput(input)
  return { ...input, name: input.name.trim(), category: input.category || '未分类', id, spaceId, status: 'active', disposalDate: null, recoveryAmount: null, expenses: [], history: [audit('购入建档', input.purchaseDate)], deleted: false, revision: 1 }
}

// Compatibility boundary for snapshots saved before the idle state was removed.
export type StoredLedger = Omit<Ledger, 'items'> & { items: (Omit<Item, 'status'> & { status: Status | 'idle' })[] }
export function migrateLedger(value: StoredLedger): Ledger {
  if (!value.items.some(item => item.status === 'idle')) return value as Ledger
  return { ...value, items: value.items.map(item => item.status === 'idle'
    ? { ...item, status: 'active', revision: item.revision + 1 }
    : item as Item) }
}
