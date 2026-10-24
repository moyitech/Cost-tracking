import { Audit, Item, retiredItemFields, Space } from './domain'
export type Page<T> = { items: T[]; next_cursor: string | null }
export type ServerMetrics = { as_of_date: string; extra_cents: number; known_investment_cents: number; total_investment_cents: number | null; holding_days: number | null; net_cost_cents: number | null; current_daily_yuan: string | null; actual_daily_yuan: string | null }
export type ApiItem = { created_at?: string; id: string; space_id: string; name: string; note: string | null; purchase_amount_cents: number | null; purchase_date: string | null; image_file_id: string | null; image_preset_id?: string | null; attachment_file_ids: string[]; status: Item['status']; disposal_date: string | null; recovery_amount_cents: number | null; deleted_at: string | null; revision: number; metrics: ServerMetrics; expenses: { id: string; category: string; amount_cents: number; occurred_on: string; note: string | null; attachment_file_ids: string[] }[] }
export type ApiEvent = { id: string; item_id: string | null; title: string; occurred_on: string | null; recorded_at: string; actor: { id: string; display_name: string }; changes: { field: string; before: unknown; after: unknown }[] }
export type Summary = { as_of_date: string; item_count: number; status_counts: Record<Item['status'], number>; known_investment_cents: number; purchase_amount_missing_count: number; current_daily: { known_amount_yuan: string | null; holding_count: number; incomplete_count: number; complete: boolean } }
export type Analytics = { as_of_date: string; item_count: number; status_counts: Record<Item['status'], number>; known_purchase_cents: number; extra_cents: number; purchase_amount_missing_count: number; disposed: { item_count: number; known_net_cost_cents: number | null; incomplete_count: number } }
export type Filters = { q: string; status: string }
export const emptyFilters: Filters = { q: '', status: 'all' }
export type ApiSpace = Omit<Space, 'members'> & { avatar_file_id?: string | null; member_count?: number | null; item_count?: number | null }
export const apiSpace = (s: ApiSpace): Space => ({ ...s, avatarFileId: s.avatar_file_id || undefined, memberCount: s.member_count ?? undefined, itemCount: s.item_count ?? undefined, members: [] })
export function apiItem(i: ApiItem): Item {
  return { id: i.id, createdAt: i.created_at, spaceId: i.space_id, name: i.name, note: i.note || '',
    purchaseAmount: i.purchase_amount_cents, purchaseDate: i.purchase_date, image: '', imageFileId: i.image_file_id || undefined, imagePresetId: i.image_preset_id || undefined,
    attachments: i.attachment_file_ids.map(id => ({ fileId: id, name: '凭证', path: '' })),
    status: i.status, disposalDate: i.disposal_date, recoveryAmount: i.recovery_amount_cents, deleted: !!i.deleted_at, revision: i.revision,
    expenses: i.expenses.map(e => ({ id: e.id, category: e.category, amount: e.amount_cents, date: e.occurred_on, note: e.note || '', attachmentFileIds: e.attachment_file_ids })), history: [], serverMetrics: i.metrics }
}
const labels: Record<string, string> = { name: '名称', purchase_amount_cents: '购入金额', purchase_date: '购买日期', status: '状态', recovery_amount_cents: '回收金额', disposal_date: '处置日期', note: '备注', deleted_at: '回收站状态', expenses: '支出', image_file_id: '主图', image_preset_id: '预设图片', attachment_file_ids: '凭证' }
export function apiEvent(e: ApiEvent): Audit & { itemId: string | null } {
  const display = (value: unknown) => value == null ? '未填写' : typeof value === 'object' ? JSON.stringify(value) : String(value)
  return { id: e.id, itemId: e.item_id, title: e.title, occurredOn: e.occurred_on, recordedAt: e.recorded_at, actor: e.actor.display_name,
    detail: e.changes.filter(c => !retiredItemFields.includes(c.field)).map(c => `${labels[c.field] || c.field}：${(c.field.includes('file') || c.field === 'image_preset_id') ? '附件关联已更新' : `${display(c.before)} → ${display(c.after)}`}`).join('；') }
}
