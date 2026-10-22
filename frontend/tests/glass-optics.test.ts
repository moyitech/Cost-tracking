import test from 'node:test'
import assert from 'node:assert/strict'
import { glassOptics, stepGlassSpring } from '../src/glass-optics'

const near = (actual: number, expected: number, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} ≈ ${expected}`)

test('springs settle after selection, reversal and release at both renderer frame rates', () => {
  for (const fps of [30, 60]) {
    let position = { value: 0, velocity: 0 }
    let press = { value: 0, velocity: 0 }
    for (const target of [3, 1, 0]) {
      for (let frame = 0; frame < fps; frame++) {
        position = stepGlassSpring(position, target, 1 / fps)
        press = stepGlassSpring(press, target ? 1 : 0, 1 / fps, 420, 30)
      }
      near(position.value, target, .001)
      near(position.velocity, 0, .008)
      near(press.value, target ? 1 : 0, .001)
    }
  }
})

test('delayed frames cannot make the spring explode or carry stale velocity forever', () => {
  let state = { value: 1.5, velocity: 25 }
  for (let frame = 0; frame < 100; frame++) {
    state = stepGlassSpring(state, 0, frame % 4 === 0 ? 2 : 1 / 60)
    assert.ok(Number.isFinite(state.value) && Number.isFinite(state.velocity))
    assert.ok(state.value > -1 && state.value < 4)
  }
  near(state.value, 0, .001)
  near(state.velocity, 0, .008)
})

test('resting optical samples reproduce the original artwork without distortion', () => {
  for (const width of [296, 303, 366, 520]) {
    for (const position of [0, .5, 3]) {
      const glass = glassOptics(width, 52, position, 0, 0)
      for (const band of glass.bands) {
        near(band.scaleX, 1)
        near(band.scaleY, 1)
        near(band.sourceLeft, glass.left + band.left)
      }
    }
  }
})

test('pressed glass magnifies the center and compresses the edge without skipping source pixels', () => {
  for (const position of [0, .7, 1.5, 3]) {
    const glass = glassOptics(366, 52, position, 1, 4)
    assert.ok(glass.bands[4].scaleX > 1.2)
    assert.ok(glass.bands[0].scaleX < 1)
    near(glass.bands[0].sourceLeft, glass.left)
    near(glass.bands.at(-1)!.sourceRight, glass.left + glass.width)
    for (let index = 1; index < glass.bands.length; index++) {
      const previous = glass.bands[index - 1]
      const current = glass.bands[index]
      near(previous.sourceRight, current.sourceLeft)
      near(previous.left + previous.width, current.left)
      assert.ok(current.sourceRight > current.sourceLeft)
    }
  }
})

test('motion stretches the lens symmetrically and preserves visible viewport and safe-area bounds', () => {
  for (const barWidth of [296, 303, 366, 416, 520]) {
    for (const barHeight of [48, 52]) {
      for (const position of [-.02, 0, 1.5, 3, 3.02]) {
        const slow = glassOptics(barWidth, barHeight, position, 1, 0)
        const fast = glassOptics(barWidth, barHeight, position, 1, 30)
        const reverse = glassOptics(barWidth, barHeight, position, 1, -30)
        assert.ok(fast.width > slow.width)
        near(fast.width, reverse.width)
        // The bar has >=12px viewport gutters and 4px above the safe area.
        assert.ok(12 + 4 + fast.left >= 0)
        assert.ok(4 + fast.left + fast.width <= barWidth + 12)
        assert.ok(1 + fast.top + fast.height <= barHeight + 4)
      }
    }
  }
})

test('outside artwork follows curved lens corners instead of leaving rectangular gaps', () => {
  for (const height of [48, 52]) {
    const glass = glassOptics(366, height, 1.5, 1, 0)
    const middle = glass.cutout[11]
    assert.ok(glass.cutout[0].left > middle.left)
    assert.ok(glass.cutout[0].right < middle.right)
    for (const edge of glass.cutout) {
      assert.ok(edge.left >= 0 && edge.right <= glass.trackWidth)
      assert.ok(edge.left < edge.right)
    }
  }
})
