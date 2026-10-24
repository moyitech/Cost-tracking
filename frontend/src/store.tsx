import { createContext, PropsWithChildren, useCallback, useContext, useEffect, useRef, useState } from 'react'
import Taro from '@tarojs/taro'
import { Command } from './commands'
import { affectedSpaces, itemCommand, mergeCommandResult } from './family-state'
import { Ledger, today } from './domain'
import { emptyFilters } from './api-types'
import { accountId, mockEnabled, readLedgerCache, remote, removeLedgerCache, repository, subscribeAccount, writeLedgerCache } from './services'
import { cacheSnapshot, collectItems, emptyRemote, mergeItems, RemoteState, SyncGate, validCache } from './ledger-cache'

const empty: Ledger = { version: 1, items: [], spaces: [] }
type Store = { data: Ledger; spaceId: string; setSpaceId: (id: string) => void; loading: boolean; ready: boolean; error: string; pageError: string; moreLoading: boolean; refresh: () => Promise<void>; execute: (command: Command) => Promise<Ledger>; importSaved: (id: string) => Promise<void>; remoteState: RemoteState; loadMore: (kind: 'events' | 'trash') => Promise<void>; loadTrash: () => Promise<void>; loadDetail: (id: string, more?: boolean) => Promise<void>; historyCursors: Record<string, string | null>; detailLoading: boolean; detailError: string }
const Context = createContext<Store | null>(null)
const spaceKey = () => mockEnabled ? 'objet-current-space' : `objet-api:${API_BASE_URL}:${accountId()}:current-space`
const denied = (e: unknown) => !!e && typeof e === 'object' && 'status' in e && [401, 403, 404].includes(Number(e.status))
export function LedgerProvider({ children }: PropsWithChildren) {
  const [initial] = useState(() => { const saved = readLedgerCache(); return validCache(saved) ? saved : cacheSnapshot(empty, [], {}) })
  const [data, setData] = useState(initial.data); const current = useRef(initial.data)
  const [spaceId, setSpace] = useState(() => initial.data.spaces.find(s => s.id === Taro.getStorageSync(spaceKey()))?.id || initial.data.spaces[0]?.id || '')
  const selected = useRef(spaceId); const owner = useRef(accountId())
  const readySpaces = useRef(new Set(initial.readySpaces)); const snapshots = useRef(initial.remote)
  const [ready, setReady] = useState(readySpaces.current.has(spaceId))
  const [loading, setLoading] = useState(false); const [error, setError] = useState(''); const [pageError, setPageError] = useState('')
  const [moreLoading, setMoreLoading] = useState(false); const paging = useRef(false)
  const [remoteState, setRemote] = useState(initial.remote[spaceId] || emptyRemote); const state = useRef(remoteState)
  const gate = useRef(new SyncGate())
  const [historyCursors, setHistoryCursors] = useState<Record<string, string | null>>({}); const historyRef = useRef<Record<string, string | null>>({})
  const [detailLoading, setDetailLoading] = useState(false); const [detailError, setDetailError] = useState('')
  const detailGenerations = useRef<Record<string, number>>({})
  const persist = () => writeLedgerCache(cacheSnapshot(current.current, [...readySpaces.current], snapshots.current))
  const putData = (next: Ledger) => { current.current = next; setData(next); persist() }
  const putRemote = (next: RemoteState) => { state.current = next; snapshots.current[selected.current] = next; setRemote(next); persist() }
  const resetSpace = (id: string) => {
    selected.current = id; setSpace(id); Taro.setStorageSync(spaceKey(), id)
    const next = snapshots.current[id] || emptyRemote; state.current = next; setRemote(next)
    setReady(readySpaces.current.has(id)); setPageError(''); setError('')
  }
  const revokeSpace = (id: string) => {
    gate.current.invalidate(); setLoading(false)
    for (const item of current.current.items.filter(i => i.spaceId === id)) { delete detailGenerations.current[item.id]; delete historyRef.current[item.id] }
    setHistoryCursors({ ...historyRef.current })
    readySpaces.current.delete(id); delete snapshots.current[id]
    putData({ ...current.current, spaces: current.current.spaces.filter(s => s.id !== id), items: current.current.items.filter(i => i.spaceId !== id) })
    if (selected.current === id) { setReady(false); state.current = emptyRemote; setRemote(emptyRemote); setError('空间暂不可访问，请刷新重试'); const personal = current.current.spaces.find(s => s.kind === 'personal'); if (personal) resetSpace(personal.id) }
  }
  const refresh = useCallback(() => gate.current.run(async token => {
    const valid = () => gate.current.accepts(token)
    setLoading(true); setError(''); setPageError('')
    let id = selected.current
    try {
      const loaded = await repository.load()
      if (!valid()) return
      const preferred = selected.current || Taro.getStorageSync<string>(spaceKey())
      id = loaded.spaces.find(s => s.id === preferred)?.id || loaded.spaces.find(s => s.kind === 'personal')?.id || loaded.spaces[0]?.id || ''
      const allowed = new Set(loaded.spaces.map(s => s.id))
      for (const previous of [...readySpaces.current]) if (!allowed.has(previous)) { readySpaces.current.delete(previous); delete snapshots.current[previous] }
      if (selected.current !== id) resetSpace(id)
      else Taro.setStorageSync(spaceKey(), id)
      if (mockEnabled) { putData(loaded); readySpaces.current.add(id); setReady(true); return }
      putData({ ...loaded, items: current.current.items.filter(i => allowed.has(i.spaceId)) })
      if (!id) { setReady(true); return }
      const items = await collectItems(cursor => remote.items(id, emptyFilters, cursor), valid)
      if (!items || !valid()) return
      // Replace the complete active list, including removal of remotely deleted items.
      const merged = mergeItems(current.current, items)
      const ids = new Set(items.map(i => i.id))
      readySpaces.current.add(id)
      putData({ ...merged, items: merged.items.filter(i => i.spaceId !== id || i.deleted || ids.has(i.id)) })
      setReady(true)

    } catch (e) {
      if (!valid()) return
      if (denied(e)) revokeSpace(id)
      setError(e instanceof Error ? e.message : '同步失败，请重试')
    } finally { if (valid()) setLoading(false) }
  }), [])
  useEffect(() => subscribeAccount(id => {
    if (owner.current === id) return
    const previous = owner.current; owner.current = id
    if (!previous) return
    gate.current.invalidate(); removeLedgerCache(previous)
    readySpaces.current.clear(); snapshots.current = {}; historyRef.current = {}; setHistoryCursors({}); detailGenerations.current = {}
    putData(empty); resetSpace(''); setLoading(false); setDetailLoading(false); setDetailError('')
    void refresh()
  }), [refresh])
  useEffect(() => { void refresh(); return () => gate.current.invalidate() }, [refresh])
  // Re-render cached daily metrics after midnight without a network request.
  useEffect(() => {
    let date = today()
    const timer = setInterval(() => { if (date !== today()) { date = today(); setData({ ...current.current }) } }, 30000)
    return () => clearInterval(timer)
  }, [])
  const setSpaceId = useCallback((id: string) => {
    if (selected.current === id) { if (!mockEnabled) void refresh(); return }
    gate.current.invalidate(); resetSpace(id); setLoading(false)
    if (!mockEnabled) void refresh()
    if (mockEnabled) setReady(true)
  }, [refresh])
  const loadTrash = useCallback(async () => {
    if (mockEnabled) return
    const token = gate.current.token(); const space = selected.current
    setPageError(''); setMoreLoading(true)
    try { const page = await remote.trash(space); if (!gate.current.accepts(token)) return; putData(mergeItems(current.current, page.items)); putRemote({ ...state.current, trashIds: page.items.map(i => i.id), trashCursor: page.cursor }) }
    catch (e) { if (gate.current.accepts(token)) { if (denied(e)) revokeSpace(space); setPageError(e instanceof Error ? e.message : '回收站读取失败') } }
    finally { setMoreLoading(false) }
  }, [])
  const loadMore = useCallback(async (kind: 'events' | 'trash') => {
    const cursor = kind === 'events' ? state.current.eventsCursor : state.current.trashCursor
    if (mockEnabled || !cursor || paging.current) return
    paging.current = true; setMoreLoading(true); setPageError(''); const token = gate.current.token(); const space = selected.current
    try {
      if (kind === 'events') { const page = await remote.events(space, cursor); if (gate.current.accepts(token)) putRemote({ ...state.current, events: [...state.current.events, ...page.items], eventsCursor: page.cursor }) }
      else { const page = await remote.trash(space, cursor); if (!gate.current.accepts(token)) return; putData(mergeItems(current.current, page.items)); putRemote({ ...state.current, trashIds: [...new Set([...state.current.trashIds, ...page.items.map(i => i.id)])], trashCursor: page.cursor }) }
    } catch (e) { if (gate.current.accepts(token)) { if (denied(e)) revokeSpace(space); setPageError(e instanceof Error ? e.message : '加载失败，请重试') } }
    finally { paging.current = false; setMoreLoading(false) }
  }, [])
  const loadDetail = useCallback(async (id: string) => {
    if (mockEnabled || !id) return
    const run = (detailGenerations.current[id] || 0) + 1; detailGenerations.current[id] = run
    const token = gate.current.token(); const valid = () => gate.current.accepts(token) && run === detailGenerations.current[id]
    setDetailLoading(true); setDetailError('')
    try {
      const item = await remote.detail(id)
      if (!valid()) return
      if (!current.current.spaces.some(s => s.id === item.spaceId)) return
      putData(mergeItems(current.current, [item]))
    } catch (e) {
      if (!valid()) return
      setDetailError(e instanceof Error ? e.message : '详情读取失败')
      if (denied(e)) putData({ ...current.current, items: current.current.items.filter(i => i.id !== id) })
    } finally { if (run === detailGenerations.current[id]) setDetailLoading(false) }
  }, [])
  const importSaved = async (id: string) => {
    if (mockEnabled) return
    gate.current.invalidate(); setLoading(false)
    await loadDetail(id)
    void refresh()
  }
  const execute = async (command: Command) => {
    gate.current.invalidate(); setLoading(false)
    const identity = owner.current
    const affected = affectedSpaces(current.current, command)
    let next: Ledger
    try { next = await repository.execute(command, current.current) }
    catch (e) { if (!mockEnabled) await refresh(); throw e }
    if (owner.current !== identity) throw new Error('账号已变化，请重新打开档案')
    gate.current.invalidate()
    // Preserve unrelated detail loads and writes completed while this request was pending.
    const updated = mockEnabled ? next : mergeCommandResult(current.current, next, command)
    for (const id of affected) { readySpaces.current.delete(id); delete snapshots.current[id] }
    if (affected.includes(selected.current)) { state.current = emptyRemote; setRemote(emptyRemote) }
    putData(updated)
    putRemote({ ...state.current, trashIds: state.current.trashIds.filter(id => updated.items.find(i => i.id === id)?.deleted) })
    if (!mockEnabled) {
      void refresh()
      if (itemCommand(command) && 'id' in command && !['delete', 'restore'].includes(command.type)) void loadDetail(command.id)
    }
    return updated
  }
  return <Context.Provider value={{ data, spaceId, setSpaceId, loading, ready, error, pageError, moreLoading, refresh, execute, importSaved, remoteState, loadMore, loadTrash, loadDetail, historyCursors, detailLoading, detailError }}>{children}</Context.Provider>
}
export function useLedger() { const value = useContext(Context); if (!value) throw new Error('LedgerProvider missing'); return value }
