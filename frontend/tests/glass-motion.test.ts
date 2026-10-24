import test from 'node:test'
import assert from 'node:assert/strict'
import { createGlassMotion, GlassMotion } from '../src/glass-motion'

function harness(fps = 60) {
  let time = 0; let id = 0
  const frames = new Map<number, () => void>()
  const paints: GlassMotion[] = []
  const clock = createGlassMotion(0, {
    now: () => time,
    request: callback => { frames.set(++id, callback); return id },
    cancel: handle => { frames.delete(handle) },
    render: frame => paints.push(frame),
  })
  const tick = () => { time += 1000 / fps; const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback()) }
  const settle = () => { for (let count = 0; frames.size && count < fps * 2; count++) tick(); assert.equal(frames.size, 0, 'the animation must stop at rest') }
  return { clock, tick, settle, frames, paints, last: () => paints.at(-1)! }
}

test('pointer bursts coalesce into one frame and the lens follows the latest sample', () => {
  const h = harness()
  for (let index = 0; index <= 100; index++) h.clock.setTarget({ position: index * .03, pressed: true, tracking: true })
  assert.equal(h.frames.size, 1)
  h.tick()
  assert.equal(h.last().position, 3)
  h.clock.setTarget({ position: .4, pressed: true, tracking: true })
  h.tick()
  assert.equal(h.last().position, .4, 'reversing direction must not wait for a spring')
})

test('holding and releasing stop the clock at 30, 60, 120 and 144 Hz', () => {
  for (const fps of [30, 60, 120, 144]) {
    const h = harness(fps)
    h.clock.setTarget({ position: 2.4, pressed: true, tracking: true })
    h.settle()
    assert.equal(h.last().amount, 1)
    assert.equal(h.last().moving, false)
    const count = h.paints.length
    h.tick()
    assert.equal(h.paints.length, count, 'a stationary held finger does not keep painting')
    h.clock.setTarget({ position: 2, pressed: false })
    h.settle()
    assert.deepEqual(h.last(), { position: 2, amount: 0, velocity: 0, moving: false })
  }
})

test('reduced effects snap immediately without running an invisible animation', () => {
  const h = harness()
  h.clock.setTarget({ position: 3, pressed: true })
  h.tick()
  h.clock.reduce(true)
  assert.equal(h.frames.size, 0)
  assert.deepEqual(h.last(), { position: 3, amount: 0, velocity: 0, moving: false })
  h.clock.setTarget({ position: 1.3, pressed: true, tracking: true })
  assert.equal(h.last().position, 1.3)
  assert.equal(h.frames.size, 0)
})

test('backgrounding stops work and resume clears the pressed appearance', () => {
  const h = harness()
  h.clock.setTarget({ position: 2, pressed: true })
  h.tick(); h.clock.pause()
  const count = h.paints.length
  for (let i = 0; i < 120; i++) h.tick()
  assert.equal(h.paints.length, count)
  assert.equal(h.frames.size, 0)
  h.clock.resume(); h.settle()
  assert.equal(h.last().amount, 0)
  h.clock.setTarget({ position: 0, pressed: true })
  h.clock.dispose(); h.tick()
  assert.equal(h.frames.size, 0)
})

test('mouse feedback is quieter and keyboard selection never inflates the lens', () => {
  const h = harness()
  h.clock.setTarget({ position: 1, pressed: true, intensity: .55 })
  h.settle(); assert.equal(h.last().amount, .55)
  h.clock.setTarget({ position: 2, pressed: false })
  h.settle(); assert.equal(h.last().amount, 0)
  h.clock.setTarget({ position: 3, pressed: false })
  const start = h.paints.length
  h.settle()
  assert.ok(h.paints.slice(start).every(frame => frame.amount === 0))
})
