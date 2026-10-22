import { createContext, PropsWithChildren, useContext, useEffect, useState } from 'react'
import Taro from '@tarojs/taro'
import { Command } from './commands'
import { Ledger } from './domain'
import { repository } from './services'

const empty: Ledger = { version: 1, items: [], spaces: [] }
type Store = { data: Ledger; spaceId: string; setSpaceId: (id: string) => void; loading: boolean; error: string; refresh: () => Promise<void>; execute: (command: Command) => Promise<Ledger> }
const Context = createContext<Store | null>(null)
export function LedgerProvider({ children }: PropsWithChildren) {
  const [data, setData] = useState(empty)
  const [spaceId, setSpace] = useState('personal')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const refresh = async () => {
    try { setData(await repository.load()); setError('') }
    catch (e) { setError(e instanceof Error ? e.message : '读取失败，请重试') }
    finally { setLoading(false) }
  }
  useEffect(() => { void refresh(); const saved = Taro.getStorageSync('objet-current-space'); if (saved) setSpace(saved) }, [])
  const setSpaceId = (id: string) => { setSpace(id); Taro.setStorageSync('objet-current-space', id) }
  const execute = async (command: Command) => { const next = await repository.execute(command); setData(next); return next }
  return <Context.Provider value={{ data, spaceId, setSpaceId, loading, error, refresh, execute }}>{children}</Context.Provider>
}
export function useLedger() { const value = useContext(Context); if (!value) throw new Error('LedgerProvider missing'); return value }
