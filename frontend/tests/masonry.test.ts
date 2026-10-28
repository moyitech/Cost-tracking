import test from 'node:test'
import assert from 'node:assert/strict'
import { distribute, estimateCardHeight, estimateLines, headerLeadingWidth, homeContentWidth, homeLayout, masonryCardWidth, masonryColumns } from '../src/masonry'

test('columns follow the available width, from two up to five', () => {
  const columns = (windowWidth: number) => masonryColumns(homeContentWidth(windowWidth))
  assert.deepEqual([320, 390, 440, 639, 768, 1024, 1440].map(columns), [2, 2, 2, 3, 4, 5, 5])
  assert.equal(homeContentWidth(1440), 928)
  assert.ok(Math.abs(masonryCardWidth(358, 2) - 174) < 0.01)
})
test('wide windows set the waterfall beside a phone-width summary column', () => {
  const home = (windowWidth: number) => { const layout = homeLayout(windowWidth); return [Math.round(layout.sidebarWidth), masonryColumns(layout.gridWidth)] }
  assert.deepEqual(home(390), [0, 2])
  assert.deepEqual(home(639), [0, 3])
  // Unfolded foldables (Galaxy Z Fold, Mate X6 portrait and landscape, Pura X) and tablets.
  assert.deepEqual([640, 673, 717, 781, 944, 1024, 1440].map(home), [[264, 2], [264, 2], [274, 2], [300, 2], [320, 3], [320, 3], [320, 3]])
  assert.equal(homeLayout(944).gridWidth, 944 - 32 - 320 - 20)
  // The bar's brand and switcher end where the summary column does (16px page inset, 12px bar inset).
  assert.equal(headerLeadingWidth(944, true), 16 + 320 - 12)
  assert.equal(headerLeadingWidth(717, true), 16 + 274 - 12)
  // WeChat's bar spans the window while content centres at 960px; the H5 bar centres with it.
  assert.equal(headerLeadingWidth(1024, true), 32 + 16 + 320 - 12)
  assert.equal(headerLeadingWidth(1024, false), 16 + 320 - 12)
  for (const windowWidth of [640, 673, 717, 768, 834, 912, 1024]) {
    const { gridWidth } = homeLayout(windowWidth)
    assert.ok(masonryCardWidth(gridWidth, masonryColumns(gridWidth)) >= 155, `cards stay phone-sized at ${windowWidth}`)
  }
})
test('equal cards fill left to right, uneven cards go to the shortest column', () => {
  const ids = ['a', 'b', 'c', 'd', 'e']
  assert.deepEqual(distribute(ids, 2, () => 100), [['a', 'c', 'e'], ['b', 'd']])
  assert.deepEqual(distribute(ids, 3, () => 100), [['a', 'd'], ['b', 'e'], ['c']])
  const tall = new Set(['a'])
  assert.deepEqual(distribute(ids, 2, id => tall.has(id) ? 300 : 100), [['a', 'e'], ['b', 'c', 'd']])
  assert.deepEqual(distribute([], 2, () => 100), [[], []])
  // A few pixels of difference (a hint line versus a footer) keeps left-to-right order.
  const heights: Record<string, number> = { a: 105, b: 100, c: 100, d: 100 }
  assert.deepEqual(distribute(['a', 'b', 'c', 'd'], 2, id => heights[id]), [['a', 'c'], ['b', 'd']])
})
test('placement is deterministic for the same list', () => {
  const ids = Array.from({ length: 12 }, (_, i) => `item-${i}`)
  const height = (id: string) => 200 + (Number(id.slice(5)) % 3) * 20
  assert.deepEqual(distribute(ids, 2, height), distribute(ids, 2, height))
})
test('name lines count CJK as full width and stop at two', () => {
  assert.equal(estimateLines('示例电脑', 150, 14), 1)
  assert.equal(estimateLines('三星Galaxy Tab S9 FE+平板电脑 8GB+128GB', 150, 14), 2)
  assert.equal(estimateLines('OSMO Mobile 8', 150, 14), 1)
  assert.equal(estimateLines('', 150, 14), 1)
})
test('a two-line name or a completion hint makes a taller card', () => {
  const short = estimateCardHeight({ name: '示例电脑', hint: '' }, 174)
  const long = estimateCardHeight({ name: '三星Galaxy Tab S9 FE+平板电脑 8GB+128GB', hint: '' }, 174)
  const missing = estimateCardHeight({ name: '示例电脑', hint: '补充价格和购买日期 ›' }, 174)
  assert.equal(long - short, 20)
  assert.ok(missing !== short)
  assert.equal(short, 174 + 10 + 20 + 6 + 22 + 12)
})
