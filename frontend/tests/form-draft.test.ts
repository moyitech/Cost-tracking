import test from 'node:test'
import assert from 'node:assert/strict'
import { revisionAction, sameFormValues } from '../src/form-draft'

test('an untouched form equals its base even when identity and version keys differ', () => {
  const base = { input: { name: '电脑', attachments: [] }, amount: '', date: '2026-10-26', requestKey: 'a', revision: 1 }
  assert.ok(sameFormValues(base, { ...base, requestKey: 'b', revision: 2 }))
  assert.ok(sameFormValues({ amount: '', id: 'x', note: '' }, { note: '', id: 'y', amount: '' }))
  assert.ok(sameFormValues({ input: { name: '电脑', imageFileId: undefined } }, { input: { name: '电脑' } }))
  assert.ok(!sameFormValues(base, { ...base, input: { ...base.input, name: '笔记本' } }))
  assert.ok(!sameFormValues(base, { ...base, amount: '0' }))
})
test('a current revision needs no action', () => {
  assert.equal(revisionAction({ draftRevision: 3, currentRevision: 3, edited: true, correction: true }), 'none')
  assert.equal(revisionAction({ draftRevision: undefined, currentRevision: 3, edited: true, correction: true }), 'none')
  assert.equal(revisionAction({ draftRevision: 3, currentRevision: undefined, edited: true, correction: false }), 'none')
})
test('an untouched stale form resets to the latest record', () => {
  assert.equal(revisionAction({ draftRevision: 2, currentRevision: 3, edited: false, correction: true }), 'reset')
  assert.equal(revisionAction({ draftRevision: 2, currentRevision: 3, edited: false, correction: false }), 'reset')
})
test('new records rebase silently; they cannot overwrite a saved value', () => {
  assert.equal(revisionAction({ draftRevision: 2, currentRevision: 5, edited: true, correction: false }), 'rebase')
})
test('AC18: an edited correction on a stale revision must ask the user', () => {
  assert.equal(revisionAction({ draftRevision: 2, currentRevision: 3, edited: true, correction: true }), 'confirm')
})
