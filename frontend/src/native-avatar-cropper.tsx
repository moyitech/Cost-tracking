import { useEffect, useRef, useState } from 'react'
import { Image, MovableArea, MovableView, Slider, Text, View } from '@tarojs/components'
import { Action, ErrorNote } from './components'
import { avatarCropRect, initialAvatarCrop, positionedAvatarCrop, zoomAvatarCrop } from './avatar-crop'
import { exportNativeAvatarCrop, NativeAvatarSource, prepareNativeAvatarSource, releaseNativeAvatarSource } from './local-image'
import { useAdaptiveLayout } from './layout'
import './avatar-cropper.scss'

/** Native Taro controls work in desktop WeChat and DevTools without wx.cropImage. */
export function NativeAvatarCropper({ src, subject = '头像', onConfirm, onCancel, onProcessingChange, onLayoutChange }: {
  src: string; subject?: string; onConfirm: (image: string) => void; onCancel: () => void
  onProcessingChange: (busy: boolean) => void; onLayoutChange: () => void
}) {
  const layout = useAdaptiveLayout()
  const edge = Math.max(1, Math.min(320, layout.window.windowWidth - 40))
  const [source, setSource] = useState<NativeAvatarSource | null>(null)
  const [crop, setCrop] = useState(initialAvatarCrop)
  const [error, setError] = useState('')
  const [previewReady, setPreviewReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const active = useRef(true); const lock = useRef(false)
  useEffect(() => {
    active.current = true
    let preview: NativeAvatarSource | null = null
    void prepareNativeAvatarSource(src).then(value => {
      preview = value
      if (active.current) setSource(value)
      else releaseNativeAvatarSource(value)
    }).catch(e => { if (active.current) setError(e instanceof Error ? e.message : '无法读取照片，请取消后重新选择') })
    return () => { active.current = false; if (preview) releaseNativeAvatarSource(preview) }
  }, [src])
  useEffect(() => { onLayoutChange() }, [source, error, edge, onLayoutChange])
  const rect = source ? avatarCropRect(source, crop) : null
  const scale = rect ? edge / rect.side : 1
  const changeZoom = (value: number) => { if (source && !busy) setCrop(current => zoomAvatarCrop(source, current, value / 100)) }
  const confirm = async () => {
    if (!source || !previewReady || lock.current) return
    lock.current = true; setBusy(true); setError(''); onProcessingChange(true)
    try {
      const path = await exportNativeAvatarCrop(source, crop)
      if (active.current) onConfirm(path)
    } catch (e) { if (active.current) setError(e instanceof Error ? e.message : '裁剪失败，请重试') }
    finally { lock.current = false; if (active.current) { setBusy(false); onProcessingChange(false) } }
  }
  return <View className='avatar-cropper native-avatar-cropper'>
    <Text className='avatar-crop-intro'>移动、缩放照片，选好{subject}的位置。</Text>
    <View className='avatar-crop-frame native-avatar-crop-frame' style={{ width: `${edge}px`, height: `${edge}px` }}>
      {source && rect ? <MovableArea className='avatar-crop-movable-area' style={{ width: `${edge}px`, height: `${edge}px` }}>
        <MovableView className='avatar-crop-movable-photo' direction='all' inertia={false} outOfBounds={false} animation={false} disabled={busy}
          x={-rect.x * scale} y={-rect.y * scale} style={{ width: `${source.width * scale}px`, height: `${source.height * scale}px` }}
          onHTouchMove={e => e.stopPropagation()} onVTouchMove={e => e.stopPropagation()}
          onChange={e => { if (!busy && e.detail.source) setCrop(current => positionedAvatarCrop(source, current, e.detail.x, e.detail.y, edge)) }}>
          <Image className='avatar-crop-native-image' src={source.preview} mode='scaleToFill' onLoad={() => setPreviewReady(true)} onError={() => { setPreviewReady(false); setError('无法显示照片，请取消后重新选择') }} />
        </MovableView>
      </MovableArea> : <Text className='avatar-crop-loading'>{error ? '照片暂不可用' : '正在读取照片…'}</Text>}
      <View className='avatar-crop-grid' /><Text className='avatar-crop-ratio'>1:1</Text>
    </View>
    <Text className='avatar-crop-hint'>拖动照片调整位置，使用下方滑杆缩放</Text>
    <View className='avatar-crop-zoom'><Text>缩放</Text><Slider className='avatar-crop-slider native-avatar-crop-slider' ariaLabel='缩放照片' min={100} max={400} step={1} value={Math.round(crop.zoom * 100)} disabled={!source || busy} blockSize={20} activeColor='#0b6b5a' onChanging={e => changeZoom(e.detail.value)} onChange={e => changeZoom(e.detail.value)} /><Text className='avatar-crop-zoom-value'>{Math.round(crop.zoom * 100)}%</Text></View>
    <ErrorNote message={error} />
    <View className='avatar-crop-actions'><Action className='secondary' disabled={busy} onClick={onCancel}>取消裁剪</Action><Action className='primary' disabled={!source || !previewReady} loading={busy} onClick={() => void confirm()}>使用裁剪</Action></View>
  </View>
}
