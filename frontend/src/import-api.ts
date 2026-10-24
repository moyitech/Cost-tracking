import { api } from './services'
import type { ApiItem } from './api-types'

export type ImportValues = Pick<ApiItem, 'name' | 'note' | 'purchase_amount_cents' | 'purchase_date' | 'image_file_id' | 'image_preset_id' | 'attachment_file_ids'>
export type ImportEntry = { id: string; revision: number; source_ids: string[]; values: Omit<ImportValues, 'name'> & { name: string | null }; field_sources: Record<string, { text?: string; manual?: boolean; needs_review?: boolean; source_ids?: string[] }>; warnings: string[]; duplicate_candidates: { id: string; name: string; reason: string }[]; duplicate_decision: 'unresolved' | 'skip_existing' | 'create_independent' | null; existing_item_id: string | null; input_mode: 'recognized' | 'manual'; included: boolean; confirmed: boolean; saved_item_id: string | null }
export type ImportResult = { entry_id: string; status: 'saved' | 'already_saved' | 'skipped' | 'failed'; item_id?: string; error?: { message: string } }
export type ImportTask = { id: string; space_id: string; status: string; sources: { id: string; file_id: string; name: string; status: string; attempts: number; error: { message: string } | null; retryable: boolean }[]; entries: ImportEntry[]; results: ImportResult[]; poll_after_ms: number | null }
export const imports = {
  get: (id: string) => api.request<ImportTask>(`/imports/${id}`),
  create: (space: string, ids: string[], key: string) => api.request<ImportTask>(`/spaces/${space}/imports`, 'POST', { source_file_ids: ids }, { 'Idempotency-Key': key }),
  retry: (id: string, key: string) => api.request<ImportTask>(`/imports/${id}/retry`, 'POST', {}, { 'Idempotency-Key': key }),
  patch: (id: string, entry: string, revision: number, body: object) => api.request<ImportEntry>(`/imports/${id}/entries/${entry}`, 'PATCH', body, { 'If-Match': `"${revision}"` }),
  commit: (id: string, entries: { entry_id: string; revision: number }[], key: string) => api.request<{ results: ImportResult[] }>(`/imports/${id}/commit`, 'POST', { entries }, { 'Idempotency-Key': key }),
  cancel: (id: string) => api.request<void>(`/imports/${id}`, 'DELETE'),
}
export type ImportClient = typeof imports
