import test from 'node:test'
import assert from 'node:assert/strict'
import { IDBFactory } from 'fake-indexeddb'
import { mkdtemp, mkdir, readFile, writeFile, rename, copyFile, unlink, readdir, rm, access, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { OfflineStorage } from '../src/offline-storage'
import { blankSnapshot, synchronize } from '../src/offline-sync'

const snapshot = (time: string | null = null) => ({ ...blankSnapshot(), lastSyncedAt: time })

test('IndexedDB restores committed data and blobs across instances, isolated by API and account', async () => {
  globalThis.indexedDB = new IDBFactory()
  const a = new OfflineStorage('api', 'alice', {} as any)
  const saved = snapshot('2026-10-25T02:00:00Z')
  await a.writeSnapshot(saved)
  const again = new OfflineStorage('api', 'alice', {} as any)
  assert.deepEqual(await again.readSnapshot(), saved)
  assert.equal(await new OfflineStorage('api', 'bob', {} as any).readSnapshot(), null)
  assert.equal(await new OfflineStorage('other-api', 'alice', {} as any).readSnapshot(), null)
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(new Blob(['image-bytes'], { type: 'image/webp' }))
  try { assert.ok((await a.cacheMedia('file:photo:preview-v1', 'https://image.test')).startsWith('blob:')) } finally { globalThis.fetch = originalFetch }
  assert.ok(await again.mediaUrl('file:photo:preview-v1'))
  await a.dropSnapshot()
  assert.equal(await again.readSnapshot(), null)
  assert.ok(await again.mediaUrl('file:photo:preview-v1'))
  await a.clear()
  assert.equal(await new OfflineStorage('api', 'alice', {} as any).mediaUrl('file:photo:preview-v1'), null)
  again.dispose()
})

test('IndexedDB failure preserves the old generation and pruning retains current thumbnails', async () => {
  globalThis.indexedDB = new IDBFactory()
  const a = new OfflineStorage('api', 'quota', {} as any)
  const old = snapshot('2026-10-25T02:00:00Z'); await a.writeSnapshot(old)
  const bad = { ...snapshot(), extra: () => {} }
  await assert.rejects(a.writeSnapshot(bad), /离线缓存保存失败/)
  assert.deepEqual(await a.readSnapshot(), old)
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(new Blob(['image-bytes'], { type: 'image/webp' }))
  try { await a.cacheMedia('keep', 'https://image.test'); await a.cacheMedia('obsolete', 'https://image.test') } finally { globalThis.fetch = originalFetch }
  await a.prune(new Set(['keep']))
  assert.ok(await a.mediaUrl('keep')); assert.equal(await a.mediaUrl('obsolete'), null)
  a.dispose()
})

async function nativeFixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'ct-offline-'))
  const pointers = new Map<string, unknown>(); let failWrite = false
  const methods: Record<string, (o: any) => Promise<unknown>> = {
    mkdir: o => mkdir(o.dirPath, { recursive: o.recursive }), access: o => access(o.path),
    readFile: async o => ({ data: await readFile(o.filePath, o.encoding) }),
    writeFile: async o => { if (failWrite) throw new Error('ENOSPC'); await writeFile(o.filePath, o.data, o.encoding) },
    rename: o => rename(o.oldPath, o.newPath), copyFile: o => copyFile(o.srcPath, o.destPath),
    readdir: async o => ({ files: await readdir(o.dirPath) }), unlink: o => unlink(o.filePath),
    rmdir: o => rm(o.dirPath, { recursive: true, force: true }), stat: async o => ({ stats: await stat(o.path) }),
  }
  const fs = Object.fromEntries(Object.entries(methods).map(([key, fn]) => [key, (o: any) => { fn(o).then(o.success, o.fail) }]))
  const platform = { env: { USER_DATA_PATH: root }, getFileSystemManager: () => fs, getStorageSync: (key: string) => pointers.get(key), setStorageSync: (key: string, value: unknown) => pointers.set(key, value), removeStorageSync: (key: string) => pointers.delete(key), downloadFile: async () => ({ statusCode: 200, tempFilePath: path.join(root, 'source') }) }
  return { root, platform, pointers, set failWrite(value: boolean) { failWrite = value } }
}

