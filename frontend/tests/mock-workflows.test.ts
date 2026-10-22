import test from 'node:test'
import assert from 'node:assert/strict'
import { applyCommand } from '../src/commands'
import { Ledger } from '../src/domain'
import { MockSource, recognizeMockSources, entrySource } from '../src/import-mock'

const ledger = (): Ledger => ({ version: 1, items: [], spaces: [
  { id: 'home', name: '家', kind: 'family', role: 'admin', members: [{ id: 'me', name: '我', role: 'admin' }] },
  { id: 'view', name: '只读', kind: 'family', role: 'viewer', members: [] },
] })

test('local invitation can generate, accept once and retain its selected role', () => {
  const command = { type: 'invite' as const, spaceId: 'home', role: 'viewer' as const, key: 'invite-1' }
  const created = applyCommand(ledger(), command)
  const repeated = applyCommand(created, command)
  assert.equal(repeated.invitations?.length, 1)
  const joined = applyCommand(repeated, { type: 'acceptDemoInvite', id: 'invite-1', name: '演示家人' })
  assert.equal(joined.invitations?.[0].status, 'accepted')
  assert.equal(joined.spaces[0].members.length, 2)
  assert.equal(joined.spaces[0].members[1].role, 'viewer')
  const again = applyCommand(joined, { type: 'acceptDemoInvite', id: 'invite-1', name: '重复提交' })
  assert.deepEqual(again, joined)
  assert.equal(created.spaces[0].members.length, 1)
})

test('revocation prevents simulated acceptance; readonly members cannot invite', () => {
  const created = applyCommand(ledger(), { type: 'invite', spaceId: 'home', role: 'editor', key: 'invite-2' })
  const revoked = applyCommand(created, { type: 'revokeInvite', id: 'invite-2' })
  assert.throws(() => applyCommand(revoked, { type: 'acceptDemoInvite', id: 'invite-2', name: '家人' }), /已撤销/)
  assert.throws(() => applyCommand(ledger(), { type: 'invite', spaceId: 'view', role: 'editor', key: 'x' }), /只读/)
  assert.equal(revoked.spaces[0].members.length, 1)
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

test('recognition failure is per image and retry preserves other successful sources', () => {
  const sources: MockSource[] = ['first', 'last'].map(id => ({ id, path: `${id}.png`, name: id, status: 'pending', attempts: 0 }))
  const partial = recognizeMockSources(sources, true)
  assert.equal(partial[0].status, 'ready')
  assert.equal(partial[1].status, 'failed')
  assert.equal(entrySource(partial, 1)?.status, 'failed')
  const retry = recognizeMockSources(partial, true, 'last')
  assert.equal(retry[1].status, 'ready'); assert.equal(retry[1].attempts, 2)
  assert.equal(retry[0], partial[0])
  assert.equal(sources[1].status, 'pending')
  assert.equal(entrySource([], 0), undefined)
})
