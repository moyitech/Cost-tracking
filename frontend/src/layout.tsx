import { createContext, CSSProperties, PropsWithChildren, useCallback, useContext, useEffect, useRef, useState } from 'react'
import Taro from '@tarojs/taro'
import { keyboardViewport, nativeLayout, sheetHeight, unoccludedWindow, WindowMetrics } from './layout-metrics'
import { stablePixels } from './sheet-scroll'
import { KeyboardSession } from './keyboard-session'
import { traceKeyboard } from './keyboard-trace'

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
  const [state, setState] = useState(() => ({ metrics: readLayout(), field: '', offsetTop: 0 }))
  const { metrics, field, offsetTop } = state
  const baseWindow = useRef(metrics.window)
  const keyboardSession = useRef(new KeyboardSession())
  const refresh = useRef<() => void>(() => {})
  const focusKeyboard = useCallback((owner: string, field: string) => {
    traceKeyboard({ event: 'focus', ...keyboardSession.current.focusInput(owner, field) })
    refresh.current()
  }, [])
  const blurKeyboard = useCallback((field: string) => {
    const generation = keyboardSession.current.blurInput(field)
    traceKeyboard({ event: 'blur', field, generation: generation ?? undefined, accepted: generation !== null })
    if (generation === null) return
    // Give a focus transfer in this render turn a chance to claim the keyboard.
    Taro.nextTick(() => {
      if (keyboardSession.current.finishBlur(generation)) {
        traceKeyboard({ event: 'blur-settled', field, generation, height: 0 })
        refresh.current()
      }
    })
  }, [])
  const clearKeyboard = useCallback((owner: string, reason: 'dismiss' | 'close' | 'unmount') => {
    const accepted = keyboardSession.current.clear(owner)
    traceKeyboard({ event: 'clear', owner, reason, accepted })
    if (accepted) refresh.current()
  }, [])
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    // Window and keyboard events often describe the same frame. Publish a
    // single geometry update, rather than two intermediate sheet positions.
    const flush = () => {
      timer = undefined
      // An iOS embedded input loses its keyboard when the sheet around it is
      // resized or moved. Hold native geometry until the focused input blurs;
      // WeChat lifts the page for the keyboard itself.
      if (native && keyboardSession.current.focus) return
      const next = readLayout()
      baseWindow.current = unoccludedWindow(baseWindow.current, next.window)
      setState(previous => {
        const window = { ...next.window,
          windowHeight: stablePixels(previous.metrics.window.windowHeight, next.window.windowHeight),
          windowWidth: stablePixels(previous.metrics.window.windowWidth, next.window.windowWidth),
        }
        const nextField = native ? '' : keyboardSession.current.focus?.field || ''
        const nextOffset = native ? 0 : stablePixels(previous.offsetTop, globalThis.window.visualViewport?.offsetTop || 0)
        const same = window.windowHeight === previous.metrics.window.windowHeight && window.windowWidth === previous.metrics.window.windowWidth
          && window.screenHeight === previous.metrics.window.screenHeight && next.headerHeight === previous.metrics.headerHeight
          && next.safeBottom === previous.metrics.safeBottom && next.capsuleRight === previous.metrics.capsuleRight
          && next.statusTop === previous.metrics.statusTop && nextField === previous.field && nextOffset === previous.offsetTop
        return same ? previous : { metrics: { ...next, window }, field: nextField, offsetTop: nextOffset }
      })
    }
    const resize = () => { if (timer === undefined) timer = setTimeout(flush, 16) }
    const windowResize = () => { traceKeyboard({ event: 'window', windowHeight: readWindow().windowHeight }); resize() }
    refresh.current = resize
    if (!native) {
      window.addEventListener('resize', windowResize); window.visualViewport?.addEventListener('resize', windowResize); window.visualViewport?.addEventListener('scroll', resize)
      return () => { refresh.current = () => {}; clearTimeout(timer); window.removeEventListener('resize', windowResize); window.visualViewport?.removeEventListener('resize', windowResize); window.visualViewport?.removeEventListener('scroll', resize) }
    }
    // Keep the global event for diagnosis only: it has no input identity and
    // may arrive after blur or after another input has already gained focus.
    const keyboardChange = (event: { height: number }) => { traceKeyboard({ event: 'global-height', height: event.height }) }
    Taro.onWindowResize(windowResize); Taro.onKeyboardHeightChange(keyboardChange)
    return () => { refresh.current = () => {}; clearTimeout(timer); Taro.offWindowResize(windowResize); Taro.offKeyboardHeightChange(keyboardChange) }
  }, [])
  // Only H5 moves sheets above the keyboard. Native sheets keep their geometry
  // and rely on the input's adjust-position page lift.
  const keyboardOpen = !native && !!field && window.innerHeight - metrics.window.windowHeight > 120
  // A blur/close must clear H5 avoidance even if visualViewport's final resize
  // is delayed or missing.
  const windowHeight = !native && !field ? window.innerHeight : metrics.window.windowHeight
  const viewport = keyboardViewport(windowHeight, baseWindow.current.windowHeight, 0)
  const bottom = native ? viewport.bottom : keyboardOpen ? Math.max(0, window.innerHeight - metrics.window.windowHeight - offsetTop) : 0
  const height = sheetHeight(viewport.visibleHeight, viewport.visibleHeight, 0, native ? metrics.headerHeight : 0)
  useEffect(() => {
    traceKeyboard({ event: 'layout', field: keyboardSession.current.focus?.field,
      windowHeight: metrics.window.windowHeight, sheetHeight: height, bottom })
  }, [field, metrics.window.windowHeight, height, bottom])
  // Development-only preview for devices with a bottom gesture inset.
  const previewInset = !native && process.env.NODE_ENV === 'development'
    ? new URLSearchParams(window.location.search).get('previewSafeBottom') : null
  const simulatedInset = previewInset !== null && /^\d+$/.test(previewInset) ? Math.min(60, Number(previewInset)) : null
  const style = {
    '--safe-bottom': native ? `${metrics.safeBottom}px` : simulatedInset !== null ? `${simulatedInset}px` : 'env(safe-area-inset-bottom, 0px)',
    '--sheet-height': native ? `${height}px` : `calc(${height}px - env(safe-area-inset-top, 0px))`,
    '--sheet-safe-bottom': keyboardOpen ? '0px' : 'var(--safe-bottom)',
    ...(native ? { '--header-height': `${metrics.headerHeight}px` } : {}),
  } as CSSProperties
  return { ...metrics, style, sheetHeight: height, sheetBottom: bottom, compactHeight: viewport.visibleHeight < 480, keyboardOpen, keyboardField: field,
    focusKeyboard, blurKeyboard, clearKeyboard }
}
export function LayoutProvider({ children }: PropsWithChildren) { const value = useLayoutState(); return <LayoutContext.Provider value={value}>{children}</LayoutContext.Provider> }
export function useAdaptiveLayout() { const layout = useContext(LayoutContext); if (!layout) throw new Error('LayoutProvider missing'); return layout }
