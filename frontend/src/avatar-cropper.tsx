import { useEffect, useId, useRef, useState } from 'react'
import { ErrorNote } from './components'
import { avatarCropRect, initialAvatarCrop, moveAvatarCrop, zoomAvatarCrop } from './avatar-crop'
import type { ImageSize } from './image-processing'
import './avatar-cropper.scss'

/** H5-only counterpart to wx.cropImage; confirm exports pixels, not a CSS mask. */
export function BrowserAvatarCropper({ src, subject = '头像', onConfirm, onCancel }: { src: string; subject?: string; onConfirm: (image: string) => void; onCancel: () => void }) {
  const frame = useRef<HTMLDivElement>(null)
  const image = useRef<HTMLImageElement>(null)
  const drag = useRef<{ id: number; x: number; y: number } | null>(null)
  const [size, setSize] = useState<ImageSize | null>(null)
  const [edge, setEdge] = useState(0)
  const [crop, setCrop] = useState(initialAvatarCrop)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const hint = `crop-hint-${useId().replace(/:/g, '')}`
  useEffect(() => {
    const node = frame.current
    if (!node) return
    const measure = () => setEdge(node.getBoundingClientRect().width)
    measure()
    node.focus({ preventScroll: true })
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  const rect = size ? avatarCropRect(size, crop) : null
  const scale = rect ? edge / rect.side : 1
  const confirm = () => {
    if (!rect || !image.current || busy) return
    setBusy(true); setError('')
    try {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = rect.outputSize
      const context = canvas.getContext('2d')
      if (!context) throw new Error('当前浏览器暂不支持图片裁剪')
      context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height)
      // Natural dimensions already reflect the browser's EXIF orientation handling.
      context.drawImage(image.current, rect.x, rect.y, rect.side, rect.side, 0, 0, canvas.width, canvas.height)
      const result = canvas.toDataURL('image/png')
      canvas.width = canvas.height = 1
      if (!result.startsWith('data:image/png;base64,')) throw new Error('图片裁剪失败，请重新选择')
      onConfirm(result)
    } catch (e) { setError(e instanceof Error ? e.message : '图片裁剪失败，请重新选择'); setBusy(false) }
  }
  return <div className='avatar-cropper' onKeyDown={event => { if (event.key === 'Escape' && !busy) { event.preventDefault(); onCancel() } }}>
    <p className='avatar-crop-intro'>移动、缩放照片，选好{subject}的位置。</p>
    <div ref={frame} className='avatar-crop-frame' role='group' aria-label={`正方形${subject}裁剪区域`} aria-describedby={hint} tabIndex={0}
      onPointerDown={event => {
        if (!size || busy || drag.current || event.button !== 0) return
        event.preventDefault()
        event.currentTarget.focus({ preventScroll: true })
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY }
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={event => {
        const previous = drag.current
        if (!size || !previous || previous.id !== event.pointerId || busy) return
        event.preventDefault()
        const dx = event.clientX - previous.x, dy = event.clientY - previous.y
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY }
        setCrop(current => moveAvatarCrop(size, current, dx, dy, edge))
      }}
      onPointerUp={event => { if (drag.current?.id === event.pointerId) { drag.current = null; event.currentTarget.releasePointerCapture(event.pointerId) } }}
      onPointerCancel={() => { drag.current = null }}
      onLostPointerCapture={() => { drag.current = null }}
      onKeyDown={event => {
        if (!size || busy || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
        event.preventDefault()
        const step = event.shiftKey ? 24 : 6
        const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0
        const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0
        setCrop(current => moveAvatarCrop(size, current, dx, dy, edge))
      }}>
      <img ref={image} src={src} alt='待裁剪照片' draggable={false} className='avatar-crop-photo' style={size && rect && edge ? { width: size.width * scale, height: size.height * scale, left: -rect.x * scale, top: -rect.y * scale } : { visibility: 'hidden' }}
        onLoad={event => { const loaded = event.currentTarget; if (!loaded.naturalWidth || !loaded.naturalHeight) { setError('无法读取图片，请取消后重新选择'); return } setSize({ width: loaded.naturalWidth, height: loaded.naturalHeight }) }}
        onError={() => { setSize(null); setError('无法读取图片，请取消后重新选择') }} />
      {!size && !error && <span className='avatar-crop-loading'>正在读取照片…</span>}
      <span className='avatar-crop-grid' aria-hidden='true' />
      <span className='avatar-crop-ratio' aria-hidden='true'>1:1</span>
    </div>
    <p id={hint} className='avatar-crop-hint'>拖动照片调整位置，也可使用方向键微调</p>
    <label className='avatar-crop-zoom'><span>缩放</span><input className='avatar-crop-slider' type='range' aria-label='缩放照片' min='1' max='4' step='.01' value={crop.zoom} disabled={!size || busy} onChange={event => { if (size) setCrop(current => zoomAvatarCrop(size, current, Number(event.target.value))) }} /><span className='avatar-crop-zoom-value'>{Math.round(crop.zoom * 100)}%</span></label>
    <ErrorNote message={error} />
    <div className='avatar-crop-actions'><button type='button' className='action secondary' disabled={busy} onClick={onCancel}>取消裁剪</button><button type='button' className='action primary' disabled={!size || !!error || busy} onClick={confirm}>{busy ? '正在裁剪…' : '使用裁剪'}</button></div>
  </div>
}
