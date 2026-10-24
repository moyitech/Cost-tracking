import type { ImportEntry, ImportTask } from './import-api'
import { ItemInput, moneyInput, parseMoney } from './domain'

export type ReviewDraft = { revision: number; name: string; amount: string; date: string; note: string; manual: boolean; decision: ImportEntry['duplicate_decision']; existing: string | null; image?: string; imageFileId?: string; imagePresetId?: string; attachments?: ItemInput['attachments'] }
export function reviewDraft(entry: ImportEntry): ReviewDraft {
  return { revision: entry.revision, name: entry.values.name || '', amount: moneyInput(entry.values.purchase_amount_cents), date: entry.values.purchase_date || '', note: entry.values.note || '', image: '', imageFileId: entry.values.image_file_id || undefined, imagePresetId: entry.values.image_preset_id || undefined, attachments: (entry.values.attachment_file_ids || []).map((fileId, i) => ({ fileId, name: `凭证 ${i + 1}`, path: '' })), manual: entry.input_mode === 'manual', decision: entry.duplicate_decision, existing: entry.existing_item_id }
}
export function reviewBody(draft: ReviewDraft, confirmed: boolean, included = true) {
  return { values: { name: draft.name.trim() || null, note: draft.note || null, purchase_amount_cents: parseMoney(draft.amount), purchase_date: draft.date || null }, input_mode: draft.manual ? 'manual' : 'recognized', duplicate_decision: draft.decision, existing_item_id: draft.existing, included: included && draft.decision !== 'skip_existing', confirmed }
}
// Adopting a newer revision is an explicit user action; keep their text but require confirmation again.
export function adoptRevision(draft: ReviewDraft, revision: number): ReviewDraft { return { ...draft, revision, decision: null, existing: null } }

export function reviewInput(draft: ReviewDraft): ItemInput {
  return { name: draft.name, note: draft.note, image: draft.image || '', imageFileId: draft.imageFileId, imagePresetId: draft.imagePresetId, attachments: draft.attachments || [], purchaseAmount: parseMoney(draft.amount), purchaseDate: draft.date || null }
}

export function reviewCards(task: ImportTask): ImportEntry[] {
  return task.entries.filter(e => e.included && !e.saved_item_id && (e.input_mode === 'manual' || e.source_ids.every(id => {
    const source = task.sources.find(s => s.id === id)
    return !!source && source.status === 'ready'
  })))
}
