import test from 'node:test'
import assert from 'node:assert/strict'
import { KeyboardSession } from '../src/keyboard-session'

test('the final blur settles once and clears the focused input', () => {
  const session = new KeyboardSession()
  session.focusInput('item', 'amount')
  const blur = session.blurInput('amount')!
  assert.equal(session.focus?.field, 'amount', 'focus is retained until the handoff window ends')
  assert.equal(session.finishBlur(blur), true)
  assert.equal(session.focus, null)
  assert.equal(session.finishBlur(blur), false)
})

test('focus handoff ignores a late blur from the old input', () => {
  for (const blurFirst of [true, false]) {
    const session = new KeyboardSession()
    session.focusInput('item', 'name')
    const previousBlur = blurFirst ? session.blurInput('name') : null
    session.focusInput('item', 'amount')
    assert.equal(session.blurInput('name'), null)
    if (previousBlur !== null) assert.equal(session.finishBlur(previousBlur), false)
    assert.equal(session.focus?.field, 'amount')
  }
})

test('refocusing the same input invalidates an earlier blur finalizer', () => {
  const session = new KeyboardSession()
  session.focusInput('expense', 'amount')
  const previousBlur = session.blurInput('amount')!
  session.focusInput('expense', 'amount')
  assert.equal(session.finishBlur(previousBlur), false)
  assert.equal(session.focus?.field, 'amount')
})

test('closing or unmounting a sheet cannot clear another sheet input', () => {
  const session = new KeyboardSession()
  session.focusInput('item', 'name')
  assert.equal(session.clear('item'), true)
  assert.equal(session.blurInput('name'), null)
  session.focusInput('expense', 'amount')
  assert.equal(session.clear('item'), false)
  assert.equal(session.focus?.owner, 'expense')
  assert.equal(session.clear('expense'), true)
  session.focusInput('reopened-item', 'new-name')
  assert.equal(session.blurInput('amount'), null)
  assert.equal(session.focus?.field, 'new-name')
})
