import { useCallback, useEffect, useRef, useState } from 'react'
import Taro from '@tarojs/taro'
import { revealScrollTop, SheetScrollSession } from './sheet-scroll'
import { traceKeyboard } from './keyboard-trace'

// H5 only: the sheet shrinks above the browser keyboard, so a focused field
// may need scrolling. The mini program never reports keyboardOpen; WeChat
// lifts the page for its native inputs instead.
export function useSheetScroll(id: string, keyboardOpen: boolean, keyboardField: string, viewportHeight: number) {
  const session = useRef(new SheetScrollSession())
  const [revision, setRevision] = useState(0)
  const focus = useCallback((field: string) => {
    if (session.current.focus(field)) setRevision(value => value + 1)
  }, [])
  const blur = useCallback((field: string) => {
    if (session.current.blur(field)) setRevision(value => value + 1)
  }, [])
  const cancelReveal = useCallback(() => session.current.cancel(), [])
  const reset = useCallback(() => {
    session.current.reset()
    setRevision(value => value + 1)
  }, [])

  useEffect(() => () => session.current.reset(), [])
  useEffect(() => { session.current.keyboard(keyboardOpen) }, [keyboardOpen, revision])
  useEffect(() => {
    const request = session.current.request()
    if (!request || request.field !== keyboardField) return
    let active = true
    // Measure after the committed keyboard geometry and content height have
    // reached the view; no timer or scroll event starts another reveal.
    Taro.nextTick(() => {
      if (!active) return
      const viewport = document.getElementById(`${id}-scroll`)
      const field = document.getElementById(request.field)
      if (!viewport || !field || !session.current.consume(request)) return
      const top = revealScrollTop(field.getBoundingClientRect(), viewport.getBoundingClientRect(), viewport.scrollTop)
      if (Math.abs(top - viewport.scrollTop) >= 1) {
        traceKeyboard({ event: 'reveal', owner: id, field: request.field })
        viewport.scrollTop = top
      }
    })
    return () => { active = false }
  }, [id, revision, keyboardOpen, keyboardField, viewportHeight])

  return { focus, blur, cancelReveal, reset }
}
