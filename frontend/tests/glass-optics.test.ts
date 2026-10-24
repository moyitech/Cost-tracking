import test from 'node:test'
import assert from 'node:assert/strict'
import { glassOptics, stepGlassSpring } from '../src/glass-optics'

const near = (actual: number, expected: number, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} ≈ ${expected}`)

test('springs settle after selection, reversal and release at both renderer frame rates', () => {
  for (const fps of [30, 60, 120, 144]) {
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

test('resting and fractional selection stay aligned with measured buttons', () => {
  for (const width of [296, 303, 366, 520]) {
    for (const position of [0, .5, 3]) {
      const glass = glassOptics(width, 52, position, 0, 0)
      near(glass.left, 4 + position * ((width - 14) / 4 + 2))
      near(glass.width, (width - 14) / 4)
      near(glass.height, 44)
      for (const item of glass.items) near(item.scale, 1)
    }
  }
})

test('lens magnification stays continuous across tab boundaries with intact glyphs', () => {
  let previous = glassOptics(366, 52, 0, 1, 4)
  for (let position = .01; position <= 3; position += .01) {
    const glass = glassOptics(366, 52, position, 1, 4)
    glass.items.forEach((item, index) => {
      assert.ok(item.scale >= 1 && item.scale <= 1.12)
      assert.ok(Math.abs(item.scale - previous.items[index].scale) < .004)
    })
    previous = glass
  }
  const held = glassOptics(366, 52, 1, 1, 0)
  near(held.items[1].scale, 1.12)
  near(held.items[0].scale, 1)
  near(held.items[2].scale, 1)
})

test('fast lens reversals stay within viewport gutters and above the safe area', () => {
  for (const barWidth of [296, 303, 366, 416, 520]) {
    for (const barHeight of [48, 52]) {
      for (const position of [-.02, 0, 1.5, 3, 3.02]) {
        const slow = glassOptics(barWidth, barHeight, position, 1, 0)
        const fast = glassOptics(barWidth, barHeight, position, 1, 30)
        const reverse = glassOptics(barWidth, barHeight, position, 1, -30)
        assert.ok(fast.width > slow.width)
        near(fast.width, reverse.width)
        assert.ok(12 + fast.left >= 0)
        assert.ok(fast.left + fast.width <= barWidth + 12)
        assert.ok(fast.top + fast.height <= barHeight)
      }
    }
  }
})
