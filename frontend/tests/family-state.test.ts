import test from 'node:test'
import assert from 'node:assert/strict'
import { affectedSpaces, itemCommand, mergeCommandResult, orderedMembers, canManageMember } from '../src/family-state'
import { applyCommand } from '../src/commands'
import { Ledger, newItem } from '../src/domain'

const ledger = (): Ledger => ({ version: 1, spaces: [{ id: 'personal', name: '我', kind: 'personal', role: 'admin', members: [] }], items: [newItem({ name: '电脑', image: '', note: '', purchaseAmount: 10000, purchaseDate: '2026-10-01' }, 'personal', 'computer')] })

test('family creation publishes the returned space and preserves concurrent item changes', () => {
  const old = ledger()
  const next = applyCommand(old, { type: 'createSpace', name: '家', nickname: '小明', key: 'server-space' })
  const current = { ...old, items: [{ ...old.items[0], revision: 2, name: '修正名称' }] }
  const merged = mergeCommandResult(current, next, { type: 'createSpace', name: '家', nickname: '小明', key: 'key' })
  assert.equal(merged.resultSpaceId, 'server-space'); assert.equal(merged.spaces.length, 2)
  assert.equal(merged.items[0].name, '修正名称')
  assert.equal(merged.spaces[1].members[0].name, '小明')
  assert.equal(itemCommand({ type: 'revokeInvite', id: 'invitation' }), false)
})

test('transfer invalidates both partitions and retains one item', () => {
  const old = ledger()
  const family = applyCommand(old, { type: 'createSpace', name: '家', nickname: '小明', key: 'home' })
  const command = { type: 'move' as const, id: 'computer', revision: 1, spaceId: 'home' }
  assert.deepEqual(affectedSpaces(family, command), ['personal', 'home'])
  const result = mergeCommandResult(family, applyCommand(family, command), command)
  assert.equal(result.items.length, 1); assert.equal(result.items[0].spaceId, 'home')
  assert.equal(result.items[0].revision, 2)
})

test('mock expiry and removal reject old invites, while a new invitation restores membership', () => {
  let data = applyCommand(ledger(), { type: 'createSpace', name: '家', nickname: '小明', key: 'home' })
  data = applyCommand(data, { type: 'invite', spaceId: 'home', role: 'editor', key: 'first' })
  data = applyCommand(data, { type: 'acceptDemoInvite', id: 'first', name: '家人' })
  const id = data.invitations![0].memberId!
  data = applyCommand(data, { type: 'member', spaceId: 'home', memberId: id, role: 'remove' })
  assert.throws(() => applyCommand(data, { type: 'acceptDemoInvite', id: 'first', name: '家人' }), /新邀请/)
  data = applyCommand(data, { type: 'invite', spaceId: 'home', role: 'viewer', key: 'second' })
  data.invitations![0].createdAt = new Date(Date.parse(data.removals![`home:${id}`]) + 1).toISOString()
  const rejoined = applyCommand(data, { type: 'acceptDemoInvite', id: 'second', name: '家人' })
  assert.equal(rejoined.spaces[1].members.find(m => m.id === id)?.role, 'viewer')
  data.invitations![0].expiresAt = '2000-01-01T00:00:00Z'
  assert.throws(() => applyCommand(data, { type: 'acceptDemoInvite', id: 'second', name: '另一人' }), /过期/)
})

test('member roster keeps admins first, self first within a role, and stable peer order', () => {
  const members = [
    { id: 'viewer', role: 'viewer' as const }, { id: 'new-editor', role: 'editor' as const },
    { id: 'me', role: 'editor' as const }, { id: 'admin', role: 'admin' as const },
    { id: 'old-editor', role: 'editor' as const },
  ]
  assert.deepEqual(orderedMembers(members, 'me').map(m => m.id), ['admin', 'me', 'new-editor', 'old-editor', 'viewer'])
  assert.deepEqual(orderedMembers(members, 'viewer').map(m => m.id), ['admin', 'new-editor', 'me', 'old-editor', 'viewer'])
  assert.equal(members[0].id, 'viewer')
})

test('only admins may manage other non-admin members', () => {
  const admin = { id: 'admin', role: 'admin' }
  const editor = { id: 'editor', role: 'editor' }
  const viewer = { id: 'viewer', role: 'viewer' }
  assert.equal(canManageMember(admin, editor), true)
  assert.equal(canManageMember(admin, viewer), true)
  assert.equal(canManageMember(admin, admin), false)
  assert.equal(canManageMember(admin, { id: 'other-admin', role: 'admin' }), false)
  for (const me of [null, editor, viewer]) {
    for (const target of [admin, editor, viewer]) assert.equal(canManageMember(me, target), false)
  }
})
