import { CSSProperties, memo, useCallback, useEffect, useRef, useState } from 'react'
import { ITouchEvent, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { Action, Icon } from './components'
import { useAdaptiveLayout } from './layout'
import { finishTabGesture, moveTabGesture, startTabGesture, TabBarBounds, TabGesture, TabPoint } from './tab-gesture'
import { glassOptics } from './glass-optics'
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

const TabArtwork = memo(function TabArtwork() {
  return <View className='tab-bar-artwork'>{tabs.map(tab => <View key={tab.id} className='tab-bar-copy-item'><Icon name={tab.icon} /><Text>{tab.label}</Text></View>)}</View>
})

export function GlassTabBar({ value, onChange }: { value: Tab; onChange: (tab: Tab) => void }) {
  const layout = useAdaptiveLayout()
  const gesture = useRef<TabGesture | null>(null)
  const touchSession = useRef<TouchSession | null>(null)
  const suppressClickUntil = useRef(0)
  const [preview, setPreview] = useState<number | null>(null)
  const [pressed, setPressed] = useState<number | null>(null)
  const [size, setSize] = useState({ width: 0, height: 52 })
  const selected = Math.max(0, tabs.findIndex(tab => tab.id === value))
  const position = preview ?? pressed ?? selected
  const motion = useGlassMotion(position, pressed !== null)
  const optics = glassOptics(size.width || 366, size.height, motion.position, motion.amount, motion.velocity)
  const optical = size.width > 14 && (pressed !== null || Math.abs(motion.amount) > .002 || Math.abs(motion.position - position) > .002)
  const rememberSize = useCallback((bounds: TabBarBounds) => {
    setSize(old => old.width === bounds.width && old.height === bounds.height ? old : { width: bounds.width, height: bounds.height })
  }, [])
  const begin = useCallback((bounds: TabBarBounds, point: TabPoint) => {
    rememberSize(bounds)
    gesture.current = startTabGesture(bounds, point)
    setPressed(gesture.current.origin)
  }, [rememberSize])
  const cancel = useCallback(() => {
    gesture.current = null; touchSession.current = null
    suppressClickUntil.current = Date.now() + 400
    setPreview(null); setPressed(null)
  }, [])
  const move = useCallback((point: TabPoint) => {
    if (!gesture.current) return
    const next = moveTabGesture(gesture.current, point)
    gesture.current = next
    setPreview(next.direction === 'horizontal' ? next.position : null)
    if (next.direction === 'cancelled') setPressed(null)
  }, [])
  const finish = useCallback((point: TabPoint) => {
    if (!gesture.current) return
    const result = finishTabGesture(gesture.current, point)
    gesture.current = null; touchSession.current = null
    if (result.suppressClick) suppressClickUntil.current = Date.now() + 400
    setPreview(null); setPressed(null)
    if (result.index !== null) onChange(tabs[result.index].id)
  }, [onChange])

  // H5 uses pointer capture so the lens keeps following outside the original button.
  // Mini programs use the touch adapter below, with coordinates measured by Taro.
  useEffect(() => {
    gesture.current = null; touchSession.current = null; setPreview(null); setPressed(null)
    if (native) {
      let disposed = false
      Taro.nextTick(() => Taro.createSelectorQuery().select('#home-tab-bar').boundingClientRect(rect => {
        const bounds = rect as TabBarBounds | null
        if (!disposed && bounds && bounds.width > 14) rememberSize(bounds)
      }).exec())
      return () => { disposed = true; gesture.current = null; touchSession.current = null }
    }
    const element = document.getElementById('home-tab-bar')
    if (!element) return
    rememberSize(element.getBoundingClientRect())
    let pointer: number | null = null
    const down = (event: PointerEvent) => {
      if (event.button !== 0) return
      if (!event.isPrimary || pointer !== null) { cancel(); return }
      pointer = event.pointerId; suppressClickUntil.current = 0
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
      finish(pointOf(event)); pointer = null
    }
    const interrupted = () => { if (pointer !== null) { cancel(); pointer = null } }
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
    window.addEventListener('blur', interrupted)
    return () => {
      gesture.current = null; touchSession.current = null
      element.removeEventListener('pointerdown', down)
      window.removeEventListener('pointermove', moving)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', interrupted)
      element.removeEventListener('lostpointercapture', lostCapture)
      element.removeEventListener('click', click, true)
      window.removeEventListener('blur', interrupted)
    }
  }, [begin, cancel, finish, move, rememberSize, layout.window.windowWidth, layout.window.windowHeight])

  const touchStart = (event: ITouchEvent) => {
    if (event.touches.length !== 1 || touchSession.current) { cancel(); return }
    const touch = event.touches[0]
    const session: TouchSession = { identifier: touch.identifier, start: pointOf(touch), last: pointOf(touch) }
    touchSession.current = session; suppressClickUntil.current = 0
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
    <View id='home-tab-bar' className={`tab-bar-inner ${preview !== null ? 'is-dragging' : ''} ${optical ? 'is-optical' : ''}`} style={{ '--tab-index': position, '--tab-button-width': `${optics.buttonWidth}px`, '--tab-track-width': `${optics.trackWidth}px`, '--glass-strength': Math.max(0, optics.strength) } as CSSProperties}
      catchMove={native} onTouchStart={native ? event => touchStart(event as ITouchEvent) : undefined} onTouchMove={native ? event => touchMove(event as ITouchEvent) : undefined} onTouchEnd={native ? event => touchEnd(event as ITouchEvent) : undefined} onTouchCancel={native ? cancel : undefined}>
      <View className='tab-bar-selection' />
      <View className='tab-bar-outside' ariaHidden style={{ clipPath: optics.outsideLeft }}><TabArtwork /></View>
      <View className='tab-bar-outside' ariaHidden style={{ clipPath: optics.outsideRight }}><TabArtwork /></View>
      <View className='tab-bar-lens' ariaHidden style={{ left: `${3 + optics.left}px`, top: `${optics.top}px`, width: `${optics.width}px`, height: `${optics.height}px` }}>
        {optics.bands.map((band, index) => <View className='tab-bar-optical-band' key={index} style={{ left: `${band.left}px`, width: `${band.width + .15}px` }}>
          <View className='tab-bar-refracted' style={{ transform: `translate(${band.x}px, ${band.y}px) scale(${band.scaleX}, ${band.scaleY})` }}><TabArtwork /></View>
        </View>)}
        <View className='tab-bar-lens-sheen' />
      </View>
      {tabs.map((tab, index) => <Action key={tab.id} label={`${tab.label}${value === tab.id ? '，当前页面' : ''}`} className={`tab-item ${Math.round(position) === index ? 'selected' : ''}`} onClick={() => {
        if (native && Date.now() < suppressClickUntil.current) return
        onChange(tab.id)
      }}><Icon name={tab.icon} /><Text>{tab.label}</Text></Action>)}
    </View>
  </View>
}
