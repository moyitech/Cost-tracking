import { uid, type ItemInput, type Ledger } from './domain'
import type { Command } from './commands'
import type { ImportClient, ImportEntry, ImportTask, ImportValues } from './import-api'
import { itemImage, ItemImage, validateItemImage } from './item-image'

// Mock and real imports share the same image reference contract.
export type DemoImportValues = ImportValues & { image_preset_id: string | null }

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value))
export function createDemoImports(read: () => Ledger, execute: (command: Command) => Promise<Ledger>): ImportClient {
  let task: ImportTask | null = null; let created = 0
  const check = (id: string) => { if (!task || task.id !== id || task.status === 'canceled') throw new Error('本次添加已结束'); return task }
  const get = async (id: string) => {
    const current = check(id)
    if (current.status === 'queued' || current.status === 'processing') {
      current.status = Date.now() - created >= 1800 ? 'ready' : 'processing'
      current.sources.forEach(s => { s.status = current.status })
      if (current.status === 'ready') {
        current.poll_after_ms = null
        current.entries = ['Sony Alpha 7 IV 全画幅微单机身', 'SanDisk 闪迪 128GB 存储卡', '相机收纳包'].map((name, i) => ({
          id: uid(), revision: 1, source_ids: current.sources.map(s => s.id),
          values: { name, note: '', purchase_amount_cents: [1460000, 49900, 0][i], purchase_date: null, image_file_id: null, image_preset_id: null, attachment_file_ids: [] },
          field_sources: {}, warnings: [], duplicate_candidates: [], duplicate_decision: null, existing_item_id: null, input_mode: 'recognized', included: true, confirmed: false, saved_item_id: null,
        }))
      }
    }
    current.entries.forEach(e => {
      e.duplicate_candidates = read().items.filter(i => !i.deleted && i.spaceId === current.space_id && i.id !== e.saved_item_id && i.name.trim().toLowerCase() === (e.values.name || '').trim().toLowerCase()).map(i => ({ id: i.id, name: i.name, reason: '商品名相同' }))
    })
    return clone(current)
  }
  return {
    get,
    async create(space, ids) {
      created = Date.now()
      task = { id: uid(), space_id: space, status: 'queued', sources: ids.map((file_id, i) => ({ id: uid(), file_id, name: `截图 ${i + 1}`, status: 'queued', attempts: 1, error: null, retryable: false })), entries: [], results: [], poll_after_ms: 500 }
      return clone(task)
    },
    async retry(id) { check(id); throw new Error('请重新选择截图体验示例') },
    async cancel(id) { if (task?.id === id) { task.status = 'canceled'; task = null } },
    async patch(id, entryId, revision, body) {
      const current = check(id); const entry = current.entries.find(e => e.id === entryId)!
      if (!entry || entry.saved_item_id || entry.revision !== revision) throw new Error('物品内容已变化，请重试')
      const patch = body as Partial<ImportEntry>
      Object.assign(entry, patch, { values: { ...entry.values, ...patch.values }, revision: revision + 1 })
      await get(id)
      return clone(entry)
    },
    async commit(id, entries) {
      const current = check(id); const results: ImportTask['results'] = []
      for (const requested of entries) {
        const entry = current.entries.find(e => e.id === requested.entry_id)!
        if (entry.saved_item_id) { results.push({ entry_id: entry.id, status: 'already_saved', item_id: entry.saved_item_id }); continue }
        if (entry.revision !== requested.revision || !entry.confirmed) throw new Error('请先核对物品信息')
        if (entry.duplicate_candidates.length && entry.duplicate_decision !== 'create_independent') throw new Error('已有相似物品，请先确认')
        const v = entry.values
        const image: ItemImage = itemImage({ image: v.image_file_id || '', imagePresetId: v.image_preset_id || undefined })
        const input: ItemInput = { name: v.name || '', note: v.note || '', purchaseAmount: v.purchase_amount_cents, purchaseDate: v.purchase_date, ...image, attachments: v.attachment_file_ids.map((path, i) => ({ name: `凭证 ${i + 1}`, path })) }
        const next = await execute({ type: 'create', spaceId: current.space_id, input, key: entry.id })
        entry.saved_item_id = next.items.find(i => i.importKey === entry.id)!.id
        entry.revision++
        results.push({ entry_id: entry.id, status: 'saved', item_id: entry.saved_item_id })
      }
      return { results }
    },
  }
}
export async function demoInputBody(input: ItemInput): Promise<DemoImportValues> {
  validateItemImage(input)
  return { name: input.name, note: input.note, purchase_amount_cents: input.purchaseAmount, purchase_date: input.purchaseDate, image_file_id: input.image || input.imageFileId || null, image_preset_id: input.imagePresetId || null, attachment_file_ids: (input.attachments || []).map(a => a.path || a.fileId!) }
}
