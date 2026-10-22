import test from 'node:test'
import assert from 'node:assert/strict'
import { nativeLayout, sheetHeight } from '../src/layout-metrics'

test('native navigation respects status bar, actual capsule and gesture inset', () => {
  const phone = nativeLayout({ windowWidth: 440, windowHeight: 956, screenHeight: 956, statusBarHeight: 59, safeArea: { bottom: 922 } }, { top: 65, left: 338, width: 88, height: 32 })
  assert.deepEqual(phone, { statusTop: 59, navHeight: 44, headerHeight: 103, capsuleRight: 110, safeBottom: 34 })
  const android = nativeLayout({ windowWidth: 366, windowHeight: 809, screenHeight: 809, statusBarHeight: 24, safeArea: { bottom: 809 } }, { top: 30, left: 264, width: 88, height: 32 })
  assert.equal(android.headerHeight, 68); assert.equal(android.safeBottom, 0)
})

test('capsule reservation responds to unfolded width and invalid API fallbacks', () => {
  const tablet = nativeLayout({ windowWidth: 1024, windowHeight: 1366, screenHeight: 1366, statusBarHeight: 24 }, { top: 30, left: 922, width: 88, height: 32 })
  assert.equal(tablet.capsuleRight, 110)
  const fallback = nativeLayout({ windowWidth: 327, windowHeight: 327, screenHeight: 327, statusBarHeight: 0 }, { top: 0, left: 0, width: 0, height: 0 })
  assert.equal(fallback.headerHeight, 44); assert.equal(fallback.capsuleRight, 96)
  const invalid = nativeLayout({ windowWidth: 327, windowHeight: 327, screenHeight: 327 }, { top: 0, left: 320, width: 88, height: 32 })
  assert.equal(invalid.capsuleRight, 96)
})

test('short-screen sheet and keyboard reserve the visible window without double subtraction', () => {
  assert.equal(sheetHeight(327, 327), 319)
  assert.equal(sheetHeight(327, 327, 180), 139)
  assert.equal(sheetHeight(327, 327, 250), 69)
  assert.equal(sheetHeight(844, 844, 300), 536)
  assert.equal(sheetHeight(544, 844, 300), 536)
  assert.equal(sheetHeight(844, 844, 0), 836)
})
