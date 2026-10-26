import type { PresetStyle } from './item-image'

export type ImagePreset = { id: string; name: string; style: PresetStyle; src: string }
export type PresetAccess = { url: string; expires_at: string }
export type ApiImagePreset = Omit<ImagePreset, 'src'> & PresetAccess & { preview_url: string; version: number }
type Request = <T>(path: string) => Promise<T>

// Keep signed URLs in memory only. A list response warms both preview and full-size caches.
export function createPresetCatalog(request: Request, now = Date.now) {
  const access = new Map<string, PresetAccess>()
  const pending = new Map<string, Promise<string>>()
  let catalog: ImagePreset[] | undefined
  let expires = 0
  let listing: Promise<ImagePreset[]> | undefined
  let generation = 0
  const fresh = (entry?: PresetAccess) => !!entry && Date.parse(entry.expires_at) > now() + 30000
  const list = async (force = false): Promise<ImagePreset[]> => {
    if (listing) return listing
    if (!force && catalog && expires > now() + 30000) return catalog
    const run = generation
    const task = request<{ items: ApiImagePreset[] }>('/image-presets').then(({ items }) => {
      if (run !== generation) return list()
      for (const item of items) {
        access.set(`${item.id}:preview`, { url: item.preview_url, expires_at: item.expires_at })
        access.set(`${item.id}:original`, { url: item.url, expires_at: item.expires_at })
      }
      expires = items.length ? Math.min(...items.map(i => Date.parse(i.expires_at))) : now() + 60000
      catalog = items.map(i => ({ id: i.id, name: i.name, style: i.style, src: i.preview_url }))
      return catalog
    }).catch(error => { if (run !== generation) return list(); throw error }).finally(() => { if (listing === task) listing = undefined })
    listing = task
    return task
  }
  const url = async (id: string, force = false, size: 'preview' | 'original' = 'preview'): Promise<string> => {
    const key = `${id}:${size}`
    const current = pending.get(key)
    if (current) return current
    const cached = access.get(key)
    if (!force && fresh(cached)) return cached!.url
    const run = generation
    const task = request<PresetAccess>(`/image-presets/${encodeURIComponent(id)}/access?size=${size}`).then(entry => {
      if (run !== generation) return url(id, false, size)
      access.set(key, entry); return entry.url
    }).catch(error => { if (run !== generation) return url(id, false, size); throw error }).finally(() => { if (pending.get(key) === task) pending.delete(key) })
    pending.set(key, task)
    return task
  }
  const invalidate = () => { generation++; catalog = undefined; expires = 0; access.clear(); pending.clear(); listing = undefined }
  return { list, url, invalidate }
}
