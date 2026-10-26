import test from 'node:test'
import assert from 'node:assert/strict'
import { blankSnapshot, collectPages, inPool, mediaReferences, mediaRetentionKeys, OfflineSnapshot, retryDelay, sameManifest, SyncManifest, SyncPorts, synchronize } from '../src/offline-sync'
import { newItem } from '../src/domain'

const manifest = (version = '1', checked_at = '2026-10-25T02:00:00Z'): SyncManifest => ({ profile_version: 'p1', presets_version: 'preset1', preset_versions: { illustration: '3' }, spaces: [{ id: 'personal', version }, { id: 'family', version }], checked_at })
const spaces = [{ id: 'personal', name: '个人', kind: 'personal' as const, role: 'admin' as const, members: [] }, { id: 'family', name: '家庭', kind: 'family' as const, role: 'editor' as const, members: [] }]
function fixture() {
  let server = manifest(); let current = blankSnapshot(); const saves: OfflineSnapshot[] = []; const loaded: string[] = []; const pictures: string[] = []
  const ports: SyncPorts = {
    manifest: async () => structuredClone(server), metadata: async () => ({ version: 1, spaces, items: [] }),
    space: async (id, space) => {
      loaded.push(id)
      const item = newItem({ name: id, image: '', imageFileId: `${id}-photo`, purchaseAmount: 100, purchaseDate: '2026-10-20', note: '', attachments: [] }, id, id + '-item')
      return { space, items: [item], remote: { events: [], eventsCursor: null, trashIds: [], trashCursor: null } }
    },
    save: async value => { saves.push(structuredClone(value)) }, publish: value => { current = value },
    media: async ref => { pictures.push(ref.key) }, prune: async () => {},
  }
  return { ports, saves, loaded, pictures, get current() { return current }, get server() { return server }, set server(value) { server = value } }
}

test('initial sync includes every space and only advances time after media and final confirmation', async () => {
  const f = fixture(); let duringMedia: string | null = 'not-checked'
  const media = f.ports.media
  f.ports.media = async ref => { duringMedia = f.current.lastSyncedAt; await media(ref) }
  await synchronize(blankSnapshot(), f.ports, () => true)
  assert.deepEqual(f.loaded.sort(), ['family', 'personal'])
  assert.equal(f.current.data.items.length, 2)
  assert.equal(duringMedia, null)
  assert.equal(f.current.lastSyncedAt, f.server.checked_at)
  assert.equal(f.saves.length, 2)
})

test('unchanged heartbeat persists new server time without fetching any records', async () => {
  const f = fixture(); await synchronize(blankSnapshot(), f.ports, () => true)
  f.loaded.length = 0; f.server = manifest('1', '2026-10-25T02:01:00Z')
  await synchronize(f.current, f.ports, () => true)
  assert.deepEqual(f.loaded, [])
  assert.equal(f.current.lastSyncedAt, '2026-10-25T02:01:00Z')
})

test('an unchanged heartbeat retains browsed presets without requiring downloads of the full catalog', async () => {
  const f = fixture(); await synchronize(blankSnapshot(), f.ports, () => true)
  f.pictures.length = 0
  let retained = new Set<string>()
  f.ports.prune = async keys => { retained = keys }
  await synchronize(f.current, f.ports, () => true)
  assert.ok(retained.has('preset:illustration:3:preview'))
  assert.ok(!retained.has('preset:illustration:2:preview'))
  assert.ok(!f.pictures.some(key => key.startsWith('preset:')))
  assert.deepEqual(retained, mediaRetentionKeys(f.current))
})

test('only a changed space is replaced, including deleted or transferred records', async () => {
  const f = fixture(); await synchronize(blankSnapshot(), f.ports, () => true)
  f.loaded.length = 0; f.server.spaces[1].version = '2'
  f.ports.space = async (id, space) => { f.loaded.push(id); return { space, items: [], remote: { events: [], eventsCursor: null, trashIds: [], trashCursor: null } } }
  await synchronize(f.current, f.ports, () => true)
  assert.deepEqual(f.loaded, ['family'])
  assert.deepEqual(f.current.data.items.map(i => i.spaceId), ['personal'])
})

test('a failed page or changed version never publishes a partial space', async () => {
  const f = fixture(); await synchronize(blankSnapshot(), f.ports, () => true)
  const previous = f.current; f.server = manifest('2')
  f.ports.space = async () => { throw new Error('second page failed') }
  await assert.rejects(synchronize(previous, f.ports, () => true), /second page/)
  assert.equal(f.current, previous)
  const g = fixture(); let checks = 0
  g.ports.manifest = async () => manifest(String(++checks))
  await assert.rejects(synchronize(blankSnapshot(), g.ports, () => true), /同步期间/)
  assert.equal(g.saves.length, 0)
})

