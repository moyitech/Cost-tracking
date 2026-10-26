export type CachedPreview = { url: string; revision: number }

/** Resolved previews for the active account; disk remains the persistent cache. */
export class PreviewCache {
  private generation = 0
  private revision = 0
  private urls = new Map<string, CachedPreview>()
  private pending = new Map<string, Promise<string>>()
  private listeners = new Set<(key: string | null) => void>()
  peek(key: string) { return this.urls.get(key) }
  subscribe(listener: (key: string | null) => void) {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  notify(key: string) { this.listeners.forEach(listener => listener(key)) }
  load(key: string, resolve: () => Promise<string>, force = false): Promise<string> {
    const pending = this.pending.get(key)
    if (pending) return pending
    const cached = this.peek(key)
    if (cached && !force) return Promise.resolve(cached.url)
    const generation = this.generation
    if (force) this.urls.delete(key)
    const task = resolve().then(url => {
      if (generation !== this.generation) throw new Error('账号已变化，同步已取消')
      if (url && (force || this.peek(key)?.url !== url)) {
        this.urls.set(key, { url, revision: ++this.revision })
        this.notify(key)
      }
      return url
    }).finally(() => { if (this.pending.get(key) === task) this.pending.delete(key) })
    this.pending.set(key, task)
    return task
  }
  retain(keys: Set<string>) {
    for (const key of this.urls.keys()) if (!keys.has(key)) this.urls.delete(key)
  }
  reset() {
    this.generation++
    this.urls.clear(); this.pending.clear()
    this.listeners.forEach(listener => listener(null))
  }
}
