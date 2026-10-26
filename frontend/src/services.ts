import Taro from '@tarojs/taro'
import { Command, applyCommand } from './commands'
import { Item, ItemInput, Ledger, migrateLedger, StoredLedger, Space, Profile } from './domain'
import { initialLedger } from './mock'
import { createApiClient, failure, Session, Transport } from './api-client'
import { Analytics, ApiEvent, ApiItem, apiEvent, apiItem, apiSpace, Filters, Page, Summary } from './api-types'
import { imagePresets as bundledPresets } from '@preset-assets'
import { createPresetCatalog } from './image-preset-client'
import { prepareItemInput } from './item-input'
import { prepareUploadImage } from './local-image'
import { IMAGE_MAX_BYTES, IMAGE_MAX_EDGE, imageMime, squareImageProcessing } from './image-processing'
import { OfflineStorage } from './offline-storage'
import { collectPages, OfflineSnapshot, SyncManifest } from './offline-sync'

const STORAGE_KEY = 'objet-ledger:v1'
export const mockEnabled = USE_MOCK
const remoteKey = `objet-api:${API_BASE_URL}`
const transport: Transport = async (path, method, data, headers = {}) => {
  // wx.request does not support PATCH; use the server's explicit POST update aliases.
  if (process.env.TARO_ENV === 'weapp' && method === 'PATCH') { path += '/update'; method = 'POST' }
  try {
    const response = await Taro.request({ url: `${API_BASE_URL}${path}`, method, data, timeout: 20000, header: { 'Content-Type': 'application/json', ...headers } })
    return { status: response.statusCode, data: response.data }
  } catch { throw new Error('网络连接失败，输入已保留；请检查网络和服务器域名配置') }
}
const sessionListeners = new Set<(id: string) => void>()
export const subscribeAccount = (listener: (id: string) => void) => { sessionListeners.add(listener); return () => { sessionListeners.delete(listener) } }
const readSession = () => Taro.getStorageSync<Session>(`${remoteKey}:session`) || null
export const api = createApiClient(transport, readSession, value => {
  if (value) Taro.setStorageSync(`${remoteKey}:session`, value)
  else Taro.removeStorageSync(`${remoteKey}:session`)
  // A token refresh can briefly clear a session; only a resolved identity changes ownership.
  if (value) sessionListeners.forEach(listener => listener(value.user.id))
}, async () => {
  let path: string; let body: unknown
  if (process.env.TARO_ENV === 'weapp') {
    const result = await Taro.login(); if (!result.code) throw new Error('微信登录失败，请重试')
    path = '/auth/wechat/login'; body = { code: result.code }
  } else {
    if (!H5_DEV_IDENTITY) throw new Error('H5 联调需要配置 TARO_APP_H5_DEV_IDENTITY；正式登录请使用微信小程序')
    path = '/auth/dev/login'; body = { identity: H5_DEV_IDENTITY }
  }
  const result = await transport(path, 'POST', body)
  if (result.status !== 200) throw failure(result)
  return result.data
})
export function readLocal(): Ledger {
  const value = Taro.getStorageSync<StoredLedger>(STORAGE_KEY)
  if (!value) { const initial = initialLedger(); Taro.setStorageSync(STORAGE_KEY, initial); return initial }
  if (value.version !== 1 || !Array.isArray(value.items) || !Array.isArray(value.spaces)) throw new Error('本地档案格式无法读取，请保留数据并联系维护者')
  const migrated = migrateLedger(value)
  if (migrated !== value) Taro.setStorageSync(STORAGE_KEY, migrated)
  return migrated
}
const query = (params: Record<string, string | number | undefined | null>) => {
  const entries = Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== '')
  return entries.length ? '?' + entries.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`).join('&') : ''
}
const accessCache = new Map<string, { url: string; expires_at: string }>()
const presetCatalog = createPresetCatalog(path => api.request(path))
let offline: { user: string; storage: OfflineStorage; snapshot: OfflineSnapshot | null } | null = null
const mediaPending = new Map<string, Promise<string>>()
const originalPreviews = new Set<string>()
const mediaListeners = new Set<() => void>(); const repairListeners = new Set<() => void>(); let mediaEpoch = 0
export const subscribeMedia = (listener: () => void) => { mediaListeners.add(listener); return () => { mediaListeners.delete(listener) } }
export const readMediaEpoch = () => mediaEpoch
export const subscribeCacheRepair = (listener: () => void) => { repairListeners.add(listener); return () => { repairListeners.delete(listener) } }
const notifyMedia = () => { mediaEpoch++; mediaListeners.forEach(listener => listener()) }
export function offlineStorage() {
  const user = accountId()
  if (!user) throw new Error('首次使用需要联网登录')
  if (offline?.user !== user) { offline?.storage.dispose(); offline = { user, storage: new OfflineStorage(API_BASE_URL, user, Taro), snapshot: null }; notifyMedia() }
  return offline.storage
}
export function activateOfflineSnapshot(snapshot: OfflineSnapshot) {
  offlineStorage(); const previous = offline!.snapshot?.manifest?.presets_version
  offline!.snapshot = snapshot
  if (previous !== snapshot.manifest?.presets_version) notifyMedia()
}
export async function clearOfflineAccount(user: string) {
  const storage = offline?.user === user ? offline.storage : new OfflineStorage(API_BASE_URL, user, Taro)
  if (offline?.user === user) offline = null
  if (process.env.TARO_ENV === 'h5') { for (const url of originalPreviews) URL.revokeObjectURL(url); originalPreviews.clear() }
  await storage.clear()
}
async function originalResource(signed: () => Promise<string>, preview: () => Promise<string>): Promise<string> {
  const user = accountId()
  try {
    if (process.env.TARO_ENV === 'h5' && !navigator.onLine) return preview()
    if (process.env.TARO_ENV === 'weapp' && (await Taro.getNetworkType()).networkType === 'none') return preview()
    const url = await signed()
    if (process.env.TARO_ENV === 'weapp') {
      const result = await Taro.downloadFile({ url, timeout: 15000 })
      if (result.statusCode !== 200) throw new Error('原图暂不可用')
      if (user !== accountId()) throw new Error('账号已变化')
      return result.tempFilePath
    }
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15000)
    try {
      const response = await fetch(url, { signal: controller.signal })
      if (!response.ok) throw new Error('原图暂不可用')
      const blob = await response.blob()
      if (!blob.size || !blob.type.startsWith('image/') || user !== accountId()) throw new Error('原图暂不可用')
      const local = URL.createObjectURL(blob); originalPreviews.add(local); return local
    } finally { clearTimeout(timer) }
  } catch { if (user !== accountId()) throw new Error('账号已变化'); return preview() }
}
async function previewResource(key: string, signed: () => Promise<string>, force = false): Promise<string> {
  const storage = offlineStorage(); const user = accountId(); const pendingKey = `${user}:${key}`
  const pending = mediaPending.get(pendingKey); if (pending) return pending
  const task = (async () => {
    if (force) await storage.evictMedia(key)
    const cached = await storage.mediaUrl(key)
    if (cached) return cached
    repairListeners.forEach(listener => listener())
    const url = await signed()
    return storage.cacheMedia(key, url)
  })().finally(() => { mediaPending.delete(pendingKey) })
  mediaPending.set(pendingKey, task); return task
}
export const listImagePresets = (force = false) => mockEnabled ? Promise.resolve(bundledPresets) : presetCatalog.list(force)
export async function imagePresetUrl(id: string, force = false, size: 'preview' | 'original' = 'preview'): Promise<string> {
  if (mockEnabled) return bundledPresets.find(p => p.id === id)?.src || ''
  const key = `preset:${id}:${offline?.snapshot?.manifest?.preset_versions[id] || '1'}:preview`
  const preview = () => previewResource(key, () => presetCatalog.url(id, force, 'preview'), size === 'preview' && force)
  if (size === 'original') return originalResource(() => presetCatalog.url(id, force, size), preview)
  return preview()
}
async function signedFileUrl(id: string, force: boolean, size: 'preview' | 'original'): Promise<string> {
  const key = `${accountId()}:${id}:${size}`
  const cached = accessCache.get(key)
  if (!force && cached && Date.parse(cached.expires_at) > Date.now() + 30000) return cached.url
  const access = await api.request<{ url: string; expires_at: string }>(`/files/${id}/access?size=${size}`)
  accessCache.set(key, access); return access.url
}
export async function fileUrl(id: string, force = false, size: 'preview' | 'original' = 'preview'): Promise<string> {
  const preview = () => previewResource(`file:${id}:preview-v1`, () => signedFileUrl(id, force, 'preview'), size === 'preview' && force)
  return size === 'original' ? originalResource(() => signedFileUrl(id, force, size), preview) : preview()
}
async function hydrate(item: ApiItem): Promise<Item> {
  const result = apiItem(item)
  // A transient image error must not hide the item's text or financial data.
  if (result.imageFileId) result.image = await fileUrl(result.imageFileId).catch(() => '')
  result.attachments = await Promise.all((result.attachments || []).map(async file => ({ ...file, path: await fileUrl(file.fileId!).catch(() => '') })))
  return result
}
export async function previewItemPictures(item: Item, attachmentsOnly = false) {
  if (process.env.TARO_ENV === 'h5') { for (const url of originalPreviews) URL.revokeObjectURL(url); originalPreviews.clear() }
  const main = attachmentsOnly ? '' : item.imagePresetId ? await imagePresetUrl(item.imagePresetId, true, 'original') : mockEnabled ? item.image : item.imageFileId ? await fileUrl(item.imageFileId, true, 'original') : ''
  const attachments = mockEnabled ? (item.attachments || []).map(a => a.path) : await Promise.all((item.attachments || []).filter(a => a.fileId).map(a => fileUrl(a.fileId!, true, 'original')))
  const urls = [main, ...attachments].filter(Boolean)
  if (urls.length) await Taro.previewImage({ urls })
}
export type FamilyMember = { id: string; user_id: string; display_name: string; role: Space['role']; revision: number; avatar_file_id?: string | null }
export type FamilyInvitation = { id: string; token: string | null; role: 'editor' | 'viewer'; status: 'active' | 'expired' | 'revoked' | 'unavailable'; created_at: string; expires_at: string; accepted_count: number }
export type InvitationPreview = { family_name: string; inviter_name: string; role: 'editor' | 'viewer'; status: FamilyInvitation['status'] | 'new_invitation_required'; expires_at: string; already_member: boolean }
export const familyApi = {
  createInvitation: (space: string, role: 'editor' | 'viewer', key: string) => api.request<FamilyInvitation>(`/spaces/${space}/invitations`, 'POST', { role }, { 'Idempotency-Key': key }),
  miniCode: (space: string, invitation: string) => api.request<{ image_base64: string; content_type: 'image/png'; expires_at: string }>(`/spaces/${space}/invitations/${invitation}/mini-code`, 'POST'),
  me: (space: string) => api.request<FamilyMember>(`/spaces/${space}/members/me`),
  members: (space: string, cursor?: string | null) => api.request<Page<FamilyMember>>(`/spaces/${space}/members` + query({ cursor })),
  invitations: (space: string, cursor?: string | null) => api.request<Page<FamilyInvitation>>(`/spaces/${space}/invitations` + query({ cursor })),
  preview: (token: string) => api.request<InvitationPreview>(`/invitations/${encodeURIComponent(token)}`),
}
export const remote = {
  manifest: () => api.request<SyncManifest>('/sync/manifest'),
  async profile(): Promise<Profile> { const user = await api.request<{ id: string; display_name: string; avatar_file_id: string | null }>('/me'); return { id: user.id, displayName: user.display_name, avatarFileId: user.avatar_file_id || undefined } },
  async spaces() { const data = await api.request<{ items: Parameters<typeof apiSpace>[0][] }>('/spaces'); return data.items.map(apiSpace) },
  async items(space: string, filters: Filters, cursor?: string | null) {
    const data = await api.request<Page<ApiItem>>(`/spaces/${space}/items` + query({ q: filters.q.trim(), status: filters.status === 'all' ? undefined : filters.status === 'holding' ? 'active' : filters.status, cursor, limit: 100 }))
    return { items: data.items.map(apiItem), cursor: data.next_cursor }
  },
  async detail(id: string) { return hydrate(await api.request<ApiItem>(`/items/${id}`)) },
  summary: (space: string) => api.request<Summary>(`/spaces/${space}/summary`),
  analytics: (space: string) => api.request<Analytics>(`/spaces/${space}/analytics`),
  async events(space: string, cursor?: string | null) { const page = await api.request<Page<ApiEvent>>(`/spaces/${space}/events` + query({ cursor, limit: 100 })); return { items: page.items.map(apiEvent), cursor: page.next_cursor } },
  async history(id: string, cursor?: string | null) { const page = await api.request<Page<ApiEvent>>(`/items/${id}/events` + query({ cursor })); return { items: page.items.map(apiEvent), cursor: page.next_cursor } },
  async trash(space: string, cursor?: string | null) { const page = await api.request<Page<ApiItem>>(`/spaces/${space}/trash` + query({ cursor, limit: 100 })); return { items: page.items.map(apiItem), cursor: page.next_cursor } },
}
export async function fetchOfflineSpace(id: string, metadata: Space, valid: () => boolean) {
  const [active, trash, events, members] = await Promise.all([
    collectPages(cursor => remote.items(id, { q: '', status: 'all' }, cursor), valid),
    collectPages(cursor => remote.trash(id, cursor), valid),
    collectPages(cursor => remote.events(id, cursor), valid),
    metadata.kind === 'family' ? collectPages(async cursor => { const page = await familyApi.members(id, cursor); return { items: page.items, cursor: page.next_cursor } }, valid) : Promise.resolve([]),
  ])
  const history = new Map<string, typeof events>()
  for (const event of events) if (event.itemId) { const rows = history.get(event.itemId) || []; rows.push(event); history.set(event.itemId, rows) }
  return { space: { ...metadata, members: members.map(m => ({ id: m.id, name: m.display_name, role: m.role, userId: m.user_id, revision: m.revision, avatarFileId: m.avatar_file_id || undefined })) },
    items: [...active, ...trash].map(item => ({ ...item, history: history.get(item.id) || [] })),
    remote: { events, eventsCursor: null, trashIds: trash.map(i => i.id), trashCursor: null } }
}
export type UploadCache = { space: string; path: string; purpose: string; processing?: string; id: string; ready: boolean; uploaded: boolean; url: string; headers: Record<string, string>; expires_at: string }
export async function uploadImage(path: string, space: string, purpose: string, memory?: UploadCache[]): Promise<string> {
  await api.authenticate()
  const storageKey = `${remoteKey}:uploads:${readSession()!.user.id}`
  const entries: UploadCache[] = memory || (purpose === 'import_source' ? [] : Taro.getStorageSync(storageKey) || [])
  const persist = () => { if (!memory && purpose !== 'import_source') Taro.setStorageSync(storageKey, entries.slice(0, 50)) }
  const square = squareImageProcessing(purpose)
  let cached = entries.find(entry => entry.path === path && entry.space === space && entry.purpose === purpose && (!square || entry.processing === square.version))
  if (cached?.ready) return cached.id
  const prepared = cached?.uploaded ? null : await prepareUploadImage(path, purpose === 'import_source', square?.options)
  if (prepared && (prepared.bytes.byteLength > IMAGE_MAX_BYTES || prepared.width > IMAGE_MAX_EDGE || prepared.height > IMAGE_MAX_EDGE || imageMime(prepared.bytes) !== prepared.mime)) throw new Error('图片处理失败，请重新选择图片')
  if (prepared && square && (prepared.width !== prepared.height || prepared.width > square.options.maxEdge! || prepared.bytes.byteLength > square.options.maxBytes!)) throw new Error('图片处理失败，请重新裁剪图片')
  // A fresh intent must match these exact encoded bytes, including on retry.
  if (!cached?.uploaded) {
    const { bytes: buffer, mime } = prepared!
    const response = await api.request<{ id: string; url: string; headers: Record<string, string>; expires_at: string }>('/files/uploads', 'POST', { space_id: space, purpose, name: purpose.endsWith('_avatar') ? '头像' : purpose === 'import_source' ? '订单截图' : purpose === 'receipt' ? '凭证' : '物品主图', mime_type: mime, size_bytes: buffer.byteLength })
    if (cached) entries.splice(entries.indexOf(cached), 1)
    cached = { ...response, space, path, purpose, ...(square ? { processing: square.version } : {}), ready: false, uploaded: false }
    entries.unshift(cached)
    persist()
  }
  if (!cached.uploaded) {
    // Deliberately no API Authorization header on the COS request.
    const response = await Taro.request({ url: cached.url, method: 'PUT', data: prepared!.bytes, header: cached.headers, timeout: 60000, dataType: 'text' }).catch(() => { throw new Error('图片直传失败，请检查网络、COS CORS 来源和小程序合法域名；输入已保留') })
    if (response.statusCode < 200 || response.statusCode >= 300) throw new Error('COS 上传失败，请检查 Bucket CORS / 小程序合法域名后重试')
    cached.uploaded = true; persist()
  }
  await api.request(`/files/${cached.id}/complete`, 'POST')
  cached.ready = true; persist()
  return cached.id
}
export async function inputBody(input: ItemInput, space: string, memory?: UploadCache[]) {
  return prepareItemInput(input, (path, purpose) => uploadImage(path, space, purpose, memory))
}
export const repository = {
  load: async (): Promise<Ledger> => {
    if (mockEnabled) return readLocal()
    const [spaces, profile] = await Promise.all([remote.spaces(), remote.profile()])
    return { version: 1, items: [], spaces, profile }
  },
  execute: async (command: Command, current: Ledger): Promise<Ledger> => {
    if (mockEnabled) { const next = applyCommand(readLocal(), command); Taro.setStorageSync(STORAGE_KEY, next); return next }
    if (command.type === 'avatar') {
      const target = current.spaces.find(s => s.id === command.spaceId)
      if (!target || target.kind !== command.scope || target.role !== 'admin') throw new Error('仅空间管理者可以更换头像')
      const fileId = command.fileId || (command.image ? await uploadImage(command.image, target.id, `${command.scope}_avatar`) : null)
      const path = command.scope === 'personal' ? '/me/avatar' : `/spaces/${target.id}/avatar`
      await api.request(path, 'POST', { avatar_file_id: fileId })
      const [spaces, profile] = await Promise.all([remote.spaces(), remote.profile()])
      return { ...current, spaces, profile }
    }
    if (command.type === 'createSpace' || command.type === 'acceptInvite') {
      const created = command.type === 'createSpace'
        ? await api.request<Omit<Space, 'members'>>('/spaces', 'POST', { name: command.name, nickname: command.nickname }, { 'Idempotency-Key': command.key })
        : await api.request<Omit<Space, 'members'>>(`/invitations/${encodeURIComponent(command.token)}/accept`, 'POST', { nickname: command.nickname }, { 'Idempotency-Key': command.key })
      return { ...current, spaces: [...current.spaces.filter(s => s.id !== created.id), apiSpace(created)], resultSpaceId: created.id }
    }
    if (command.type === 'invite' || command.type === 'revokeInvite' || command.type === 'member' || command.type === 'nickname') {
      const base = `/spaces/${command.spaceId}`
      if (command.type === 'invite') await api.request(base + '/invitations', 'POST', { role: command.role }, { 'Idempotency-Key': command.key })
      if (command.type === 'revokeInvite') await api.request(base + `/invitations/${command.id}`, 'DELETE')
      if (command.type === 'member') await api.request(base + `/members/${command.memberId}`, command.role === 'remove' ? 'DELETE' : 'PATCH', command.role === 'remove' ? undefined : { role: command.role }, { 'If-Match': `"${command.revision}"` })
      if (command.type === 'nickname') await api.request(base + '/members/me', 'PATCH', { nickname: command.nickname }, { 'If-Match': `"${command.revision}"` })
      return { ...current, spaces: await remote.spaces() }
    }
    let result: ApiItem
    const item = 'id' in command ? current.items.find(i => i.id === command.id) : undefined
    const headers: Record<string, string> = 'revision' in command ? { 'If-Match': `"${command.revision}"` } : {}
    if (command.type === 'create') {
      result = await api.request(`/spaces/${command.spaceId}/items`, 'POST', await inputBody(command.input, command.spaceId), { 'Idempotency-Key': command.key })
    } else {
      if (!['edit', 'expense', 'dispose', 'delete', 'restore', 'move'].includes(command.type)) throw new Error('此功能尚未开放，请先使用个人档案功能')
      if (!item) throw new Error('档案尚未加载，请重新打开')
      const path = `/items/${item.id}`
      switch (command.type) {
        case 'move': result = await api.request(path + '/transfer', 'POST', { target_space_id: command.spaceId }, { ...headers, 'Idempotency-Key': `move-${item.id}-${command.revision}-${command.spaceId}` }); break
        case 'edit': result = await api.request(path, 'PATCH', await inputBody(command.input, item.spaceId), headers); break
        case 'expense': {
          const e = command.expense; const existing = item.expenses.find(x => x.id === e.id)
          result = await api.request(`${path}/expenses${existing ? `/${e.id}` : ''}`, existing ? 'PATCH' : 'POST', { category: e.category, amount_cents: e.amount, occurred_on: e.date, note: e.note || null, ...(existing ? {} : { attachment_file_ids: e.attachmentFileIds || [] }) }, { ...headers, 'Idempotency-Key': `expense-${item.id}-${e.id}` }); break
        }
        case 'dispose': result = await api.request(path + '/disposal', 'PUT', { status: command.status, disposal_date: command.date, recovery_amount_cents: command.recovery, confirmed_zero: command.confirmedZero }, headers); break
        case 'restore': result = await api.request(path + '/restore', 'POST', undefined, { ...headers, 'Idempotency-Key': `restore-${item.id}-${command.revision}` }); break
        case 'delete': await api.request(path, 'DELETE', undefined, headers); return { ...current, items: current.items.map(i => i.id === item.id ? { ...i, deleted: true, revision: i.revision + 1 } : i) }
        default: throw new Error('此功能尚未开放')
      }
    }
    const saved = await hydrate(result)
    if (command.type === 'create') saved.importKey = command.key
    return { ...current, items: [saved, ...current.items.filter(i => i.id !== saved.id)] }
  },
}
const draftPrefix = () => mockEnabled ? 'objet-draft:' : `${remoteKey}:draft:${readSession()?.user.id || 'pending'}:`
export function saveDraft<T>(key: string, value: T) { Taro.setStorageSync(`${draftPrefix()}${key}`, value) }
export function getDraft<T>(key: string): T | null { return Taro.getStorageSync(`${draftPrefix()}${key}`) || null }
export function clearDraft(key: string) { Taro.removeStorageSync(`${draftPrefix()}${key}`) }

// Remove only obsolete AI drafts for this API/user; ordinary forms and login survive.
export function clearImportDrafts() {
  const prefix = draftPrefix()
  for (const key of Taro.getStorageInfoSync().keys) {
    if (key.startsWith(prefix) && /^import(?:$|[-:])/.test(key.slice(prefix.length))) Taro.removeStorageSync(key)
  }
  const user = readSession()?.user.id
  if (user) {
    const key = `${remoteKey}:uploads:${user}`
    const cached: UploadCache[] = Taro.getStorageSync(key) || []
    if (cached.some(e => e.purpose === 'import_source')) Taro.setStorageSync(key, cached.filter(e => e.purpose !== 'import_source'))
  }
}

export const accountId = () => mockEnabled ? 'mock' : readSession()?.user.id || ''
export const ledgerCacheKey = (user: string) => `${remoteKey}:ledger:v1:${encodeURIComponent(user)}`
export function readLedgerCache(): unknown {
  if (mockEnabled || !accountId()) return null
  try { return Taro.getStorageSync(ledgerCacheKey(accountId())) || null } catch { return null }
}
export function writeLedgerCache(value: unknown) {
  if (mockEnabled || !accountId()) return
  try { Taro.setStorageSync(ledgerCacheKey(accountId()), value) } catch { /* In-memory browsing still works if device storage is full. */ }
}
export function removeLedgerCache(user: string) {
  if (user) { try { Taro.removeStorageSync(ledgerCacheKey(user)) } catch { /* best effort */ } }
}
