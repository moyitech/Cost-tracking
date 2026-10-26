import type { Item, Ledger, Space } from './domain'
import type { EventRow, RemoteState } from './ledger-cache'

export type SyncManifest = { profile_version: string; presets_version: string; preset_versions: Record<string, string>; spaces: { id: string; version: string }[]; checked_at: string }
export type OfflineSnapshot = { version: 2; data: Ledger; remote: Record<string, RemoteState>; manifest: SyncManifest | null; lastSyncedAt: string | null }
export type MediaRef = { key: string; fileId?: string; presetId?: string }
export type SyncPorts = {
  manifest(): Promise<SyncManifest>
  metadata(): Promise<Ledger>
  space(id: string, metadata: Space): Promise<{ space: Space; items: Item[]; remote: RemoteState }>
  save(snapshot: OfflineSnapshot): Promise<void>
  publish(snapshot: OfflineSnapshot): void
  media(ref: MediaRef): Promise<void>
  prune(refs: MediaRef[]): Promise<void>
  revoke?(): Promise<void>
}
export const blankSnapshot = (): OfflineSnapshot => ({ version: 2, data: { version: 1, items: [], spaces: [] }, remote: {}, manifest: null, lastSyncedAt: null })
export function isSnapshot(value: unknown): value is OfflineSnapshot {
  const v = value as OfflineSnapshot | null
  return !!v && v.version === 2 && v.data?.version === 1 && Array.isArray(v.data.items) && Array.isArray(v.data.spaces) && !!v.remote && typeof v.remote === 'object'
    && v.data.spaces.every(s => typeof s.id === 'string' && Array.isArray(s.members))
    && v.data.items.every(i => typeof i.id === 'string' && typeof i.spaceId === 'string' && Array.isArray(i.expenses) && Array.isArray(i.history))
    && Object.values(v.remote).every(r => Array.isArray(r.events) && Array.isArray(r.trashIds))
    && (v.manifest === null || (Array.isArray(v.manifest?.spaces) && typeof v.manifest.profile_version === 'string' && !!v.manifest.preset_versions))
    && (v.lastSyncedAt === null || (typeof v.lastSyncedAt === 'string' && Number.isFinite(Date.parse(v.lastSyncedAt))))
}
export const sameManifest = (a: SyncManifest | null, b: SyncManifest) => !!a && a.profile_version === b.profile_version && a.presets_version === b.presets_version
  && a.spaces.length === b.spaces.length && a.spaces.every(s => b.spaces.some(t => t.id === s.id && t.version === s.version))

export async function collectPages<T extends { id: string }>(fetch: (cursor: string | null) => Promise<{ items: T[]; cursor: string | null }>, valid = () => true): Promise<T[]> {
  const rows = new Map<string, T>(); const seen = new Set<string>(); let cursor: string | null = null
  do {
    const page = await fetch(cursor)
    if (!valid()) throw new Error('同步已取消')
    for (const row of page.items) rows.set(row.id, row)
    cursor = page.cursor
    if (cursor && seen.has(cursor)) throw new Error('同步分页异常，请重试')
    if (cursor) seen.add(cursor)
  } while (cursor)
  return [...rows.values()]
}

// Drain all workers before rejecting: no orphan jobs can publish after a failed run.
export async function inPool<T, R>(values: T[], limit: number, work: (value: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(values.length); let index = 0
  const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (index < values.length) { const i = index++; results[i] = await work(values[i]) }
  })
  const settled = await Promise.allSettled(workers)
  const failed = settled.find((r): r is PromiseRejectedResult => r.status === 'rejected')
  if (failed) throw failed.reason
  return results
}

export function mediaReferences(snapshot: OfflineSnapshot): MediaRef[] {
  const refs = new Map<string, MediaRef>()
  const file = (id?: string) => { if (id) refs.set(`file:${id}:preview-v1`, { key: `file:${id}:preview-v1`, fileId: id }) }
  file(snapshot.data.profile?.avatarFileId)
  for (const space of snapshot.data.spaces) { file(space.avatarFileId); for (const member of space.members) file(member.avatarFileId) }
  for (const item of snapshot.data.items) {
    file(item.imageFileId)
    for (const attachment of item.attachments || []) file(attachment.fileId)
    for (const expense of item.expenses) for (const id of expense.attachmentFileIds || []) file(id)
    if (item.imagePresetId) {
      const key = `preset:${item.imagePresetId}:${snapshot.manifest?.preset_versions[item.imagePresetId] || '1'}:preview`
      refs.set(key, { key, presetId: item.imagePresetId })
    }
  }
  return [...refs.values()]
}

