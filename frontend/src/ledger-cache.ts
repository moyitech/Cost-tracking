import type { Audit, Item, Ledger } from './domain'

export type EventRow = Audit & { itemId: string | null }
export type RemoteState = { events: EventRow[]; eventsCursor: string | null; trashIds: string[]; trashCursor: string | null }
export const emptyRemote: RemoteState = { events: [], eventsCursor: null, trashIds: [], trashCursor: null }
export type LedgerCache = { version: 1; data: Ledger; readySpaces: string[]; remote: Record<string, RemoteState> }

// Fetch complete lists before publishing them. A failed page never replaces a good snapshot.
export async function collectItems(fetchPage: (cursor?: string | null) => Promise<{ items: Item[]; cursor: string | null }>, current = () => true): Promise<Item[] | null> {
  const items = new Map<string, Item>(); const seen = new Set<string>()
  let cursor: string | null = null
  do {
    const page = await fetchPage(cursor)
    if (!current()) return null
    for (const item of page.items) items.set(item.id, item)
    cursor = page.cursor
    if (cursor && seen.has(cursor)) throw new Error('同步未完成，请重新刷新')
    if (cursor) seen.add(cursor)
  } while (cursor)
  return [...items.values()]
}

export function mergeItems(data: Ledger, items: Item[]): Ledger {
  const previous = new Map(data.items.map(item => [item.id, item]))
  const incoming = items.map(item => {
    const old = previous.get(item.id)
    if (old && old.revision > item.revision) return old
    return old && !item.history.length ? { ...item, history: old.history } : item
  })
  const ids = new Set(items.map(item => item.id))
  return { ...data, items: [...incoming, ...data.items.filter(item => !ids.has(item.id))] }
}

// Remote cache stores references, never data URLs, image bytes or local picker paths.
export function cacheSnapshot(data: Ledger, readySpaces: string[], remote: Record<string, RemoteState>): LedgerCache {
  return { version: 1, data: { ...data, items: data.items.map(item => ({ ...item, image: '', attachments: item.attachments?.map(a => ({ ...a, path: '' })) })) }, readySpaces, remote }
}
export function validCache(value: unknown): value is LedgerCache {
  const cache = value as LedgerCache | null
  return !!cache && cache.version === 1 && cache.data?.version === 1 && Array.isArray(cache.data.items) && Array.isArray(cache.data.spaces) && Array.isArray(cache.readySpaces) && !!cache.remote && typeof cache.remote === 'object'
}

// Coalesce refreshes and fence responses after writes, account changes or space switches.
export class SyncGate {
  private epoch = 0
  private flight: Promise<void> | null = null
  token() { return this.epoch }
  accepts(token: number) { return token === this.epoch }
  invalidate() { this.epoch++; this.flight = null }
  run(work: (token: number) => Promise<void>): Promise<void> {
    if (this.flight) return this.flight
    const token = this.epoch
    const flight = work(token).finally(() => { if (this.flight === flight) this.flight = null })
    this.flight = flight
    return flight
  }
}
