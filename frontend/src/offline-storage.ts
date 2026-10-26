import type Taro from '@tarojs/taro'
import type { OfflineSnapshot } from './offline-sync'
import { isSnapshot } from './offline-sync'

const storageFailure = () => new Error('离线缓存保存失败，可能是本机存储空间不足；请清理空间后重试')
const cancelled = () => new Error('账号已变化，同步已取消')

/** Each instance permanently owns one API/account. Async completions never consult the current account. */
export class OfflineStorage {
  private active = true
  private queue: Promise<unknown> = Promise.resolve()
  private urls = new Map<string, string>()
  private database: Promise<IDBDatabase> | null = null
  private native = process.env.TARO_ENV === 'weapp'
  private namespace: string
  private root: string
  private pointerKey: string
  constructor(api: string, user: string, private platform: typeof Taro) {
    this.namespace = `objet-offline-v2:${api}:${user}:`
    this.root = this.native ? `${this.platform.env.USER_DATA_PATH}/objet-offline-v2/${encodeURIComponent(api)}/${encodeURIComponent(user)}` : ''
    this.pointerKey = `${this.namespace}pointer`
  }
  private assertActive() { if (!this.active) throw cancelled() }
  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const task = this.queue.then(work)
    this.queue = task.catch(() => {})
    return task
  }
  private fs(method: string, options: Record<string, unknown>): Promise<any> {
    return new Promise((resolve, reject) => (this.platform.getFileSystemManager() as any)[method]({ ...options, success: resolve, fail: reject }))
  }
  private async mkdir() { await this.fs('mkdir', { dirPath: this.root, recursive: true }).catch(async error => { await this.fs('access', { path: this.root }).catch(() => { throw error }) }) }
  private db() {
    if (!this.database) this.database = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('objet-offline-v2', 1)
      req.onupgradeneeded = () => req.result.createObjectStore('cache')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(storageFailure())
      req.onblocked = () => reject(storageFailure())
    }).catch(error => { this.database = null; throw error })
    return this.database
  }
  private async get<T>(key: string): Promise<T | undefined> {
    const db = await this.db()
    return new Promise((resolve, reject) => {
      const req = db.transaction('cache').objectStore('cache').get(this.namespace + key)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(storageFailure())
    })
  }
  private async transaction(work: (store: IDBObjectStore) => void) {
    const db = await this.db(); this.assertActive()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('cache', 'readwrite'); work(tx.objectStore('cache'))
      tx.oncomplete = () => resolve()
      tx.onerror = tx.onabort = () => reject(storageFailure())
    })
  }
  async readSnapshot(): Promise<OfflineSnapshot | null> {
    this.assertActive()
    if (!this.native) { const value = await this.get<unknown>('snapshot'); return isSnapshot(value) ? value : null }
    const pointer = this.platform.getStorageSync<{ current: string; previous?: string }>(this.pointerKey)
    for (const name of [pointer?.current, pointer?.previous]) {
      if (!name || !/^snapshot-[\w-]+\.json$/.test(name)) continue
      try { const result = await this.fs('readFile', { filePath: `${this.root}/${name}`, encoding: 'utf8' }); const value: unknown = JSON.parse(result.data); if (isSnapshot(value)) return value } catch { /* Try the last committed generation. */ }
    }
    return null
  }
  writeSnapshot(snapshot: OfflineSnapshot): Promise<void> {
    return this.serialize(async () => {
      this.assertActive()
      // Transport URLs and picker paths are transient; all media is resolved through the separate index.
      snapshot = { ...snapshot, data: { ...snapshot.data, items: snapshot.data.items.map(i => ({ ...i, image: '', attachments: i.attachments?.map(a => ({ ...a, path: '' })) })) } }
      let temporary = ''; let candidate = ''; let committed = false
      try {
        if (!this.native) { await this.transaction(store => store.put(snapshot, this.namespace + 'snapshot')); return }
        await this.mkdir(); this.assertActive()
        const name = `snapshot-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
        const temp = `${this.root}/${name}.tmp`
        temporary = temp; candidate = `${this.root}/${name}`
        await this.fs('writeFile', { filePath: temp, data: JSON.stringify(snapshot), encoding: 'utf8' })
        this.assertActive(); await this.fs('rename', { oldPath: temp, newPath: `${this.root}/${name}` }); this.assertActive()
        const previous = this.platform.getStorageSync<{ current: string }>(this.pointerKey)?.current
        this.platform.setStorageSync(this.pointerKey, { current: name, previous })
        committed = true
        const { files } = await this.fs('readdir', { dirPath: this.root })
        for (const file of files) if (file.startsWith('snapshot-') && file !== name && file !== previous) await this.fs('unlink', { filePath: `${this.root}/${file}` }).catch(() => {})
      } catch (error) {
        if (this.native && !committed) { if (temporary) await this.fs('unlink', { filePath: temporary }).catch(() => {}); if (candidate) await this.fs('unlink', { filePath: candidate }).catch(() => {}) }
        if (!this.active) throw cancelled(); throw storageFailure()
      }
    })
  }
  private mediaName(key: string) { return `media-${encodeURIComponent(key)}.webp` }
  async mediaUrl(key: string): Promise<string | null> {
    this.assertActive()
    if (this.native) {
      const path = `${this.root}/${this.mediaName(key)}`
      try { const result = await this.fs('stat', { path }); this.assertActive(); return result.stats.size > 0 ? path : null } catch { return null }
    }
    if (this.urls.has(key)) return this.urls.get(key)!
    const blob = await this.get<Blob>(`media:${key}`); this.assertActive()
    if (!blob?.size) return null
    const url = URL.createObjectURL(blob); this.urls.set(key, url); return url
  }
  async cacheMedia(key: string, url: string): Promise<string> {
    this.assertActive()
    const existing = await this.mediaUrl(key); if (existing) return existing
    if (this.native) {
      const response = await this.platform.downloadFile({ url, timeout: 30000 }).catch(() => { throw new Error('离线图片下载失败，请检查网络或小程序下载域名后重试') })
      if (response.statusCode !== 200) throw new Error('离线图片下载失败，请重试')
      try {
        await this.serialize(async () => {
          this.assertActive(); await this.mkdir(); this.assertActive()
          const target = `${this.root}/${this.mediaName(key)}`; const temp = `${target}.tmp`
          try {
            await this.fs('copyFile', { srcPath: response.tempFilePath, destPath: temp }); this.assertActive()
            await this.fs('rename', { oldPath: temp, newPath: target })
          } finally { await this.fs('unlink', { filePath: temp }).catch(() => {}) }
        }).catch(error => { if (!this.active) throw cancelled(); throw storageFailure() })
      } finally { await this.fs('unlink', { filePath: response.tempFilePath }).catch(() => {}) }
    } else {
      const response = await fetch(url)
      if (!response.ok) throw new Error('离线图片下载失败，请重试')
      const blob = await response.blob(); this.assertActive()
      if (!blob.size || !blob.type.startsWith('image/')) throw new Error('离线图片内容无效，请重试')
      await this.serialize(() => this.transaction(store => store.put(blob, this.namespace + `media:${key}`)))
    }
    const saved = await this.mediaUrl(key)
    if (!saved) throw storageFailure()
    return saved
  }
  evictMedia(key: string): Promise<void> {
    return this.serialize(async () => {
      this.assertActive()
      if (this.native) await this.fs('unlink', { filePath: `${this.root}/${this.mediaName(key)}` }).catch(() => {})
      else { await this.transaction(store => store.delete(this.namespace + `media:${key}`)); const url = this.urls.get(key); if (url) URL.revokeObjectURL(url); this.urls.delete(key) }
    })
  }
  dropSnapshot(): Promise<void> {
    return this.serialize(async () => {
      this.assertActive()
      if (this.native) {
        // Drop the pointer before allocating anything: revocation must survive a full disk.
        this.platform.removeStorageSync(this.pointerKey)
        const { files } = await this.fs('readdir', { dirPath: this.root }).catch(() => ({ files: [] }))
        for (const file of files) if (file.startsWith('snapshot-')) await this.fs('unlink', { filePath: `${this.root}/${file}` }).catch(() => {})
      } else await this.transaction(store => store.delete(this.namespace + 'snapshot'))
    })
  }
  prune(keys: Set<string>): Promise<void> {
    return this.serialize(async () => {
      this.assertActive()
      if (this.native) {
        const { files } = await this.fs('readdir', { dirPath: this.root }).catch(() => ({ files: [] }))
        const keep = new Set([...keys].map(key => this.mediaName(key)))
        for (const file of files) if (file.startsWith('media-') && !keep.has(file)) { this.assertActive(); await this.fs('unlink', { filePath: `${this.root}/${file}` }).catch(() => {}) }
      } else {
        await this.transaction(store => {
          const req = store.openCursor()
          req.onsuccess = () => {
            const cursor = req.result; if (!cursor) return
            const prefix = this.namespace + 'media:'; const key = String(cursor.key)
            if (key.startsWith(prefix) && !keys.has(key.slice(prefix.length))) cursor.delete()
            cursor.continue()
          }
        })
        for (const [key, url] of this.urls) if (!keys.has(key)) { URL.revokeObjectURL(url); this.urls.delete(key) }
      }
    })
  }
  dispose() { this.active = false; for (const url of this.urls.values()) URL.revokeObjectURL(url); this.urls.clear() }
  async clear() {
    this.dispose()
    await this.serialize(async () => {
      if (this.native) {
        this.platform.removeStorageSync(this.pointerKey)
        await this.fs('rmdir', { dirPath: this.root, recursive: true }).catch(() => {})
      } else {
        const db = await this.db()
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction('cache', 'readwrite'); const req = tx.objectStore('cache').openCursor()
          req.onsuccess = () => { const cursor = req.result; if (cursor) { if (String(cursor.key).startsWith(this.namespace)) cursor.delete(); cursor.continue() } }
          tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(storageFailure())
        })
      }
    })
  }
}