export function restrictSnapshot(snapshot: OfflineSnapshot, allowed: Set<string>): OfflineSnapshot {
  return { ...snapshot, data: { ...snapshot.data, spaces: snapshot.data.spaces.filter(s => allowed.has(s.id)), items: snapshot.data.items.filter(i => allowed.has(i.spaceId)) },
    remote: Object.fromEntries(Object.entries(snapshot.remote).filter(([id]) => allowed.has(id))) }
}

export async function synchronize(previous: OfflineSnapshot, ports: SyncPorts, valid: () => boolean): Promise<void> {
  const assertCurrent = () => { if (!valid()) throw new Error('同步已取消') }
  let before = await ports.manifest(); assertCurrent()
  const allowed = new Set(before.spaces.map(s => s.id))
  if (previous.data.spaces.some(s => !allowed.has(s.id))) {
    previous = restrictSnapshot(previous, allowed)
    // Revoke visibility immediately, even if storage is full or the next request fails.
    ports.publish(previous)
    await ports.revoke?.(); assertCurrent()
    await ports.prune(mediaReferences(previous)); assertCurrent()
    await ports.save(previous); assertCurrent()
  }
  let next = previous
  if (!sameManifest(previous.manifest, before) || before.spaces.some(s => !previous.remote[s.id])) {
    const metadata = await ports.metadata(); assertCurrent()
    if (metadata.spaces.length !== allowed.size || metadata.spaces.some(s => !allowed.has(s.id))) throw new Error('空间权限已变化，正在重新核对，请重试')
    const changed = metadata.spaces.filter(space => !previous.remote[space.id] || !previous.manifest?.spaces.some(s => s.id === space.id && s.version === before.spaces.find(v => v.id === space.id)?.version))
    const loaded = await inPool(changed, 2, async space => { const result = await ports.space(space.id, space); assertCurrent(); return result })
    const replaced = new Set(changed.map(s => s.id))
    const remote = { ...previous.remote }
    for (const result of loaded) remote[result.space.id] = result.remote
    next = { ...previous, manifest: before, data: { ...metadata,
      spaces: metadata.spaces.map(s => loaded.find(r => r.space.id === s.id)?.space || { ...s, members: previous.data.spaces.find(old => old.id === s.id)?.members || [] }),
      items: [...previous.data.items.filter(i => allowed.has(i.spaceId) && !replaced.has(i.spaceId)), ...loaded.flatMap(r => r.items)] }, remote }
    const after = await ports.manifest(); assertCurrent()
    if (!sameManifest(before, after)) throw new Error('资料在同步期间发生变化，稍后自动重试')
    before = after
    await ports.save(next); assertCurrent(); ports.publish(next)
  }
  const refs = mediaReferences(next)
  // Reclaim obsolete files before downloads, but never evict a still-referenced preview.
  await ports.prune(refs); assertCurrent()
  await inPool(refs, 3, async ref => { assertCurrent(); await ports.media(ref); assertCurrent() })
  const confirmed = await ports.manifest(); assertCurrent()
  if (!sameManifest(before, confirmed)) throw new Error('资料在同步期间发生变化，稍后自动重试')
  next = { ...next, manifest: confirmed, lastSyncedAt: confirmed.checked_at }
  await ports.save(next); assertCurrent(); ports.publish(next)
}

export const retryDelay = (failures: number) => [60000, 120000, 240000, 300000][Math.min(Math.max(failures - 1, 0), 3)]
export const syncTimeValue = (value: string | null) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '尚未同步'
export const syncTimeLabel = (value: string | null) => value ? `上次同步时间 ${syncTimeValue(value)}` : '尚未同步'
