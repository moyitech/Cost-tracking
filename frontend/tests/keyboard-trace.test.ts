import test from 'node:test'
import assert from 'node:assert/strict'

test('development keyboard records are bounded, copied on read and disabled in production', async () => {
  const previousEnv = process.env.NODE_ENV
  const debug = globalThis as typeof globalThis & { __objetKeyboardTrace?: () => Record<string, unknown>[] }
  try {
    process.env.NODE_ENV = 'development'
    const { traceKeyboard } = await import('../src/keyboard-trace')
    for (let i = 0; i < 140; i++) traceKeyboard({ event: 'height', field: 'amount', height: i, accepted: true })
    const snapshot = debug.__objetKeyboardTrace!()
    assert.equal(snapshot.length, 120)
    assert.equal(snapshot[0].height, 20)
    assert.deepEqual(Object.keys(snapshot[0]).sort(), ['accepted', 'event', 'field', 'height', 'time'])
    snapshot[0].height = -1
    assert.equal(debug.__objetKeyboardTrace!()[0].height, 20)
    process.env.NODE_ENV = 'production'
    traceKeyboard({ event: 'hide-request', reason: 'dismiss' })
    assert.equal(debug.__objetKeyboardTrace!().at(-1)?.event, 'height')
  } finally {
    if (previousEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previousEnv
    delete debug.__objetKeyboardTrace
  }
})
