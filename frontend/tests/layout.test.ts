import test from 'node:test'
import assert from 'node:assert/strict'
import { keyboardViewport, nativeLayout, roomForFilterList, sheetHeight, unoccludedWindow, wideLayout } from '../src/layout-metrics'

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

test('full-height sheets leave the native capsule and status area unobstructed', () => {
  const cases = [
    { width: 440, height: 956, status: 59, menuTop: 65 },
    { width: 390, height: 844, status: 47, menuTop: 55 },
    { width: 366, height: 809, status: 24, menuTop: 30 },
    { width: 327, height: 327, status: 0, menuTop: 6 },
    { width: 1024, height: 1366, status: 24, menuTop: 40 },
  ]
  for (const { width, height, status, menuTop } of cases) {
    const menu = { top: menuTop, left: width - 102, width: 88, height: 32 }
    const layout = nativeLayout({ windowWidth: width, windowHeight: height, screenHeight: height, statusBarHeight: status }, menu)
    const sheetTop = height - sheetHeight(height, height, 0, layout.headerHeight)
    assert.ok(sheetTop >= menu.top + menu.height + 8, `capsule overlap at ${width}×${height}`)
    assert.ok(sheetTop >= status)
    assert.ok(height - sheetTop >= 200, 'room remains for fixed header/footer and scrolling content')
  }
  const fallback = nativeLayout({ windowWidth: 390, windowHeight: 844, screenHeight: 844, statusBarHeight: 47 })
  assert.equal(844 - sheetHeight(844, 844, 0, fallback.headerHeight), 99)
})

test('sheet top reservation survives keyboard resizing without counting the keyboard twice', () => {
  assert.equal(sheetHeight(844, 844, 300, 95), 441)
  assert.equal(sheetHeight(544, 844, 300, 95), 441)
  assert.equal(sheetHeight(844, 844, 0, 95), 741)
  assert.equal(sheetHeight(327, 327, 300, 44), 0)
})

test('sheet footer meets the keyboard for overlay, resized and partially resized windows', () => {
  for (const windowHeight of [844, 700, 544]) {
    const viewport = keyboardViewport(windowHeight, 844, 300)
    assert.equal(viewport.visibleHeight, 544)
    assert.equal(windowHeight - viewport.bottom, 544, 'footer stays at keyboard top')
    assert.equal(windowHeight - viewport.bottom - sheetHeight(windowHeight, 844, 300, 95), 103, 'heading stays below the capsule')
  }
  assert.deepEqual(keyboardViewport(844, 844, 0), { visibleHeight: 844, bottom: 0 })
  assert.deepEqual(keyboardViewport(327, 327, 400), { visibleHeight: 0, bottom: 327 })
})

test('resize-before-keyboard and keyboard-before-resize retain the same unoccluded height', () => {
  const initial = { windowWidth: 390, windowHeight: 844, screenHeight: 844 }
  const resized = { ...initial, windowHeight: 544 }
  const base = unoccludedWindow(initial, resized)
  assert.equal(base.windowHeight, 844)
  assert.deepEqual(keyboardViewport(resized.windowHeight, base.windowHeight, 300), { visibleHeight: 544, bottom: 0 })
  assert.deepEqual(keyboardViewport(initial.windowHeight, initial.windowHeight, 300), { visibleHeight: 544, bottom: 300 })
  // Switching keyboards changes height, and dismissal restores the full sheet.
  assert.deepEqual(keyboardViewport(844, base.windowHeight, 360), { visibleHeight: 484, bottom: 360 })
  assert.deepEqual(keyboardViewport(844, unoccludedWindow(base, initial).windowHeight, 0), { visibleHeight: 844, bottom: 0 })
  const rotated = unoccludedWindow(base, { windowWidth: 844, windowHeight: 390, screenHeight: 390 })
  assert.equal(rotated.windowHeight, 390)
})

test('unfolded foldables and tablets get the wide layout; phones keep theirs', () => {
  assert.deepEqual([320, 390, 440, 639].map(windowWidth => wideLayout({ windowWidth }).wide), [false, false, false, false])
  // Galaxy Z Fold portrait, Mate X6 inner, the Pura-series unfolded window in WeChat DevTools, iPad.
  assert.deepEqual([640, 673, 717, 944, 1024].map(windowWidth => wideLayout({ windowWidth }).wide), [true, true, true, true, true])
})

test('the summary column lists its filters only when the window has room', () => {
  // Pura-series unfolded window in WeChat DevTools: 669 tall under a 112px navigation area.
  assert.equal(roomForFilterList(669, 112), true)
  // Mate X6 inner portrait and landscape, iPad portrait.
  assert.deepEqual([[781, 103], [717, 103], [1024, 68]].map(([height, header]) => roomForFilterList(height, header)), [true, true, true])
  // Short PC windows keep the segmented control; a gesture inset counts against the room.
  assert.equal(roomForFilterList(520, 44), false)
  assert.equal(roomForFilterList(669, 112, 34), false)
})
