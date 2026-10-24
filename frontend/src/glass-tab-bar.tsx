import { CSSProperties, useCallback, useEffect, useRef, useState } from 'react'
import { ITouchEvent, Text, View } from '@tarojs/components'
import Taro, { useDidHide } from '@tarojs/taro'
import { Action, Icon } from './components'
import { useAdaptiveLayout } from './layout'
import { finishTabGesture, moveTabGesture, startTabGesture, TabBarBounds, TabGesture, TabPoint } from './tab-gesture'
import { useGlassMotion } from './use-glass-motion'

const tabs = [
  { id: 'items', label: '物品', icon: 'home-container6' },
  { id: 'analysis', label: '分析', icon: 'home-container7' },
  { id: 'records', label: '记录', icon: 'home-container8' },
  { id: 'spaces', label: '空间', icon: 'home-container9' },
] as const
export type Tab = typeof tabs[number]['id']
const native = process.env.TARO_ENV === 'weapp'
const pointOf = (touch: { clientX: number; clientY: number }): TabPoint => ({ x: touch.clientX, y: touch.clientY })
interface TouchSession { identifier: number; start: TabPoint; last: TabPoint; end?: TabPoint }

export function GlassTabBar({ value, onChange }: { value: Tab; onChange: (tab: Tab) => void }) {
  const layout = useAdaptiveLayout()
  const gesture = useRef<TabGesture | null>(null)
  const touchSession = useRef<TouchSession | null>(null)
  const suppressClickUntil = useRef(0)
  const measuredBounds = useRef<TabBarBounds | null>(null)
  const intensity = useRef(1)
  const [size, setSize] = useState({ width: 0, height: 52 })
  const selected = Math.max(0, tabs.findIndex(tab => tab.id === value))
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const { visual, setTarget } = useGlassMotion(selected, size)
  useEffect(() => { if (!gesture.current) setTarget({ position: selected, pressed: false }) }, [selected, setTarget])
  const rememberSize = useCallback((bounds: TabBarBounds) => {
    measuredBounds.current = bounds
    setSize(old => old.width === bounds.width && old.height === bounds.height ? old : { width: bounds.width, height: bounds.height })
  }, [])
  const begin = useCallback((bounds: TabBarBounds, point: TabPoint) => {
    rememberSize(bounds)
    gesture.current = startTabGesture(bounds, point)
    setTarget({ position: gesture.current.origin, pressed: true, intensity: intensity.current })
  }, [rememberSize, setTarget])
  const cancel = useCallback(() => {
    gesture.current = null; touchSession.current = null
    suppressClickUntil.current = Date.now() + 400
    setTarget({ position: selectedRef.current, pressed: false })
  }, [setTarget])
  const move = useCallback((point: TabPoint) => {
    if (!gesture.current) return
    const next = moveTabGesture(gesture.current, point)
    if (next === gesture.current) return
    gesture.current = next
    if (next.direction === 'horizontal') setTarget({ position: next.position, pressed: true, tracking: true, intensity: intensity.current })
    if (next.direction === 'cancelled') setTarget({ position: selectedRef.current, pressed: false })
  }, [setTarget])
  const finish = useCallback((point: TabPoint) => {
    if (!gesture.current) return
    const origin = gesture.current.origin
    const result = finishTabGesture(gesture.current, point)
    gesture.current = null; touchSession.current = null
    if (result.suppressClick) suppressClickUntil.current = Date.now() + 400
    setTarget({ position: result.index ?? (result.suppressClick ? selectedRef.current : origin), pressed: false })
    if (result.index !== null) onChange(tabs[result.index].id)
  }, [onChange, setTarget])
  useDidHide(cancel)

  // H5 uses pointer capture so the lens keeps following outside the original button.
  // Mini programs use the touch adapter below, with coordinates measured by Taro.
  useEffect(() => {
    if (gesture.current || touchSession.current) cancel()
    gesture.current = null; touchSession.current = null; measuredBounds.current = null
    setTarget({ position: selectedRef.current, pressed: false })
    if (native) {
      let disposed = false
      Taro.nextTick(() => Taro.createSelectorQuery().select('#home-tab-bar').boundingClientRect(rect => {
        const bounds = rect as TabBarBounds | null
        if (!disposed && bounds && bounds.width > 14) rememberSize(bounds)
      }).exec())
      return () => { disposed = true; if (gesture.current || touchSession.current) cancel() }
    }
    const element = document.getElementById('home-tab-bar')
    if (!element) return
    rememberSize(element.getBoundingClientRect())
    // Taro's H5 buttons are custom elements; supply the keyboard behavior that
    // a native <button> would otherwise provide automatically.
    const buttons = Array.from(element.querySelectorAll<HTMLElement>('.tab-item'))
    buttons.forEach(button => { button.tabIndex = 0; button.setAttribute('role', 'button') })
    const keydown = (event: KeyboardEvent) => {
      const button = (event.target as HTMLElement).closest<HTMLElement>('.tab-item')
      const index = button ? buttons.indexOf(button) : -1
      if (index < 0) return
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        if (!event.repeat) button!.click()
      } else {
        const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length
          : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
            : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null
        if (next !== null) { event.preventDefault(); buttons[next].focus() }
      }
    }
    let pointer: number | null = null
    const down = (event: PointerEvent) => {
      if (event.button !== 0) return
      if (!event.isPrimary || pointer !== null) { interrupted(); return }
      pointer = event.pointerId; suppressClickUntil.current = 0
      intensity.current = event.pointerType === 'mouse' ? .55 : 1
      begin(element.getBoundingClientRect(), pointOf(event))
    }
    const moving = (event: PointerEvent) => {
      if (event.pointerId !== pointer) return
      if (event.pointerType === 'mouse' && event.buttons === 0) { cancel(); pointer = null; return }
      move(pointOf(event))
      // Capturing on press would retarget an ordinary tap away from its button.
      if (gesture.current?.direction === 'horizontal' && !element.hasPointerCapture(event.pointerId)) element.setPointerCapture(event.pointerId)
    }
    const up = (event: PointerEvent) => {
      if (event.pointerId !== pointer) return
      // A resize event/effect can arrive after pointerup. Reject a release
      // against a different track instead of committing using stale geometry.
      const start = gesture.current?.bounds
      const end = element.getBoundingClientRect()
      if (start && (Math.abs(start.width - end.width) > .5 || Math.abs(start.height - end.height) > .5
        || Math.abs(start.left - end.left) > .5 || Math.abs(start.top - end.top) > .5)) { interrupted(); return }
      finish(pointOf(event)); pointer = null
    }
    const interrupted = () => {
      if (pointer === null) return
      const captured = pointer
      pointer = null; cancel()
      if (element.hasPointerCapture(captured)) element.releasePointerCapture(captured)
    }
    const visibility = () => { if (document.hidden) interrupted() }
    const secondary = (event: PointerEvent) => { if (!event.isPrimary) interrupted() }
    const lostCapture = (event: PointerEvent) => { if (event.target === element) interrupted() }
    const click = (event: MouseEvent) => {
      // Consume only the compatibility click after a drag; keyboard activation stays available.
      if (event.detail > 0 && Date.now() < suppressClickUntil.current) { event.preventDefault(); event.stopImmediatePropagation() }
    }
    element.addEventListener('pointerdown', down)
    window.addEventListener('pointermove', moving)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', interrupted)
    element.addEventListener('lostpointercapture', lostCapture)
    element.addEventListener('click', click, true)
    element.addEventListener('keydown', keydown)
    window.addEventListener('blur', interrupted)
    window.addEventListener('resize', interrupted)
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('pointerdown', secondary)
    return () => {
      interrupted()
      gesture.current = null; touchSession.current = null
      element.removeEventListener('pointerdown', down)
      window.removeEventListener('pointermove', moving)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', interrupted)
      element.removeEventListener('lostpointercapture', lostCapture)
      element.removeEventListener('click', click, true)
      element.removeEventListener('keydown', keydown)
      window.removeEventListener('blur', interrupted)
      window.removeEventListener('resize', interrupted)
      document.removeEventListener('visibilitychange', visibility)
      window.removeEventListener('pointerdown', secondary)
    }
  }, [begin, cancel, finish, move, rememberSize, setTarget, layout.window.windowWidth, layout.window.windowHeight])

  const touchStart = (event: ITouchEvent) => {
    if (event.touches.length !== 1 || touchSession.current) { cancel(); return }
    const touch = event.touches[0]
    const session: TouchSession = { identifier: touch.identifier, start: pointOf(touch), last: pointOf(touch) }
    touchSession.current = session; suppressClickUntil.current = 0; intensity.current = 1
    // Reuse the layout measurement: starting a native press must not wait for
    // another asynchronous selector-query round trip across the view bridge.
    if (measuredBounds.current) { begin(measuredBounds.current, session.start); return }
    Taro.createSelectorQuery().select('#home-tab-bar').boundingClientRect(rect => {
      if (touchSession.current !== session) return
      const bounds = rect as TabBarBounds | null
      if (!bounds || bounds.width <= 14) { cancel(); return }
      begin(bounds, session.start)
      move(session.last)
      if (session.end) finish(session.end)
    }).exec()
  }
  const touchMove = (event: ITouchEvent) => {
    const session = touchSession.current
    if (!session) return
    const touch = event.touches.find(t => t.identifier === session.identifier)
    if (event.touches.length !== 1 || !touch) { cancel(); return }
    session.last = pointOf(touch)
    move(session.last)
  }
  const touchEnd = (event: ITouchEvent) => {
    const session = touchSession.current
    if (!session) return
    const touch = event.changedTouches.find(t => t.identifier === session.identifier)
    if (event.touches.length || !touch) { cancel(); return }
    session.end = pointOf(touch)
    if (gesture.current) finish(session.end)
    else if (Math.max(Math.abs(session.end.x - session.start.x), Math.abs(session.end.y - session.start.y)) >= 8) {
      // Preserve a fast drag until the asynchronous native measurement returns.
      suppressClickUntil.current = Date.now() + 400
    } else touchSession.current = null
  }
  return <View className='tab-bar'>
    <View id='home-tab-bar' className='tab-bar-inner' data-preview={native ? visual.active : selected} data-moving={native ? String(visual.moving) : undefined}
      style={{ '--tab-index': selected } as CSSProperties}
      catchMove={native} onTouchStart={native ? event => touchStart(event as ITouchEvent) : undefined} onTouchMove={native ? event => touchMove(event as ITouchEvent) : undefined} onTouchEnd={native ? event => touchEnd(event as ITouchEvent) : undefined} onTouchCancel={native ? cancel : undefined}>
      <View className='tab-bar-lens' ariaHidden style={native ? { transform: visual.transform } : undefined}>
        <View className='tab-bar-lens-rest' style={native ? { opacity: 1 - visual.strength } : undefined} />
        <View className='tab-bar-lens-surface' style={native ? { opacity: visual.strength } : undefined} />
      </View>
      {tabs.map((tab, index) => <Action key={tab.id} label={`${tab.label}${value === tab.id ? '，当前页面' : ''}`} className={`tab-item tab-item-${index}`} onClick={() => {
        if (native && Date.now() < suppressClickUntil.current) return
        setTarget({ position: index, pressed: false })
        onChange(tab.id)
      }}><View className='tab-item-content' style={native ? { transform: visual.items[index].transform } : undefined}><Icon name={tab.icon} /><Text>{tab.label}</Text></View></Action>)}
    </View>
  </View>
}
