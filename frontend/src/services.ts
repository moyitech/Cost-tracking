import Taro from '@tarojs/taro'
import { Command, applyCommand } from './commands'
import { Ledger, migrateLedger, StoredLedger } from './domain'
import { initialLedger } from './mock'

const STORAGE_KEY = 'objet-ledger:v1'
export const mockEnabled = USE_MOCK
async function request<T>(path: string, method: 'GET' | 'POST', data?: unknown): Promise<T> {
  const response = await Taro.request<T>({ url: `${API_BASE_URL}${path}`, method, data, timeout: 15000, header: { 'Content-Type': 'application/json' } })
  if (response.statusCode === 409) throw new Error('档案已更新，请刷新后核对再保存')
  if (response.statusCode === 403) throw new Error('权限已变化，不能保存；输入已保留')
  if (response.statusCode < 200 || response.statusCode >= 300) throw new Error('服务暂时不可用，输入已保留，请重试')
  return response.data
}
export function readLocal(): Ledger {
  const value = Taro.getStorageSync<StoredLedger>(STORAGE_KEY)
  if (!value) { const initial = initialLedger(); Taro.setStorageSync(STORAGE_KEY, initial); return initial }
  if (value.version !== 1 || !Array.isArray(value.items) || !Array.isArray(value.spaces)) throw new Error('本地档案格式无法读取，请保留数据并联系维护者')
  const migrated = migrateLedger(value)
  if (migrated !== value) Taro.setStorageSync(STORAGE_KEY, migrated)
  return migrated
}
export const repository = {
  load: async () => USE_MOCK ? readLocal() : request<Ledger>('/ledger', 'GET'),
  execute: async (command: Command): Promise<Ledger> => {
    if (!USE_MOCK) return request<Ledger>('/ledger/commands', 'POST', command)
    const next = applyCommand(readLocal(), command)
    // Commit the complete snapshot once; storage failure never updates React state.
    Taro.setStorageSync(STORAGE_KEY, next)
    return next
  },
}
export function saveDraft<T>(key: string, value: T) { Taro.setStorageSync(`objet-draft:${key}`, value) }
export function getDraft<T>(key: string): T | null { return Taro.getStorageSync(`objet-draft:${key}`) || null }
export function clearDraft(key: string) { Taro.removeStorageSync(`objet-draft:${key}`) }
