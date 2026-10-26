import { useCallback, useEffect, useRef, useState } from 'react'
import { Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { Action, choosePictures, ErrorNote, Photo, Sheet } from './components'
import { listImagePresets, mockEnabled } from './services'
import { imageActionCancelled } from './avatar-crop'
import { BrowserAvatarCropper } from './avatar-cropper'
import { NativeAvatarCropper } from './native-avatar-cropper'
import { cropAvatarImage, persistSquarePreview } from './local-image'
import type { ImagePreset } from './image-preset-client'
import { albumItemImage, emptyItemImage, hasItemImage, imageTab, itemImage, ItemImage, presetItemImage, presetStyle, presetStyles } from './item-image'
import './item-image-picker.scss'

export function ItemImagePicker({ value, temporaryPictures, onConfirm, onClose }: {
  value: ItemImage; temporaryPictures: boolean; onConfirm: (image: ItemImage) => void; onClose: () => void
}) {
  const [tab, setTab] = useState(() => imageTab(value))
  const [style, setStyle] = useState(() => presetStyle(value.imagePresetId))
  const [pending, setPending] = useState(() => itemImage(value))
  const [cropped, setCropped] = useState(false)
  const [cropSource, setCropSource] = useState<string | null>(null)
  const [croppingBusy, setCroppingBusy] = useState(false)
  const [, setCropLayout] = useState(0)
  const cropLayoutChanged = useCallback(() => setCropLayout(value => value + 1), [])
  const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const [catalog, setCatalog] = useState<ImagePreset[]>([])
  const [catalogLoading, setCatalogLoading] = useState(true); const [catalogError, setCatalogError] = useState('')
  const active = useRef(true); const lock = useRef(false)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  const loadCatalog = async (force = false) => {
    setCatalogLoading(true); setCatalogError('')
    try {
      const items = await listImagePresets(force)
      if (active.current) { setCatalog(items); const selected = items.find(p => p.id === value.imagePresetId); if (selected) setStyle(selected.style) }
    } catch { if (active.current) setCatalogError('图片暂时无法加载') }
    finally { if (active.current) setCatalogLoading(false) }
  }
  useEffect(() => { void loadCatalog() }, [])
  const finishCrop = (path: string) => {
    setPending(albumItemImage(path)); setCropped(true); setCropSource(null); setCroppingBusy(false); setError('')
  }
  const requestClose = () => {
    if (lock.current || croppingBusy) return
    if (cropSource) setCropSource(null)
    else onClose()
  }
  const choose = async (source: 'album' | 'camera') => {
    if (lock.current) return
    lock.current = true; setBusy(true); setError('')
    try {
      const [path] = await choosePictures(1, false, [source])
      if (!active.current || !path) return
      if (process.env.TARO_ENV === 'weapp') {
        const result = await cropAvatarImage(path)
        if (!active.current) return
        if (result.kind === 'cropped') finishCrop(result.path)
        else if (result.kind === 'fallback') setCropSource(path)
      } else setCropSource(path)
    } catch (e) {
      if (active.current && !imageActionCancelled(e)) setError('照片未能读取，请检查相册或相机权限后重试')
    } finally { lock.current = false; if (active.current) setBusy(false) }
  }
  const confirm = async () => {
    if (lock.current || cropSource || croppingBusy || !hasItemImage(pending)) return
    lock.current = true; setBusy(true); setError('')
    try {
      let image = pending
      if (cropped && !pending.imagePresetId) {
        if (mockEnabled) image = albumItemImage(await persistSquarePreview(pending.image, 'item'))
        else if (process.env.TARO_ENV === 'weapp' && !temporaryPictures) {
          // Persist only the confirmed crop so manual drafts survive an app restart.
          const saved = await Taro.saveFile({ tempFilePath: pending.image })
          if (!('savedFilePath' in saved)) throw new Error('图片保存失败，请重试')
          image = albumItemImage(saved.savedFilePath)
        }
      }
      if (!active.current) return
      onConfirm(image); onClose()
    } catch (e) { if (active.current) setError(e instanceof Error ? e.message : '图片保存失败，请重试') }
    finally { lock.current = false; if (active.current) setBusy(false) }
  }
  const options = catalog.filter(option => option.style === style)
  const selected = hasItemImage(pending)
  return <Sheet title={cropSource ? '裁剪物品图片' : '选择物品图片'} closeLabel={cropSource ? '取消裁剪' : '取消图片选择'} className='image-picker-sheet' nested onClose={requestClose}
    footer={cropSource ? undefined : <><ErrorNote message={error} /><View className='image-picker-footer'>{hasItemImage(value) && <Action className='text-button danger' disabled={busy} onClick={() => { onConfirm(emptyItemImage()); onClose() }}>移除图片</Action>}{selected && <Photo src={pending.image} fileId={pending.imageFileId} presetId={pending.imagePresetId} />}<Action className='primary' disabled={!selected || busy} onClick={() => void confirm()}>使用图片</Action></View></>}>
    {cropSource ? process.env.TARO_ENV === 'weapp'
      ? <NativeAvatarCropper key={cropSource} src={cropSource} subject='物品' onProcessingChange={setCroppingBusy} onLayoutChange={cropLayoutChanged} onCancel={requestClose} onConfirm={finishCrop} />
      : <BrowserAvatarCropper key={cropSource} src={cropSource} subject='物品' onCancel={requestClose} onConfirm={finishCrop} />
      : <><View className='image-source-tabs'>
      <Action className={`image-source-tab ${tab === 'emoji' ? 'selected' : ''}`} label={`Emoji${tab === 'emoji' ? '，已选中' : ''}`} disabled={busy} onClick={() => { setTab('emoji'); setError('') }}>Emoji</Action>
      <Action className={`image-source-tab ${tab === 'album' ? 'selected' : ''}`} label={`相册${tab === 'album' ? '，已选中' : ''}`} disabled={busy} onClick={() => { setTab('album'); setError('') }}>相册</Action>
    </View>
    {tab === 'emoji' ? <View className='image-emoji-panel'>
      <View className='image-style-tabs'>{presetStyles.map(option => <Action key={option.id} className={`image-style-tab ${style === option.id ? 'selected' : ''}`} label={`${option.name}风格${style === option.id ? '，已选中' : ''}`} onClick={() => setStyle(option.id)}>{option.name}</Action>)}</View>
      {catalogLoading && <View className='image-preset-loading' ariaLabel='正在加载图片' />}
      {catalogError && <><ErrorNote message={catalogError} /><Action className='secondary' onClick={() => void loadCatalog(true)}>重试</Action></>}
      <View className='image-preset-grid'>{options.map(option => {
        const checked = pending.imagePresetId === option.id
        return <Action key={option.id} className={`image-preset-option ${checked ? 'selected' : ''}`} label={`${option.name}${checked ? '，已选中' : ''}`} onClick={() => setPending(presetItemImage(option.id))}>
          <View className='image-preset-art'><Photo src='' presetId={option.id} />{checked && <Text className='image-preset-check'>✓</Text>}</View>
        </Action>
      })}</View>
    </View> : <View className='image-album-panel'>
      <View className={`image-album-preview ${!pending.imagePresetId && selected ? 'has-photo' : ''}`}>
        {!pending.imagePresetId && selected ? <Photo src={pending.image} fileId={pending.imageFileId} /> : <View className='image-album-symbol'><View /><View /><View /></View>}
      </View>
      <Action className='primary image-album-action' loading={busy} onClick={() => void choose('album')}>从相册选择</Action>
      <Action className='secondary image-album-action' disabled={busy} onClick={() => void choose('camera')}>拍照</Action>
    </View>}</>}
  </Sheet>
}
