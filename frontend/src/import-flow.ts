import type { ImportTask } from './import-api'
import { reviewDraft, type ReviewDraft } from './import-review'

export type ImportPhase = 'select' | 'uploading' | 'queued' | 'processing' | 'complete' | 'review' | 'failed'
export function carouselIndex(value: unknown, count: number): number | null {
  // H5 input/select change events also bubble through the Swiper host.
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < count ? value : null
}
export function shouldPoll(task: ImportTask | null, visible: boolean) {
  return visible && !!task?.poll_after_ms && (task.status === 'queued' || task.status === 'processing')
}
export function importReviewComplete(task: ImportTask | null) {
  return task?.status === 'ready' && task.entries.length > 0 && task.entries.every(entry => !entry.included || !!entry.saved_item_id)
}
export function mergeReviewDrafts(drafts: Record<string, ReviewDraft>, task: ImportTask) {
  return Object.fromEntries(task.entries.filter(e => e.included && !e.saved_item_id).map(e => [e.id, drafts[e.id] || reviewDraft(e)]))
}
export async function uploadSources(paths: string[], upload: (path: string) => Promise<string>, onUploaded: (count: number) => void, current: () => boolean) {
  const ids: string[] = []
  for (const path of paths) {
    if (!current()) return null
    ids.push(await upload(path))
    if (!current()) return null
    onUploaded(ids.length)
  }
  // Identical H5 data URLs can reuse one uploaded file. Send it only once.
  return [...new Set(ids)]
}
// Fences all async results, including native image-picker and upload callbacks.
export class ImportLifetime {
  private generation = 0
  private alive = true
  token() { return this.generation }
  accepts(token: number) { return this.alive && token === this.generation }
  reset() { this.generation++; return this.generation }
  dispose() { this.alive = false; this.generation++ }
}
