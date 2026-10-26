import test from 'node:test'
import assert from 'node:assert/strict'
import { ApiImagePreset, createPresetCatalog } from '../src/image-preset-client'

test('catalog shares in-flight requests, caches signed URLs, and refreshes on expiry or image errors', async () => {
  let now = Date.parse('2026-10-23T00:00:00Z'); const calls: string[] = []
  const item: ApiImagePreset = { id: 'emoji-phone-v1', name: '手机', style: 'cartoon', version: 1, url: 'original', preview_url: 'preview', expires_at: new Date(now + 300000).toISOString() }
  const catalog = createPresetCatalog(async <T>(path: string): Promise<T> => {
    calls.push(path)
    return (path === '/image-presets' ? { items: [item] } : { url: `refreshed-${calls.length}`, expires_at: new Date(now + 300000).toISOString() }) as T
  }, () => now)
  const lists = await Promise.all([catalog.list(), catalog.list()])
  assert.deepEqual(lists[0], [{ id: item.id, name: item.name, style: item.style, src: 'preview' }])
  assert.equal(calls.length, 1)
  assert.equal(await catalog.url(item.id), 'preview')
  assert.equal(await catalog.url(item.id, false, 'original'), 'original')
  assert.equal(calls.length, 1)
  now += 280000
  const urls = await Promise.all([catalog.url(item.id), catalog.url(item.id)])
  assert.equal(urls[0], urls[1]); assert.equal(calls.length, 2)
  assert.equal(await catalog.url(item.id, true), 'refreshed-3')
  assert.equal(calls.length, 3)
  await catalog.list(); assert.equal(calls.length, 4)
})

test('disabled presets can still be resolved individually, and failed requests can be retried', async () => {
  let fail = true
  const catalog = createPresetCatalog(async <T>(path: string): Promise<T> => {
    if (fail) throw new Error('offline')
    return (path === '/image-presets' ? { items: [] } : { url: 'disabled-original', expires_at: '2099-01-01' }) as T
  })
  await assert.rejects(() => catalog.list(), /offline/)
  await assert.rejects(() => catalog.url('disabled-v1'), /offline/)
  fail = false
  assert.deepEqual(await catalog.list(), [])
  assert.equal(await catalog.url('disabled-v1', false, 'original'), 'disabled-original')
})

test('manifest invalidation reloads a disabled catalog entry before signed URLs expire', async () => {
  let enabled = true; let calls = 0
  const catalog = createPresetCatalog(async <T>(): Promise<T> => {
    calls++
    return { items: enabled ? [{ id: 'phone', name: '手机', style: 'cartoon', version: 1, url: 'old', preview_url: 'old-preview', expires_at: '2099-01-01' }] : [] } as T
  })
  assert.equal((await catalog.list()).length, 1)
  enabled = false; catalog.invalidate()
  assert.deepEqual(await catalog.list(), []); assert.equal(calls, 2)
})

test('a late old catalog response cannot restore entries removed by a newer manifest', async () => {
  let release!: (value: { items: ApiImagePreset[] }) => void; let calls = 0
  const catalog = createPresetCatalog(async <T>(): Promise<T> => {
    calls++
    return (calls === 1 ? await new Promise<{ items: ApiImagePreset[] }>(resolve => { release = resolve }) : { items: [] }) as T
  })
  const old = catalog.list(); catalog.invalidate()
  assert.deepEqual(await catalog.list(), [])
  release({ items: [{ id: 'removed', name: '旧预设', style: 'cartoon', version: 1, url: 'old', preview_url: 'old-preview', expires_at: '2099-01-01' }] })
  assert.deepEqual(await old, []); assert.deepEqual(await catalog.list(), []); assert.equal(calls, 2)
})

test('invalidation also fences late signed URLs', async () => {
  let release!: (value: { url: string; expires_at: string }) => void; let calls = 0
  const catalog = createPresetCatalog(async <T>(): Promise<T> => {
    calls++
    return (calls === 1 ? await new Promise<{ url: string; expires_at: string }>(resolve => { release = resolve }) : { url: 'new-preview', expires_at: '2099-01-01' }) as T
  })
  const old = catalog.url('phone'); catalog.invalidate()
  assert.equal(await catalog.url('phone'), 'new-preview')
  release({ url: 'old-preview', expires_at: '2099-01-01' })
  assert.equal(await old, 'new-preview'); assert.equal(await catalog.url('phone'), 'new-preview'); assert.equal(calls, 2)
})
