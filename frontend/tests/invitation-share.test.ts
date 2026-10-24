import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { invitationShareMessage, invitationToken, formatInvitationExpiry, invitationExpired } from '../src/invitation-share'

test('invitation button shares the invitation route and preserves the exact token', () => {
  const token = 'Abc_12-XYZ'
  const share = invitationShareMessage({ token, family: '周末小家' })
  assert.equal(share.title, '邀请你加入「周末小家」')
  assert.equal(share.path, `/pages/invitation/index?token=${token}`)
  assert.equal(invitationShareMessage().path, '/pages/index/index')
})

test('WeChat registers the share lifecycle and includes the landing page', () => {
  // Taro drops useShareAppMessage entirely unless this page option is enabled.
  const config = readFileSync(new URL('../src/pages/index/index.config.ts', import.meta.url), 'utf8')
  assert.match(config, /enableShareAppMessage:\s*true/)
  const app = readFileSync(new URL('../src/app.config.ts', import.meta.url), 'utf8')
  assert.match(app, /pages\/invitation\/index/)
})


test('scan scene and legacy share token resolve without changing case or losing login context', () => {
  assert.equal(invitationToken({ scene: 'Abc_12-XYZ' }), 'Abc_12-XYZ')
  assert.equal(invitationToken({ scene: '%41bc' }), 'Abc')
  assert.equal(invitationToken({ token: 'Legacy43Token', scene: 'ignored' }), 'Legacy43Token')
  assert.equal(invitationToken({ scene: '%' }), '')
  assert.equal(invitationToken({}), '')
  const share = invitationShareMessage({ token: 'test', family: '家' }, '/assets/cover.png')
  assert.equal(share.imageUrl, '/assets/cover.png')
})

test('expiry uses device local date fields and handles exact hour/day boundaries', () => {
  const expiry = new Date(2026, 9, 31, 11, 55).toISOString()
  const end = Date.parse(expiry)
  assert.equal(formatInvitationExpiry(expiry, end - 167 * 3600000), '2026年10月31日 11:55 过期（剩余6天23小时）')
  assert.match(formatInvitationExpiry(expiry, end - 3600000), /剩余0天1小时/)
  assert.match(formatInvitationExpiry(expiry, end - 1), /剩余不足1小时/)
  assert.match(formatInvitationExpiry(expiry, end), /已过期/)
  assert.equal(invitationExpired(expiry, end), true)
  assert.equal(invitationExpired(expiry, end - 1), false)
  assert.equal(invitationExpired('invalid'), true)
  assert.equal(formatInvitationExpiry('invalid'), '有效期暂不可用')
})
