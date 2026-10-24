import { stepGlassSpring } from './glass-optics'

export interface GlassMotion { position: number; amount: number; velocity: number; moving: boolean }
export interface GlassTarget { position: number; pressed: boolean; tracking?: boolean; intensity?: number }
interface MotionDriver {
  now: () => number
  request: (callback: () => void) => number
  cancel: (handle: number) => void
  render: (motion: GlassMotion) => void
}

// A single, demand-driven clock. Pointer samples update the target, not React.
// The driver also makes the native 30 Hz bridge and the H5 rAF path testable.
export function createGlassMotion(position: number, driver: MotionDriver) {
  let target: GlassTarget = { position, pressed: false }
  let x = { value: position, velocity: 0 }
  let press = { value: 0, velocity: 0 }
  let frame: number | null = null
  let previous = driver.now()
  let reduced = false
  let paused = false
  let disposed = false
  const stop = () => { if (frame !== null) driver.cancel(frame); frame = null }
  const paint = (moving: boolean) => driver.render({ position: x.value, amount: press.value, velocity: x.velocity, moving })
  const snap = () => { x = { value: target.position, velocity: 0 }; press = { value: 0, velocity: 0 }; paint(false) }
  const wake = () => {
    if (disposed || paused || frame !== null) return
    previous = driver.now()
    frame = driver.request(tick)
  }
  function tick() {
    frame = null
    if (disposed || paused) return
    if (reduced) { snap(); return }
    const now = driver.now()
    // Never accelerate 120/144 Hz displays to a synthetic minimum frame time.
    const dt = Math.max(.001, Math.min(1 / 30, (now - previous) / 1000))
    previous = now
    const amount = target.pressed ? target.intensity ?? 1 : 0
    if (target.tracking) {
      // Follow the finger directly; smooth velocity, not position. Springs only
      // settle the lens after release, so fast reversals don't trail the touch.
      const velocity = (target.position - x.value) / dt
      x = { value: target.position, velocity: x.velocity + (velocity - x.velocity) * (1 - Math.exp(-dt * 24)) }
    } else x = stepGlassSpring(x, target.position, dt, 780, 48)
    press = stepGlassSpring(press, amount, dt, 560, 40)
    const settled = Math.abs(x.value - target.position) < .0005 && Math.abs(x.velocity) < .015
      && Math.abs(press.value - amount) < .001 && Math.abs(press.velocity) < .015
    if (settled) { x = { value: target.position, velocity: 0 }; press = { value: amount, velocity: 0 } }
    paint(!settled)
    if (!settled) frame = driver.request(tick)
  }
  return {
    setTarget(next: GlassTarget) {
      target = { ...next, position: Math.max(0, Math.min(3, next.position)) }
      if (reduced && !paused && !disposed) { stop(); snap() } else wake()
    },
    refresh: wake,
    reduce(value: boolean) { reduced = value; if (value) { stop(); if (!paused && !disposed) snap() } else wake() },
    pause() { paused = true; stop(); target = { position: target.position, pressed: false }; x.velocity = 0; press = { value: 0, velocity: 0 } },
    resume() { if (!paused || disposed) return; paused = false; wake() },
    dispose() { disposed = true; stop() },
  }
}
