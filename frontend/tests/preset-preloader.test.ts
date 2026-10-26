import test from 'node:test'
import assert from 'node:assert/strict'
import { PresetPreloader } from '../src/preset-preloader'
import { PreviewCache } from '../src/preview-cache'

const tick = () => new Promise<void>(resolve => setImmediate(resolve))
const items = Array.from({ length: 6 }, (_, i) => ({ id: String(i) }))

test('startup warming is asynchronous, coalesced, and downloads at most two thumbnails at once', async () => {
  let active = 0; let peak = 0; let lists = 0; const loaded: string[] = []
  const warmer = new PresetPreloader({
    list: async () => { lists++; return items },
    preview: async id => { active++; peak = Math.max(peak, active); await tick(); loaded.push(id); active-- },
  })
  const first = warmer.run('account:v1', () => true)
  assert.equal(warmer.run('account:v1', () => true), first)
  assert.equal(loaded.length, 0)
  await first
  assert.equal(peak, 2); assert.deepEqual(loaded.sort(), items.map(item => item.id)); assert.equal(lists, 1)
  await warmer.run('account:v1', () => true)
  assert.equal(lists, 1)
})

test('a failed preload stays silent and the next pass reuses successful cached thumbnails', async () => {
  const cache = new PreviewCache(); const downloads = new Map<string, number>(); let lists = 0
  const warmer = new PresetPreloader({
    list: async () => { lists++; return items },
    preview: id => cache.load(id, async () => {
      const count = (downloads.get(id) || 0) + 1; downloads.set(id, count)
      if (id === '0' && count === 1) throw new Error('offline')
      return `local:${id}`
    }),
  })
  await assert.doesNotReject(warmer.run('account:v1', () => true))
  await warmer.run('account:v1', () => true)
  assert.equal(lists, 2); assert.equal(downloads.get('0'), 2)
  for (const item of items.slice(1)) assert.equal(downloads.get(item.id), 1)
  for (const item of items) assert.equal(cache.peek(item.id)?.url, `local:${item.id}`)
})

test('hiding or losing connectivity stops queued downloads and foregrounding can resume', async () => {
  let foreground = true; const started: string[] = []; const release: (() => void)[] = []
  const cache = new PreviewCache()
  const warmer = new PresetPreloader({
    list: async () => items,
    preview: id => cache.load(id, async () => {
      started.push(id)
      if (started.length <= 2) await new Promise<void>(resolve => release.push(resolve))
      return `local:${id}`
    }),
  })
  const first = warmer.run('account:v1', () => foreground)
  await tick(); assert.deepEqual(started, ['0', '1'])
  foreground = false; release.forEach(resolve => resolve()); await first
  assert.deepEqual(started, ['0', '1'])
  foreground = true; await warmer.run('account:v1', () => foreground)
  assert.deepEqual(started, items.map(item => item.id))
})

test('a replacement account or version drains old workers and never queues more old thumbnails', async () => {
  let version = 'old'; let lists = 0; const started: string[] = []; const release: (() => void)[] = []
  const warmer = new PresetPreloader({
    list: async () => { lists++; return items.map(item => ({ id: `${version}:${item.id}` })) },
    preview: async id => { started.push(id); if (id.startsWith('old:')) await new Promise<void>(resolve => release.push(resolve)) },
  })
  const old = warmer.run('old', () => version === 'old')
  await tick(); version = 'new'
  const current = warmer.run('new', () => version === 'new')
  assert.equal(lists, 1)
  release.forEach(resolve => resolve()); await Promise.all([old, current])
  assert.deepEqual(started, ['old:0', 'old:1', ...items.map(item => `new:${item.id}`)])
  await warmer.run('new', () => true); assert.equal(lists, 2)
})

test('catalog errors do not mark a version warm and reset invalidates completed work', async () => {
  let fail = true; let lists = 0; let downloads = 0
  const warmer = new PresetPreloader({
    list: async () => { lists++; if (fail) throw new Error('offline'); return items },
    preview: async () => { downloads++ },
  })
  await warmer.run('same-account:v1', () => false); assert.equal(lists, 0)
  await assert.doesNotReject(warmer.run('same-account:v1', () => true)); assert.equal(downloads, 0)
  fail = false; await warmer.run('same-account:v1', () => true)
  assert.equal(downloads, items.length)
  warmer.reset(); await warmer.run('same-account:v1', () => true)
  assert.equal(downloads, items.length * 2); assert.equal(lists, 3)
})

test('a new sync can resume the same version while an invalidated batch is still draining', async () => {
  let token = 0; let lists = 0; let release!: () => void; const started: string[] = []
  const warmer = new PresetPreloader({
    list: async () => { lists++; return [{ id: 'phone' }] },
    preview: async id => { started.push(id); if (started.length === 1) await new Promise<void>(resolve => { release = resolve }) },
  })
  const old = warmer.run('account:v1', () => token === 0)
  await tick(); token++
  const next = warmer.run('account:v1', () => token === 1)
  release(); await Promise.all([old, next])
  assert.equal(lists, 2); assert.deepEqual(started, ['phone', 'phone'])
})