test('image failure or storage quota failure preserves last successful time', async () => {
  const f = fixture(); await synchronize(blankSnapshot(), f.ports, () => true)
  const oldTime = f.current.lastSyncedAt; f.server = manifest('2', '2026-10-25T03:00:00Z')
  f.ports.media = async () => { throw new Error('image quota') }
  await assert.rejects(synchronize(f.current, f.ports, () => true), /image quota/)
  assert.equal(f.current.lastSyncedAt, oldTime)
  f.ports.save = async () => { throw new Error('disk full') }
  f.server = manifest('3')
  const before = f.current
  await assert.rejects(synchronize(before, f.ports, () => true), /disk full/)
  assert.equal(f.current, before)
})

test('revoked space disappears even when later metadata fails', async () => {
  const f = fixture(); await synchronize(blankSnapshot(), f.ports, () => true)
  f.server.spaces = f.server.spaces.filter(s => s.id !== 'family')
  f.ports.metadata = async () => { throw new Error('offline now') }
  await assert.rejects(synchronize(f.current, f.ports, () => true), /offline now/)
  assert.deepEqual(f.current.data.spaces.map(s => s.id), ['personal'])
  assert.deepEqual(f.current.data.items.map(i => i.spaceId), ['personal'])
  assert.equal(f.current.remote.family, undefined)
})

test('account change fences late results before storage or publication', async () => {
  const f = fixture(); let valid = true
  f.ports.metadata = async () => { valid = false; return { version: 1, spaces, items: [] } }
  await assert.rejects(synchronize(blankSnapshot(), f.ports, () => valid), /取消/)
  assert.equal(f.saves.length, 0)
  assert.equal(f.current.data.items.length, 0)
})

test('all media references include expenses, receipts, member avatars, and versioned presets', () => {
  const value = blankSnapshot(); value.manifest = manifest()
  value.data.profile = { id: 'u', displayName: '我', avatarFileId: 'avatar' }
  value.data.spaces = [{ ...spaces[1], members: [{ id: 'm', name: '成员', role: 'editor', avatarFileId: 'member-avatar' }] }]
  value.data.items = [{ ...newItem({ name: '物品', image: '', imagePresetId: 'illustration', purchaseAmount: 0, purchaseDate: null, note: '', attachments: [{ name: '凭证', path: '', fileId: 'receipt' }] }, 'family'), expenses: [{ id: 'e', amount: 1, category: '其他', date: '2026-10-20', note: '', attachmentFileIds: ['expense-receipt'] }] }]
  assert.deepEqual(mediaReferences(value).map(r => r.key).sort(), ['file:avatar:preview-v1', 'file:expense-receipt:preview-v1', 'file:member-avatar:preview-v1', 'file:receipt:preview-v1', 'preset:illustration:3:preview'].sort())
})

test('pagination drains pages, deduplicates IDs, and rejects loops', async () => {
  const rows = await collectPages(async cursor => cursor ? { items: [{ id: 'a', value: 2 }, { id: 'b', value: 3 }], cursor: null } : { items: [{ id: 'a', value: 1 }], cursor: 'next' })
  assert.deepEqual(rows, [{ id: 'a', value: 2 }, { id: 'b', value: 3 }])
  await assert.rejects(collectPages(async () => ({ items: [], cursor: 'loop' })), /分页异常/)
})

test('pool enforces concurrency and drains outstanding workers after failure', async () => {
  let active = 0; let peak = 0
  await assert.rejects(inPool([0, 1, 2, 3, 4], 2, async value => {
    active++; peak = Math.max(peak, active)
    await new Promise(resolve => setTimeout(resolve, 5)); active--
    if (value === 0) throw new Error('failed')
  }), /failed/)
  assert.equal(peak, 2); assert.equal(active, 0)
})

test('versions ignore check time and array order; retry backs off to five minutes', () => {
  const a = manifest(); const b = manifest('1', '2026-10-26T00:00:00Z'); b.spaces.reverse()
  assert.equal(sameManifest(a, b), true)
  b.profile_version = 'new'; assert.equal(sameManifest(a, b), false)
  assert.deepEqual([1, 2, 3, 4, 10].map(retryDelay), [60000, 120000, 240000, 300000, 300000])
})
