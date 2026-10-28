import { WIDE_WINDOW } from './layout-metrics'

// Home waterfall. Every card has the same square cover, so only the text
// below it changes height; that is what staggers the columns.
export const MASONRY_GAP = 10
const MIN_CARD_WIDTH = 168
const MAX_CONTENT_WIDTH = 960
const PAGE_PADDING = 32
const SIDEBAR_GAP = 20

export const homeContentWidth = (windowWidth: number) => Math.min(windowWidth, MAX_CONTENT_WIDTH) - PAGE_PADDING
// Wide windows keep the summary, entries and filters in a column beside the
// waterfall. Mirrors .is-wide .home-sidebar in app.scss: 40% of the content, 264–320px.
export function homeLayout(windowWidth: number) {
  const content = homeContentWidth(windowWidth)
  if (windowWidth < WIDE_WINDOW) return { sidebarWidth: 0, gridWidth: content }
  const sidebarWidth = Math.min(320, Math.max(264, content * .4))
  return { sidebarWidth, gridWidth: content - sidebarWidth - SIDEBAR_GAP }
}
// The navigation bar's brand and space switcher span the summary column, so the
// switcher ends where the column does. The bar starts 12px in (.header-inner);
// WeChat's bar spans the whole window while content centres at 960px, and the
// H5 preview centres the bar together with the content.
const HEADER_INSET = 12
export function headerLeadingWidth(windowWidth: number, fullWidthBar: boolean) {
  const offset = fullWidthBar ? Math.max(0, (windowWidth - MAX_CONTENT_WIDTH) / 2) : 0
  return Math.round(offset + PAGE_PADDING / 2 + homeLayout(windowWidth).sidebarWidth - HEADER_INSET)
}
export const masonryColumns = (contentWidth: number) => Math.min(5, Math.max(2, Math.floor((contentWidth + MASONRY_GAP) / (MIN_CARD_WIDTH + MASONRY_GAP))))
export const masonryCardWidth = (contentWidth: number, columns: number) => (contentWidth - MASONRY_GAP * (columns - 1)) / columns

// CJK glyphs are about one em wide; Latin letters and digits about half.
export function estimateLines(text: string, lineWidth: number, fontSize: number, maxLines = 2) {
  const width = Array.from(text).reduce((sum, char) => sum + (/[\u0000-\u00ff]/.test(char) ? .55 : 1) * fontSize, 0)
  return Math.min(maxLines, Math.max(1, Math.ceil(width / Math.max(1, lineWidth))))
}

// Mirrors the .cover-card metrics in app.scss: square cover, 10/11/12px body
// padding, 20px name lines, a 6px gap, and a 22px footer or 17px hint lines.
export function estimateCardHeight(card: { name: string; hint: string }, width: number) {
  const textWidth = width - 22
  const footer = card.hint ? estimateLines(card.hint, textWidth, 12) * 17 : 22
  return width + 10 + estimateLines(card.name, textWidth, 14) * 20 + 6 + footer + 12
}

// A column only a few pixels shorter must not jump the queue: among columns
// within one text line of the shortest, the leftmost wins, keeping reading order.
const SHORTER_BY = 24

// Each card joins the shortest column, or the leftmost one nearly as short.
export function distribute<T>(items: T[], columns: number, height: (item: T) => number): T[][] {
  const result: T[][] = Array.from({ length: columns }, () => [])
  const heights = new Array<number>(columns).fill(0)
  for (const item of items) {
    const lowest = Math.min(...heights)
    const target = heights.findIndex(h => h <= lowest + SHORTER_BY)
    result[target].push(item)
    heights[target] += height(item) + MASONRY_GAP
  }
  return result
}
