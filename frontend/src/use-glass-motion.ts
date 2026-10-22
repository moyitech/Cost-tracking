import { useEffect, useRef, useState } from 'react'
import { stepGlassSpring } from './glass-optics'

const native = process.env.TARO_ENV === 'weapp'
export function useGlassMotion(position: number, pressed: boolean) {
  const [motion, setMotion] = useState({ position, amount: 0, velocity: 0 })
  const current = useRef({ x: { value: position, velocity: 0 }, amount: { value: 0, velocity: 0 } })
  const target = useRef({ position, pressed, releaseAt: 0 })
  const wake = useRef<(() => void) | null>(null)
  useEffect(() => {
    const old = target.current
    target.current = { position, pressed, releaseAt: pressed ? 0 : old.pressed || old.position !== position ? Date.now() + 110 : old.releaseAt }
    wake.current?.()
  }, [position, pressed])

  useEffect(() => {
    let frame: number | ReturnType<typeof setTimeout> | null = null
    let previous = Date.now()
    let disposed = false
    const preference = native ? null : window.matchMedia('(prefers-reduced-motion: reduce)')
    const schedule = () => { frame = native ? setTimeout(tick, 1000 / 30) : window.requestAnimationFrame(tick) }
    const tick = () => {
      frame = null
      if (disposed) return
      const now = Date.now()
      const dt = Math.max(1 / 120, Math.min(1 / 30, (now - previous) / 1000))
      previous = now
      const active = target.current.pressed || now < target.current.releaseAt
      const reduced = preference?.matches
      const amountTarget = reduced ? 0 : active ? 1 : 0
      const x = reduced ? { value: target.current.position, velocity: 0 } : stepGlassSpring(current.current.x, target.current.position, dt)
      const amount = reduced ? { value: 0, velocity: 0 } : stepGlassSpring(current.current.amount, amountTarget, dt, 420, 30)
      const settled = Math.abs(x.value - target.current.position) < .0005 && Math.abs(x.velocity) < .008
        && Math.abs(amount.value - amountTarget) < .001 && Math.abs(amount.velocity) < .008
      current.current = settled ? { x: { value: target.current.position, velocity: 0 }, amount: { value: amountTarget, velocity: 0 } } : { x, amount }
      setMotion({ position: current.current.x.value, amount: current.current.amount.value, velocity: current.current.x.velocity })
      if ((!settled && !reduced) || (!target.current.pressed && now < target.current.releaseAt)) schedule()
    }
    wake.current = () => { if (frame === null) { previous = Date.now(); schedule() } }
    const changed = () => wake.current?.()
    preference?.addEventListener('change', changed)
    wake.current()
    return () => {
      disposed = true; wake.current = null
      preference?.removeEventListener('change', changed)
      if (frame !== null) { if (native) clearTimeout(frame); else window.cancelAnimationFrame(frame as number) }
    }
  }, [])
  return motion
}
