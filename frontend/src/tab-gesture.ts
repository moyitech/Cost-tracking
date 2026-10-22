export interface TabBarBounds { left: number; top: number; width: number; height: number }
export interface TabPoint { x: number; y: number }
export interface TabGesture {
  bounds: TabBarBounds
  start: TabPoint
  origin: number
  position: number
  direction: 'pending' | 'horizontal' | 'cancelled'
}

const clamp = (value: number) => Math.max(0, Math.min(3, value))
// Matches the bar's 1px border, 3px horizontal padding and 2px gaps.
function geometry(bounds: TabBarBounds) {
  const width = (bounds.width - 14) / 4
  return { firstCenter: bounds.left + 4 + width / 2, pitch: width + 2 }
}
export function startTabGesture(bounds: TabBarBounds, point: TabPoint): TabGesture {
  const { firstCenter, pitch } = geometry(bounds)
  const origin = clamp(Math.round((point.x - firstCenter) / pitch))
  return { bounds, start: point, origin, position: origin, direction: 'pending' }
}
export function moveTabGesture(gesture: TabGesture, point: TabPoint): TabGesture {
  if (gesture.direction === 'cancelled') return gesture
  const dx = point.x - gesture.start.x; const dy = point.y - gesture.start.y
  let direction: TabGesture['direction'] = gesture.direction
  if (direction === 'pending') {
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 8) return gesture
    direction = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'cancelled'
  }
  return { ...gesture, direction, position: clamp(gesture.origin + dx / geometry(gesture.bounds).pitch) }
}
export function finishTabGesture(gesture: TabGesture, point: TabPoint) {
  const next = moveTabGesture(gesture, point)
  const { bounds } = next
  const nearBar = point.x >= bounds.left - 24 && point.x <= bounds.left + bounds.width + 24
    && point.y >= bounds.top - 28 && point.y <= bounds.top + bounds.height + 28
  return { index: next.direction === 'horizontal' && nearBar ? Math.round(next.position) : null, suppressClick: next.direction !== 'pending' }
}
