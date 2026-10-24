import assert from 'node:assert/strict'
import test from 'node:test'
import { applyCommand, Command } from '../src/commands'
import type { Ledger } from '../src/domain'
import { mergeCommandResult } from '../src/family-state'
import { scannedInvitationPath } from '../src/invitation-share'
import { hasAvatarChanges } from '../src/avatar-draft'

const fixture = (): Ledger => ({ version: 1, items: [], spaces: [
  { id: 'personal', name: '个人空间', kind: 'personal', role: 'admin', members: [] },
  { id: 'family', name: '家庭', kind: 'family', role: 'admin', members: [] },
  { id: 'viewer', name: '查看', kind: 'family', role: 'viewer', members: [] },
] })

test('avatar exit guard detects cropped uploads and default restoration for both scopes', () => {
  const saved = { image: '', fileId: 'saved-avatar' }
  assert.equal(hasAvatarChanges(saved, { image: 'local://cropped' }), true)
  assert.equal(hasAvatarChanges(saved, { image: '' }), true)
  assert.equal(hasAvatarChanges({ image: 'data:previous-avatar' }, { image: '' }), true)
  assert.equal(hasAvatarChanges({ image: '' }, { image: 'local://cropped' }), true)
  // Upload then restore the original default is no longer an unsaved change.
  assert.equal(hasAvatarChanges({ image: '' }, { image: '' }), false)
  assert.equal(hasAvatarChanges({ image: 'local://saved' }, { image: 'local://saved' }), false)
})

test('signed URL refresh is not an avatar change; a new file or persisted retry draft still is', () => {
  const saved = { image: 'https://example.test/old-signature', fileId: 'saved-avatar' }
  assert.equal(hasAvatarChanges(saved, { image: 'https://example.test/new-signature', fileId: 'saved-avatar' }), false)
  assert.equal(hasAvatarChanges(saved, { image: saved.image, fileId: 'new-avatar' }), true)
  assert.equal(hasAvatarChanges(saved, { image: 'local://persisted-crop-after-save-failure' }), true)
})

test('avatar updates persist independently and preserve the original until saved', () => {
  const original = fixture()
  const command: Command = { type: 'avatar', scope: 'personal', spaceId: 'personal', image: 'local://me' }
  const own = mergeCommandResult(original, applyCommand(original, command), command)
  assert.equal(original.profile, undefined)
  assert.equal(own.profile?.avatar, 'local://me')
  const family = applyCommand(own, { type: 'avatar', scope: 'family', spaceId: 'family', image: 'local://home' })
  assert.equal(family.profile?.avatar, 'local://me')
  assert.equal(family.spaces[1].avatar, 'local://home')
  const restored = applyCommand(family, { type: 'avatar', scope: 'personal', spaceId: 'personal', image: '' })
  assert.equal(restored.profile?.avatar, undefined)
  assert.equal(restored.spaces[1].avatar, 'local://home')
})

test('avatar editing is restricted to the correct scope and administrator', () => {
  for (const [scope, spaceId] of [['family', 'viewer'], ['personal', 'family'], ['family', 'personal']] as const) {
    assert.throws(() => applyCommand(fixture(), { type: 'avatar', scope, spaceId, image: 'local://bad' }), /管理者/)
  }
})

test('scan accepts invitation token or scene paths and rejects unrelated results', () => {
  assert.equal(scannedInvitationPath('pages/invitation/index?scene=abc_123-XYZ'), '/pages/invitation/index?token=abc_123-XYZ')
  assert.equal(scannedInvitationPath('/pages/invitation/index?other=1&token=token'), '/pages/invitation/index?token=token')
  for (const path of ['', 'https://example.com/?token=bad', 'pages/index/index?token=bad', 'pages/invitation/index?scene=%ZZ', 'pages/invitation/index?token=../bad']) assert.equal(scannedInvitationPath(path), null)
})
