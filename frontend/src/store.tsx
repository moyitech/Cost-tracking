import { createContext, PropsWithChildren, useCallback, useContext, useEffect, useRef, useState } from 'react'
import Taro from '@tarojs/taro'
import { Command } from './commands'
import { mergeCommandResult } from './family-state'
import { Ledger, today } from './domain'
import { accountId, activateOfflineSnapshot, api, clearOfflineAccount, fetchOfflineSpace, fileUrl, imagePresetUrl, mockEnabled, offlineStorage, readLedgerCache, remote, removeLedgerCache, repository, subscribeAccount, subscribeCacheRepair } from './services'
import { emptyRemote, SyncGate, validCache } from './ledger-cache'
import type { RemoteState } from './ledger-cache'
import { blankSnapshot, isSnapshot, OfflineSnapshot, retryDelay, synchronize } from './offline-sync'

type Store = { data: Ledger; spaceId: string; setSpaceId: (id: string) => void; loading: boolean; ready: boolean; error: string; pageError: string; moreLoading: boolean; refresh: () => Promise<void>; lastSyncedAt: string | null; execute: (command: Command) => Promise<Ledger>; importSaved: (id: string) => Promise<void>; remoteState: RemoteState; loadMore: (kind: 'events' | 'trash') => Promise<void>; loadTrash: () => Promise<void>; loadDetail: (id: string, more?: boolean) => Promise<void>; historyCursors: Record<string, string | null>; detailLoading: boolean; detailError: string }
const Context = createContext<Store | null>(null)
const scopeKey = (suffix: string) => mockEnabled ? `objet-${suffix}` : `objet-api:${API_BASE_URL}:${accountId()}:${suffix}`
function legacySnapshot(): OfflineSnapshot {
  const old = readLedgerCache()
  return validCache(old) ? { version: 2, data: old.data, remote: old.remote, manifest: null, lastSyncedAt: null } : blankSnapshot()
}

