import test from 'node:test'
import assert from 'node:assert/strict'
import { revealScrollTop, SheetScrollSession, stablePixels } from '../src/sheet-scroll'

test('focus waits for the keyboard and reveals once despite rerenders and repeated height events', () => {
  const session = new SheetScrollSession()
  session.focus('name')
  assert.equal(session.request(), null)
  session.keyboard(true)
  const request = session.request()!
  assert.equal(request.field, 'name')
  assert.equal(session.consume(request), true)
  for (let i = 0; i < 10; i++) {
    session.focus('name'); session.keyboard(true)
    assert.equal(session.request(), null)
  }
  assert.equal(session.consume(request), false)
})

test('keyboard-before-focus also reveals once, and switching fields invalidates stale queries', () => {
  const session = new SheetScrollSession()
  session.keyboard(true); session.focus('name')
  const old = session.request()!
  session.focus('amount')
  assert.equal(session.consume(old), false)
  assert.equal(session.request()?.field, 'amount')
  assert.equal(session.consume(session.request()!), true)
  // A change of keyboard height does not start another focus request.
  session.keyboard(true)
  assert.equal(session.request(), null)
})

test('dragging cancels in-flight and not-yet-open keyboard requests until a new focus', () => {
  const session = new SheetScrollSession()
  session.focus('amount'); session.keyboard(true)
  const inFlight = session.request()!
  session.cancel()
  assert.equal(session.consume(inFlight), false)
  session.keyboard(true); session.focus('amount')
  assert.equal(session.request(), null)
  session.focus('note')
  assert.equal(session.request()?.field, 'note')
  session.keyboard(false); session.focus('name'); session.cancel(); session.keyboard(true)
  assert.equal(session.request(), null, 'a late keyboard event cannot override a drag')
})

test('dismissal cancels queued work and reopening starts a fresh keyboard session', () => {
  const session = new SheetScrollSession()
  session.focus('amount'); session.keyboard(true)
  const previous = session.request()!
  session.keyboard(false)
  assert.equal(session.consume(previous), false)
  assert.equal(session.request(), null)
  session.keyboard(true)
  assert.equal(session.consume(session.request()!), true)
  session.focus('')
  assert.equal(session.request(), null)
})

test('a late blur cannot clear the new field, but the current blur cancels queued reveal', () => {
  const session = new SheetScrollSession()
  session.focus('name'); session.keyboard(true)
  const old = session.request()!
  session.focus('amount')
  const current = session.request()!
  assert.equal(session.blur('name'), false)
  assert.deepEqual(session.request(), current)
  assert.equal(session.consume(old), false)
  assert.equal(session.blur('amount'), true)
  assert.equal(session.consume(current), false)
  assert.equal(session.request(), null)
})

test('close and zero height invalidate queries even when another session opens before they return', () => {
  const session = new SheetScrollSession()
  for (const close of [() => session.reset(), () => session.keyboard(false)]) {
    session.focus('amount'); session.keyboard(true)
    const beforeClose = session.request()!
    close()
    assert.equal(session.request(), null)
    session.focus('name'); session.keyboard(true)
    assert.equal(session.consume(beforeClose), false)
    assert.equal(session.consume(session.request()!), true)
  }
})

test('reveal moves only enough to clear the heading or footer, leaving visible fields alone', () => {
  const viewport = { top: 100, bottom: 400 }
  assert.equal(revealScrollTop({ top: 160, bottom: 250 }, viewport, 120), 120)
  assert.equal(revealScrollTop({ top: 350, bottom: 440 }, viewport, 120), 168)
  assert.equal(revealScrollTop({ top: 70, bottom: 160 }, viewport, 120), 82)
  assert.equal(revealScrollTop({ top: 50, bottom: 160 }, viewport, 10), 0)
  assert.equal(revealScrollTop({ top: 100, bottom: 190 }, { top: 100, bottom: 180 }, 0), 18)
})

test('subpixel noise is ignored but real viewport changes and dismissal are retained', () => {
  assert.equal(stablePixels(undefined, 200.2), 200.2)
  assert.equal(stablePixels(200, 200.7), 200)
  assert.equal(stablePixels(200, 199.3), 200)
  assert.equal(stablePixels(200, 201.1), 201.1)
  assert.equal(stablePixels(300, 0), 0)
})
