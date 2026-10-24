import { useCallback, useEffect, useRef, useState } from 'react'
import Taro, { useDidHide, useDidShow } from '@tarojs/taro'
import { glassOptics } from './glass-optics'
import { createGlassMotion, GlassMotion, GlassTarget } from './glass-motion'

const native = process.env.TARO_ENV === 'weapp'
type GlassVisual = ReturnType<typeof glassOptics> & { moving: boolean }
export function useGlassMotion(position: number, size: { width: number; height: number }) {
  const dimensions = useRef(size)
  dimensions.current = size
  const controller = useRef<ReturnType<typeof createGlassMotion> | null>(null)
  const target = useRef<GlassTarget>({ position, pressed: false })
  const [visual, setVisual] = useState<GlassVisual>(() => ({ ...glassOptics(size.width || 366, size.height, position, 0, 0), moving: false }))
  const setTarget = useCallback((next: GlassTarget) => { target.current = next; controller.current?.setTarget(next) }, [])

  useEffect(() => {
    const element = native ? null : document.getElementById('home-tab-bar')
    const lens = element?.querySelector<HTMLElement>('.tab-bar-lens')
    const rest = element?.querySelector<HTMLElement>('.tab-bar-lens-rest')
    const surface = element?.querySelector<HTMLElement>('.tab-bar-lens-surface')
    const contents = element?.querySelectorAll<HTMLElement>('.tab-item-content')
    const applied = new WeakMap<HTMLElement, Partial<Record<'transform' | 'opacity', string>>>()
    const write = (node: HTMLElement, key: 'transform' | 'opacity', value: string) => {
      const previous = applied.get(node) || {}
      if (previous[key] === value) return
      node.style[key] = value
      previous[key] = value; applied.set(node, previous)
    }
    // H5 leaf properties belong to this driver, never React's render loop.
    // No layout reads, clip paths or width/left writes occur per frame.
    const render = (motion: GlassMotion) => {
      const { width, height } = dimensions.current
      const next = { ...glassOptics(width || 366, height, motion.position, motion.amount, motion.velocity), moving: motion.moving }
      if (native) { setVisual(next); return }
      if (!element || !lens || !rest || !surface) return
      write(lens, 'transform', next.transform)
      write(rest, 'opacity', (1 - next.strength).toFixed(3))
      write(surface, 'opacity', next.strength.toFixed(3))
      contents?.forEach((node, index) => write(node, 'transform', next.items[index].transform))
      const active = String(next.active)
      const moving = String(next.moving)
      if (element.dataset.preview !== active) element.dataset.preview = active
      if (element.dataset.moving !== moving) element.dataset.moving = moving
    }
    const clock = createGlassMotion(target.current.position, {
      now: () => native ? Date.now() : performance.now(),
      request: callback => native ? setTimeout(callback, 1000 / 30) as unknown as number : requestAnimationFrame(callback),
      cancel: handle => { if (native) clearTimeout(handle); else cancelAnimationFrame(handle) },
      render,
    })
    controller.current = clock
    const preference = native ? null : window.matchMedia('(prefers-reduced-motion: reduce), (prefers-reduced-transparency: reduce), (prefers-contrast: more)')
    const changed = () => clock.reduce(preference?.matches ?? false)
    const hide = () => clock.pause()
    const show = () => clock.resume()
    const visibility = () => { if (document.hidden) hide(); else show() }
    preference?.addEventListener('change', changed)
    if (native) { Taro.onAppHide(hide); Taro.onAppShow(show) }
    else document.addEventListener('visibilitychange', visibility)
    changed()
    clock.setTarget(target.current)
    return () => {
      clock.dispose(); controller.current = null
      preference?.removeEventListener('change', changed)
      if (native) { Taro.offAppHide(hide); Taro.offAppShow(show) }
      else document.removeEventListener('visibilitychange', visibility)
    }
  }, [])
  useEffect(() => { controller.current?.refresh() }, [size.width, size.height])
  useDidHide(() => controller.current?.pause())
  useDidShow(() => controller.current?.resume())
  return { visual, setTarget }
}
