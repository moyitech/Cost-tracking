import test from 'node:test'
import assert from 'node:assert/strict'
import { applyCommand } from '../src/commands'
import { Ledger } from '../src/domain'
import { createDemoImports } from '../src/import-demo'

const ledger = (): Ledger => ({ version: 1, items: [], spaces: [
  { id: 'home', name: '家', kind: 'family', role: 'admin', members: [{ id: 'me', name: '我', role: 'admin' }] },
  { id: 'view', name: '只读', kind: 'family', role: 'viewer', members: [] },
] })

test('local invitation admits multiple members and repeat acceptance preserves the role', () => {
  const command = { type: 'invite' as const, spaceId: 'home', role: 'viewer' as const, key: 'invite-1' }
  const created = applyCommand(ledger(), command)
  const repeated = applyCommand(created, command)
  assert.equal(repeated.invitations?.length, 1)
  const joined = applyCommand(repeated, { type: 'acceptDemoInvite', id: 'invite-1', name: '演示家人' })
  assert.equal(joined.invitations?.[0].status, 'pending')
  assert.equal(joined.spaces[0].members.length, 2)
  assert.equal(joined.spaces[0].members[1].role, 'viewer')
  const again = applyCommand(joined, { type: 'acceptDemoInvite', id: 'invite-1', name: '演示家人' })
  assert.deepEqual(again, joined)
  const another = applyCommand(joined, { type: 'acceptDemoInvite', id: 'invite-1', name: '另一位家人' })
  assert.equal(another.spaces[0].members.length, 3)
  assert.equal(another.invitations?.[0].acceptedMembers?.length, 2)
  assert.equal(created.spaces[0].members.length, 1)
})

test('revocation prevents simulated acceptance; readonly members cannot invite', () => {
  const created = applyCommand(ledger(), { type: 'invite', spaceId: 'home', role: 'editor', key: 'invite-2' })
  const revoked = applyCommand(created, { type: 'revokeInvite', id: 'invite-2' })
  assert.throws(() => applyCommand(revoked, { type: 'acceptDemoInvite', id: 'invite-2', name: '家人' }), /已撤销/)
  assert.throws(() => applyCommand(ledger(), { type: 'invite', spaceId: 'view', role: 'editor', key: 'x' }), /只读/)
  assert.equal(revoked.spaces[0].members.length, 1)
  assert.deepEqual(applyCommand(revoked, { type: 'revokeInvite', id: 'invite-2' }), revoked)
})

test('accepted member can change roles or be removed without allowing admin transfer', () => {
  const created = applyCommand(ledger(), { type: 'invite', spaceId: 'home', role: 'editor', key: 'invite-3' })
  const joined = applyCommand(created, { type: 'acceptDemoInvite', id: 'invite-3', name: '家人' })
  const id = joined.invitations![0].memberId!
  const viewer = applyCommand(joined, { type: 'member', spaceId: 'home', memberId: id, role: 'viewer' })
  assert.equal(viewer.spaces[0].members[1].role, 'viewer')
  assert.throws(() => applyCommand(viewer, { type: 'member', spaceId: 'home', memberId: id, role: 'admin' }), /转交规则/)
  const removed = applyCommand(viewer, { type: 'member', spaceId: 'home', memberId: id, role: 'remove' })
  assert.equal(removed.spaces[0].members.length, 1)
  assert.throws(() => applyCommand(removed, { type: 'member', spaceId: 'home', memberId: 'me', role: 'remove' }), /自己的角色/)
})

test('demo batches use the real page contract and never restore canceled tasks', async () => {
  let data = ledger()
  const api = createDemoImports(() => data, async command => { data = applyCommand(data, command); return data })
  const originalNow = Date.now
  let now = originalNow()
  Date.now = () => now
  try {
    let task = await api.create('home', ['a.png', 'b.png'], 'create')
    assert.equal(task.entries.length, 0); assert.equal(task.sources.length, 2)
    task = await api.get(task.id); assert.equal(task.status, 'processing')
    now += 2000
    task = await api.get(task.id); assert.equal(task.status, 'ready'); assert.equal(task.entries.length, 3)
    const entry = await api.patch(task.id, task.entries[0].id, 1, { confirmed: true })
    const body = [{ entry_id: entry.id, revision: entry.revision }]
    const first = await api.commit(task.id, body, 'save')
    const replay = await api.commit(task.id, body, 'save')
    assert.equal(first.results[0].item_id, replay.results[0].item_id); assert.equal(data.items.length, 1)
    await api.cancel(task.id)
    await assert.rejects(() => api.get(task.id))
    const next = await api.create('home', ['c.png'], 'new')
    assert.notEqual(next.id, task.id); assert.deepEqual(next.entries, [])
  } finally { Date.now = originalNow }
})

test('routine edits update the revision without adding timeline events', () => {
  const input = { name: '相机', image: '', note: '', purchaseAmount: 0, purchaseDate: '2026-10-01' }
  const created = applyCommand(ledger(), { type: 'create', spaceId: 'home', input, key: 'routine-edit' })
  const item = created.items[0]
  const edited = applyCommand(created, { type: 'edit', id: item.id, revision: item.revision, input: { ...input, name: '相机（修正）', purchaseAmount: 1250 } })
  assert.equal(edited.items[0].revision, item.revision + 1)
  assert.equal(edited.items[0].purchaseAmount, 1250)
  assert.deepEqual(edited.items[0].history, item.history)
})
