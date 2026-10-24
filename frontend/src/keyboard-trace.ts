type KeyboardTrace = {
  event: 'mount' | 'unmount' | 'focus' | 'blur' | 'blur-settled' | 'height' | 'global-height' | 'window' | 'layout' | 'reveal' | 'clear' | 'hide-request'
  field?: string; owner?: string; generation?: number; height?: number
  windowHeight?: number; sheetHeight?: number; bottom?: number; accepted?: boolean
  reason?: 'dismiss' | 'close' | 'unmount'
}
const events: (KeyboardTrace & { time: number })[] = []
export function traceKeyboard(entry: KeyboardTrace) {
  if (process.env.NODE_ENV !== 'development') return
  events.push({ ...entry, time: Date.now() })
  if (events.length > 120) events.shift()
}
if (process.env.NODE_ENV === 'development') {
  // Read from the service-context console. Never include values or labels.
  Object.assign(globalThis, { __objetKeyboardTrace: () => events.map(event => ({ ...event })) })
}
