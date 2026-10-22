import { createContext, CSSProperties, PropsWithChildren, useContext, useEffect, useState } from 'react'
import Taro from '@tarojs/taro'
import { nativeLayout, sheetHeight, WindowMetrics } from './layout-metrics'

const native = process.env.TARO_ENV === 'weapp'
function readWindow(): WindowMetrics {
  if (!native) return { windowWidth: window.innerWidth, windowHeight: window.visualViewport?.height || window.innerHeight, screenHeight: window.innerHeight }
  try { return Taro.getWindowInfo() } catch { return Taro.getSystemInfoSync() }
}
function readLayout() {
  const window = readWindow()
  let menu: ReturnType<typeof Taro.getMenuButtonBoundingClientRect> | undefined
  if (native) { try { menu = Taro.getMenuButtonBoundingClientRect() } catch { /* use system fallback */ } }
  return { window, ...nativeLayout(window, menu) }
}
const LayoutContext = createContext<ReturnType<typeof useLayoutState> | null>(null)
function useLayoutState() {
  const [metrics, setMetrics] = useState(readLayout)
  const [keyboard, setKeyboard] = useState(0)
  const [baseHeight, setBaseHeight] = useState(() => readWindow().windowHeight)
  useEffect(() => {
    const resize = () => { const next = readLayout(); setMetrics(next); if (!native || !keyboard) setBaseHeight(next.window.windowHeight) }
    if (!native) {
      window.addEventListener('resize', resize); window.visualViewport?.addEventListener('resize', resize)
      return () => { window.removeEventListener('resize', resize); window.visualViewport?.removeEventListener('resize', resize) }
    }
    const keyboardChange = (event: { height: number }) => { setKeyboard(event.height); setMetrics(readLayout()) }
    Taro.onWindowResize(resize); Taro.onKeyboardHeightChange(keyboardChange)
    return () => { Taro.offWindowResize(resize); Taro.offKeyboardHeightChange(keyboardChange) }
  }, [keyboard])
  const height = sheetHeight(metrics.window.windowHeight, baseHeight, keyboard)
  // Development-only preview for devices with a bottom gesture inset.
  const previewInset = !native && process.env.NODE_ENV === 'development'
    ? new URLSearchParams(window.location.search).get('previewSafeBottom') : null
  const simulatedInset = previewInset !== null && /^\d+$/.test(previewInset) ? Math.min(60, Number(previewInset)) : null
  const style = {
    '--safe-bottom': native ? `${metrics.safeBottom}px` : simulatedInset !== null ? `${simulatedInset}px` : 'env(safe-area-inset-bottom, 0px)',
    '--sheet-height': `${height}px`,
    ...(native ? { '--header-height': `${metrics.headerHeight}px` } : {}),
  } as CSSProperties
  return { ...metrics, style, compactHeight: metrics.window.windowHeight < 480, keyboardOpen: keyboard > 0 }
}
export function LayoutProvider({ children }: PropsWithChildren) { const value = useLayoutState(); return <LayoutContext.Provider value={value}>{children}</LayoutContext.Provider> }
export function useAdaptiveLayout() { const layout = useContext(LayoutContext); if (!layout) throw new Error('LayoutProvider missing'); return layout }
