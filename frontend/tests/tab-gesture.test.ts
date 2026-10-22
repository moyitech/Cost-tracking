import test from 'node:test'
import assert from 'node:assert/strict'
import { finishTabGesture, moveTabGesture, startTabGesture } from '../src/tab-gesture'

const bounds = { left: 12, top: 754, width: 366, height: 52 }
const point = (x: number, y = 780) => ({ x, y })

test('tap and small hand movement remain clicks, not page switches', () => {
  const start = startTabGesture(bounds, point(60))
  assert.deepEqual(finishTabGesture(start, point(65, 783)), { index: null, suppressClick: false })
})

test('drag follows fractional position and commits the nearest tab on release', () => {
  const start = startTabGesture(bounds, point(60))
  const half = moveTabGesture(start, point(105))
  assert.equal(half.position, .5)
  assert.deepEqual(finishTabGesture(half, point(150)), { index: 1, suppressClick: true })
  assert.deepEqual(finishTabGesture(half, point(330)), { index: 3, suppressClick: true })
})

test('right-to-left scrubbing and reversing direction select the final target', () => {
  const start = startTabGesture(bounds, point(330))
  const left = moveTabGesture(start, point(60))
  assert.equal(left.position, 0)
  assert.deepEqual(finishTabGesture(left, point(240)), { index: 2, suppressClick: true })
})

test('touch position inside a button does not make the lens jump at drag start', () => {
  const start = startTabGesture(bounds, point(22))
  assert.equal(moveTabGesture(start, point(112)).position, 1)
})

test('vertical intent is cancelled even if the finger later moves horizontally', () => {
  const vertical = moveTabGesture(startTabGesture(bounds, point(60)), point(62, 800))
  assert.deepEqual(finishTabGesture(vertical, point(240)), { index: null, suppressClick: true })
})

test('dragging back to the start still suppresses the synthetic click', () => {
  const moved = moveTabGesture(startTabGesture(bounds, point(60)), point(150))
  assert.deepEqual(finishTabGesture(moved, point(60)), { index: 0, suppressClick: true })
})

test('near-edge drags clamp to valid tabs, far outside releases cancel', () => {
  const start = startTabGesture(bounds, point(60))
  assert.equal(moveTabGesture(start, point(-100)).position, 0)
  assert.equal(moveTabGesture(start, point(500)).position, 3)
  assert.equal(finishTabGesture(start, point(390)).index, 3)
  assert.equal(finishTabGesture(start, point(440)).index, null)
  assert.equal(finishTabGesture(start, point(240, 650)).index, null)
})

test('dragging uses measured button spacing on narrow and wide layouts', () => {
  for (const width of [296, 303, 416, 520]) {
    const bar = { ...bounds, left: 20, width }
    const buttonWidth = (width - 14) / 4
    const first = 24 + buttonWidth / 2
    const last = first + 3 * (buttonWidth + 2)
    assert.equal(finishTabGesture(startTabGesture(bar, point(first)), point(last)).index, 3)
    assert.equal(finishTabGesture(startTabGesture(bar, point(last)), point(first)).index, 0)
  }
})
