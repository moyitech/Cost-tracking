export type WindowMetrics = { windowWidth: number; windowHeight: number; screenHeight: number; statusBarHeight?: number; safeArea?: { bottom: number } }
export type MenuMetrics = { top: number; left: number; width: number; height: number }

export function nativeLayout(window: WindowMetrics, menu?: MenuMetrics) {
  const statusTop = Math.max(0, window.statusBarHeight || 0)
  const validMenu = !!menu && menu.height > 0 && menu.width > 0 && menu.top >= statusTop && menu.left > 0 && menu.left + menu.width <= window.windowWidth
  const navHeight = validMenu ? Math.max(44, (menu!.top - statusTop) * 2 + menu!.height) : 44
  const capsuleRight = validMenu ? window.windowWidth - menu!.left + 8 : 96
  const safeBottom = window.safeArea ? Math.max(0, window.screenHeight - window.safeArea.bottom) : 0
  return { statusTop, navHeight, headerHeight: statusTop + navHeight, capsuleRight, safeBottom }
}

export function sheetHeight(windowHeight: number, baseHeight: number, keyboardHeight = 0) {
  // Some WeChat versions resize the window when the keyboard opens; others don't.
  // Using the smaller visible area avoids subtracting the keyboard twice.
  const visible = keyboardHeight > 0 ? Math.min(windowHeight, baseHeight - keyboardHeight) : windowHeight
  return Math.max(0, visible - 8)
}