test('WeChat filesystem commits atomically, recovers a previous generation, and preserves it on quota failure', async () => {
  const previousEnv = process.env.TARO_ENV; process.env.TARO_ENV = 'weapp'
  const f = await nativeFixture()
  try {
    const a = new OfflineStorage('api', 'native', f.platform as any)
    const first = snapshot('2026-10-25T02:00:00Z'); await a.writeSnapshot(first)
    const second = snapshot('2026-10-25T03:00:00Z'); await a.writeSnapshot(second)
    const pointer = [...f.pointers.values()][0] as { current: string; previous: string }
    await writeFile(path.join(f.root, 'objet-offline-v2/api/native', pointer.current), 'corrupted')
    assert.deepEqual(await a.readSnapshot(), first)
    f.failWrite = true
    await assert.rejects(a.writeSnapshot(snapshot()), /存储空间/)
    assert.deepEqual(await a.readSnapshot(), first)
    await a.dropSnapshot()
    assert.equal(await a.readSnapshot(), null)
    assert.equal(f.pointers.size, 0)
  } finally { if (previousEnv === undefined) delete process.env.TARO_ENV; else process.env.TARO_ENV = previousEnv; await rm(f.root, { recursive: true, force: true }) }
})

test('WeChat persists previews and account disposal fences a late download', async () => {
  const previousEnv = process.env.TARO_ENV; process.env.TARO_ENV = 'weapp'
  const f = await nativeFixture()
  try {
    await writeFile(path.join(f.root, 'source'), 'image-bytes')
    const a = new OfflineStorage('api', 'native', f.platform as any)
    const url = await a.cacheMedia('preview', 'https://image.test')
    assert.equal(await readFile(url, 'utf8'), 'image-bytes')
    const cold = new OfflineStorage('api', 'native', f.platform as any)
    assert.equal(await cold.mediaUrl('preview'), url)
    let release!: () => void
    f.platform.downloadFile = async () => { await new Promise<void>(resolve => { release = resolve }); return { statusCode: 200, tempFilePath: path.join(f.root, 'source') } }
    const pending = a.cacheMedia('late', 'https://image.test')
    const rejected = assert.rejects(pending, /取消/)
    // Wait for the actual adapter to reach the deferred network boundary.
    while (!release) await new Promise(resolve => setTimeout(resolve, 1))
    await a.clear(); release(); await rejected
    assert.equal(await new OfflineStorage('api', 'native', f.platform as any).mediaUrl('late'), null)
    assert.equal(await cold.mediaUrl('preview'), null)
  } finally { if (previousEnv === undefined) delete process.env.TARO_ENV; else process.env.TARO_ENV = previousEnv; await rm(f.root, { recursive: true, force: true }) }
})

test('WeChat heartbeat preserves browsed presets across reopening while pruning old versions and private orphans', async () => {
  const previousEnv = process.env.TARO_ENV; process.env.TARO_ENV = 'weapp'
  const f = await nativeFixture(); let downloads = 0
  f.platform.downloadFile = async () => {
    downloads++; const tempFilePath = path.join(f.root, 'download-' + downloads)
    await writeFile(tempFilePath, 'image-bytes')
    return { statusCode: 200, tempFilePath }
  }
  try {
    const storage = new OfflineStorage('api', 'native', f.platform as any)
    const retained = 'preset:browsed:2:preview'; const obsolete = 'preset:browsed:1:preview'; const orphan = 'file:revoked:preview-v1'
    for (const key of [retained, obsolete, orphan]) await storage.cacheMedia(key, 'https://image.test')
    const state = { ...snapshot(), manifest: { profile_version: '1', presets_version: '2', preset_versions: { browsed: '2' }, spaces: [], checked_at: '2026-10-26T00:00:00Z' } }
    await synchronize(state, {
      manifest: async () => state.manifest,
      metadata: async () => { throw new Error('unchanged metadata should not be fetched') },
      space: async () => { throw new Error('no space to fetch') },
      save: value => storage.writeSnapshot(value), publish: () => {},
      prune: keys => storage.prune(keys), media: async () => { throw new Error('unselected presets are not required downloads') },
    }, () => true)
    const reopened = new OfflineStorage('api', 'native', f.platform as any)
    assert.ok(await reopened.cacheMedia(retained, 'https://image.test')); assert.equal(downloads, 3)
    assert.equal(await reopened.mediaUrl(obsolete), null); assert.equal(await reopened.mediaUrl(orphan), null)
  } finally { if (previousEnv === undefined) delete process.env.TARO_ENV; else process.env.TARO_ENV = previousEnv; await rm(f.root, { recursive: true, force: true }) }
})