export function LedgerProvider({ children }: PropsWithChildren) {
  const [snapshot, setSnapshot] = useState(legacySnapshot); const current = useRef(snapshot)
  const [spaceId, setSpace] = useState(() => Taro.getStorageSync<string>(scopeKey('current-space')) || snapshot.data.spaces[0]?.id || '')
  const selected = useRef(spaceId); const owner = useRef(accountId()); const gate = useRef(new SyncGate())
  const [loading, setLoading] = useState(false); const [error, setError] = useState(''); const [detailError, setDetailError] = useState(''); const [detailLoading, setDetailLoading] = useState(false)
  const foreground = useRef(true); const booted = useRef(false); const failures = useRef(0); const nextCheck = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null); const request = useRef<() => void>(() => {})
  const stopTimer = () => { if (timer.current) clearTimeout(timer.current); timer.current = null }
  const schedule = (delay: number) => {
    stopTimer(); nextCheck.current = Date.now() + delay
    if (foreground.current) timer.current = setTimeout(() => request.current(), delay)
  }
  const chooseSpace = (data: Ledger) => {
    const id = data.spaces.find(s => s.id === selected.current)?.id || data.spaces.find(s => s.kind === 'personal')?.id || data.spaces[0]?.id || ''
    selected.current = id; setSpace(id)
    if (id) { try { Taro.setStorageSync(scopeKey('current-space'), id) } catch { /* Selection still works in memory. */ } }
  }
  const publish = (next: OfflineSnapshot) => {
    current.current = next; setSnapshot(next); chooseSpace(next.data)
    if (!mockEnabled) activateOfflineSnapshot(next)
  }
  const refresh = useCallback(() => gate.current.run(async token => {
    if (!booted.current) return
    let identity = owner.current
    const valid = () => gate.current.accepts(token) && identity === owner.current
    setLoading(true); setError('')
    try {
      if (mockEnabled) { publish({ ...blankSnapshot(), data: await repository.load(), lastSyncedAt: new Date().toISOString() }); return }
      if (!accountId()) {
        await api.authenticate()
        if (!gate.current.accepts(token)) return
        identity = accountId(); owner.current = identity
      }
      const storage = offlineStorage()
      await synchronize(current.current, {
        manifest: remote.manifest,
        metadata: repository.load,
        space: (id, metadata) => fetchOfflineSpace(id, metadata, valid),
        save: next => { if (!valid()) throw new Error('同步已取消'); return storage.writeSnapshot(next) },
        publish: next => { if (valid()) publish(next) },
        media: async ref => { if (ref.fileId) await fileUrl(ref.fileId); else if (ref.presetId) await imagePresetUrl(ref.presetId) },
        prune: refs => storage.prune(new Set(refs.map(r => r.key))),
        revoke: () => { removeLedgerCache(identity); return storage.dropSnapshot() },
      }, valid)
      if (valid()) { failures.current = 0; removeLedgerCache(identity) }
    } catch (e) {
      if (valid()) { failures.current++; setError(e instanceof Error ? e.message : '同步失败，请重试') }
    } finally {
      if (valid()) { setLoading(false); schedule(failures.current ? retryDelay(failures.current) : 60000) }
    }
  }), [])
  request.current = () => { if (booted.current && foreground.current) void refresh() }

  useEffect(() => {
    let disposed = false
    const boot = async () => {
      const token = gate.current.token()
      const valid = () => !disposed && gate.current.accepts(token)
      try {
        if (mockEnabled) { booted.current = true; await refresh(); return }
        if (!accountId()) await api.authenticate()
        if (!valid()) return
        owner.current = accountId()
        // Ignore and remove the retired manual-mode preference for this API/account.
        try { Taro.removeStorageSync(scopeKey('sync-mode')) } catch { /* Auto sync does not depend on storage writes. */ }
        const storage = offlineStorage()
        let cached: OfflineSnapshot | null = null
        try { cached = await storage.readSnapshot() } catch { /* Recover from the server or the legacy snapshot. */ }
        if (!valid()) return
        const next = cached && isSnapshot(cached) ? cached : legacySnapshot()
        publish(next)
        if (!valid()) return
        booted.current = true
        await refresh()
      } catch (e) { if (valid()) { booted.current = true; failures.current++; setError(e instanceof Error ? e.message : '初始化失败，请联网重试'); schedule(retryDelay(failures.current)) } }
    }
    const unsubscribe = subscribeAccount(id => {
      if (owner.current === id) return
      const previous = owner.current; owner.current = id
      if (!previous) return
      gate.current.invalidate(); stopTimer(); booted.current = false; failures.current = 0; nextCheck.current = 0
      removeLedgerCache(previous); void clearOfflineAccount(previous).catch(() => {})
      selected.current = ''; current.current = blankSnapshot(); setSnapshot(current.current); setSpace(''); setLoading(false); setDetailError(''); setDetailLoading(false)
      void boot()
    })
    const unsubscribeRepair = subscribeCacheRepair(() => { if (booted.current && foreground.current) schedule(0) })
    const show = () => {
      foreground.current = true
      if (!booted.current) return
      if (Date.now() >= nextCheck.current) request.current(); else schedule(nextCheck.current - Date.now())
    }
    const hide = () => { foreground.current = false; stopTimer() }
    const network = (event: { isConnected: boolean }) => { if (event.isConnected && foreground.current) { nextCheck.current = 0; show() } }
    const visibility = () => { if (document.visibilityState === 'hidden') hide(); else show() }
    Taro.onAppShow?.(show); Taro.onAppHide?.(hide); Taro.onNetworkStatusChange(network)
    if (process.env.TARO_ENV === 'h5') document.addEventListener('visibilitychange', visibility)
    void boot()
    return () => { disposed = true; gate.current.invalidate(); stopTimer(); unsubscribe(); unsubscribeRepair(); Taro.offAppShow?.(show); Taro.offAppHide?.(hide); Taro.offNetworkStatusChange(network); if (process.env.TARO_ENV === 'h5') document.removeEventListener('visibilitychange', visibility) }
  }, [refresh])
  useEffect(() => {
    let date = today()
    const id = setInterval(() => { if (date !== today()) { date = today(); setSnapshot({ ...current.current }) } }, 30000)
    return () => clearInterval(id)
  }, [])
  const setSpaceId = (id: string) => {
    if (!current.current.data.spaces.some(s => s.id === id)) return
    selected.current = id; chooseSpace(current.current.data); setDetailError('')
    if (!mockEnabled && !current.current.remote[id]) { void refresh() }
  }
  const persistLocal = async (next: OfflineSnapshot) => {
    publish(next)
    if (!mockEnabled) {
      try { await offlineStorage().writeSnapshot(next) } catch (e) { setError(e instanceof Error ? e.message : '本地缓存保存失败，请重试') }
    }
  }
  const loadDetail = async (id: string) => {
    if (!id || mockEnabled || current.current.data.items.some(i => i.id === id)) return
    const token = gate.current.token(); const identity = owner.current
    setDetailLoading(true); setDetailError('')
    try {
      const item = await remote.detail(id)
      if (!gate.current.accepts(token) || identity !== owner.current) return
      if (current.current.data.spaces.some(s => s.id === item.spaceId)) {
        await persistLocal({ ...current.current, data: { ...current.current.data, items: [item, ...current.current.data.items.filter(i => i.id !== id)] } })
        void refresh()
      }
    } catch (e) {
      if (gate.current.accepts(token) && identity === owner.current) {
        setDetailError(e instanceof Error ? e.message : '详情读取失败')
        // A missing item does not prove the entire space has been revoked.
        if (e && typeof e === 'object' && 'status' in e && [403, 404].includes(Number(e.status))) void refresh()
      }
    } finally { if (identity === owner.current) setDetailLoading(false) }
  }
  const importSaved = async (id: string) => {
    if (mockEnabled) return
    gate.current.invalidate(); setLoading(false)
    await loadDetail(id); void refresh()
  }
  const execute = async (command: Command) => {
    gate.current.invalidate(); setLoading(false)
    const identity = owner.current
    let next: Ledger
    try { next = await repository.execute(command, current.current.data) }
    catch (e) { if (!mockEnabled) void refresh(); throw e }
    if (owner.current !== identity) throw new Error('账号已变化，请重新打开档案')
    gate.current.invalidate()
    const updated = mockEnabled ? next : mergeCommandResult(current.current.data, next, command)
    updated.spaces = updated.spaces.map(s => ({ ...s, members: s.members.length ? s.members : current.current.data.spaces.find(old => old.id === s.id)?.members || [] }))
    const remote = Object.fromEntries(Object.entries(current.current.remote).map(([id, state]) => [id, { ...state, trashIds: updated.items.filter(i => i.spaceId === id && i.deleted).map(i => i.id) }]))
    await persistLocal({ ...current.current, data: updated, remote })
    if (!mockEnabled) void refresh()
    return updated
  }
  const data = snapshot.data
  const ready = mockEnabled ? data.spaces.length > 0 : !!snapshot.remote[spaceId] || data.items.some(i => i.spaceId === spaceId) || (!!snapshot.manifest && !snapshot.manifest.spaces.length)
  const loadTrash = async () => { if (!mockEnabled && !current.current.remote[selected.current]) await refresh() }
  return <Context.Provider value={{ data, spaceId, setSpaceId, loading, ready, error, pageError: '', moreLoading: false, refresh, lastSyncedAt: snapshot.lastSyncedAt, execute, importSaved, remoteState: snapshot.remote[spaceId] || emptyRemote, loadMore: loadTrash, loadTrash, loadDetail, historyCursors: {}, detailLoading, detailError }}>{children}</Context.Provider>
}
export function useLedger() { const value = useContext(Context); if (!value) throw new Error('LedgerProvider missing'); return value }
