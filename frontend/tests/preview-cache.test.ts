import test from 'node:test'
import assert from 'node:assert/strict'
import { PreviewCache } from '../src/preview-cache'

test('reopening uses the resolved preview synchronously and concurrent reads share one load', async () => {
  const cache = new PreviewCache(); let calls = 0
  let release!: (url: string) => void
  const load = () => { calls++; return new Promise<string>(resolve => { release = resolve }) }
  const first = cache.load('picture', load); const second = cache.load('picture', load)
  assert.equal(calls, 1)
  release('local.webp'); assert.deepEqual(await Promise.all([first, second]), ['local.webp', 'local.webp'])
  assert.equal(cache.peek('picture')?.url, 'local.webp')
  await cache.load('picture', load); assert.equal(calls, 1)
})

test('a failed preview notifies its subscribers when a later background repair succeeds', async () => {
  const cache = new PreviewCache(); const changes: (string | null)[] = []
  const unsubscribe = cache.subscribe(key => changes.push(key))
  await assert.rejects(cache.load('photo', async () => { throw new Error('offline') }), /offline/)
  assert.equal(cache.peek('photo'), undefined); assert.deepEqual(changes, [])
  await cache.load('photo', async () => 'repaired.webp')
  assert.deepEqual(changes, ['photo'])
  await cache.load('photo', async () => { throw new Error('should not reload') })
  assert.deepEqual(changes, ['photo'])
  unsubscribe(); await cache.load('avatar', async () => 'avatar.webp')
  assert.deepEqual(changes, ['photo'])
})

test('repairing a broken local path updates its render revision without resetting unrelated images', async () => {
  const cache = new PreviewCache(); const changes: (string | null)[] = []
  await cache.load('photo', async () => 'same-path.webp')
  await cache.load('avatar', async () => 'avatar.webp')
  const before = cache.peek('photo')!; const avatar = cache.peek('avatar')
  cache.subscribe(key => changes.push(key))
  await cache.load('photo', async () => 'same-path.webp', true)
  assert.equal(cache.peek('photo')?.url, before.url)
  assert.notEqual(cache.peek('photo')?.revision, before.revision)
  assert.equal(cache.peek('avatar'), avatar)
  assert.deepEqual(changes, ['photo'])
})

test('account changes fence late responses, including a replacement request for the same key', async () => {
  const cache = new PreviewCache(); let release!: (url: string) => void
  const old = cache.load('same-id', () => new Promise<string>(resolve => { release = resolve }))
  const rejected = assert.rejects(old, /账号已变化/)
  cache.reset()
  await cache.load('same-id', async () => 'new-account.webp')
  release('old-account.webp'); await rejected
  assert.equal(cache.peek('same-id')?.url, 'new-account.webp')
})

test('retention drops obsolete previews from memory while retaining valid presets', async () => {
  const cache = new PreviewCache()
  await cache.load('preset:phone:1:preview', async () => 'preset.webp')
  await cache.load('file:revoked:preview-v1', async () => 'private.webp')
  cache.retain(new Set(['preset:phone:1:preview']))
  assert.ok(cache.peek('preset:phone:1:preview'))
  assert.equal(cache.peek('file:revoked:preview-v1'), undefined)
})
