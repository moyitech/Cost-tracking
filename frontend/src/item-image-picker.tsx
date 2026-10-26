import { useCallback, useEffect, useRef, useState } from 'react'
import { Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { Action, choosePictures, ErrorNote, Photo, Sheet, SymbolIcon } from './components'
import { listImagePresets, mockEnabled, subscribeImagePresets } from './services'
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
  const catalogRequest = useRef(0); const catalogInitialized = useRef(false)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  const loadCatalog = async (force = false) => {
    const request = ++catalogRequest.current
    const current = () => active.current && request === catalogRequest.current
    setCatalogLoading(true); setCatalogError('')
    try {
      const items = await listImagePresets(force)
      if (current()) {
        setCatalog(items)
        if (!catalogInitialized.current) { const selected = items.find(p => p.id === value.imagePresetId); if (selected) setStyle(selected.style); catalogInitialized.current = true }
      }
    } catch { if (current()) setCatalogError('图片暂时无法加载') }
    finally { if (current()) setCatalogLoading(false) }
  }
  useEffect(() => { void loadCatalog(); return subscribeImagePresets(() => { void loadCatalog() }) }, [])
  const finishCrop = (path: string) => {
    setPending(albumItemImage(path)); setCropped(true); setCropSource(null); setCroppingBusy(false); setError('')
  }
  const requestClose = () => {
    if (lock.current || croppingBusy) return
    if (cropSource) setCropSource(null)
    else onClose()
  }
  const choose = async () => {
    if (lock.current) return
    lock.current = true; setBusy(true); setError('')
    try {
      // Let WeChat present its own album/camera source menu.
      const [path] = await choosePictures(1, false)
      if (!active.current || !path) return
      if (process.env.TARO_ENV === 'weapp') {
        const result = await cropAvatarImage(path)
        if (!active.current) return
        if (result.kind === 'cropped') finishCrop(result.path)
        else if (result.kind === 'fallback') setCropSource(path)
      } else setCropSource(path)
    } catch (e) {
      if (active.current && !imageActionCancelled(e)) setError(e instanceof Error ? e.message : '照片未能读取，请检查相册或相机权限后重试')
    } finally { lock.current = false; if (active.current) setBusy(false) }
  }
  const confirm = async () => {
    if (lock.current || cropSource || croppingBusy || (!hasItemImage(pending) && !hasItemImage(value))) return
    lock.current = true; setBusy(true); setError('')
    try {
      let image = pending
      if (cropped && pending.image && !pending.imagePresetId) {
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
  const selected = hasItemImage(pending)
  return <Sheet title={cropSource ? '裁剪物品图片' : '物品图片'} closeLabel={cropSource ? '取消裁剪' : '取消图片选择'} className='image-picker-sheet' nested onClose={requestClose}
    renderHeader={cropSource ? undefined : close => <View className='image-picker-heading'>
      <Action className='image-picker-cancel' disabled={busy} onClick={close}>取消</Action>
      <Text className='image-picker-title'>物品图片</Text>
      <Action className='image-picker-done' disabled={busy || (!selected && !hasItemImage(value))} onClick={() => void confirm()}>{busy ? '处理中' : '完成'}</Action>
    </View>}>
    {cropSource ? process.env.TARO_ENV === 'weapp'
      ? <NativeAvatarCropper key={cropSource} src={cropSource} subject='物品' onProcessingChange={setCroppingBusy} onLayoutChange={cropLayoutChanged} onCancel={requestClose} onConfirm={finishCrop} />
      : <BrowserAvatarCropper key={cropSource} src={cropSource} subject='物品' onCancel={requestClose} onConfirm={finishCrop} />
      : <><View className='image-source-tabs'>
      <Action className={`image-source-tab ${tab === 'emoji' ? 'selected' : ''}`} label={`Emoji${tab === 'emoji' ? '，已选中' : ''}`} disabled={busy} onClick={() => { setTab('emoji'); setError('') }}>Emoji</Action>
      <Action className={`image-source-tab ${tab === 'album' ? 'selected' : ''}`} label={`照片${tab === 'album' ? '，已选中' : ''}`} disabled={busy} onClick={() => { setTab('album'); setError('') }}>照片</Action>
    </View>
    <View className='image-picker-panels'>
    <View className={`image-emoji-panel image-picker-panel ${tab !== 'emoji' ? 'image-panel-inactive' : ''}`} aria-hidden={tab !== 'emoji'}>
      <View className='image-style-tabs'>{presetStyles.map(option => <Action key={option.id} className={`image-style-tab ${style === option.id ? 'selected' : ''}`} label={`${option.name}风格${style === option.id ? '，已选中' : ''}`} disabled={busy} onClick={() => setStyle(option.id)}>{option.name}</Action>)}</View>
      {catalogLoading && !catalog.length && <View className='image-preset-loading' ariaLabel='正在加载图片' />}
      {catalogError && <><ErrorNote message={catalogError} /><Action className='secondary' onClick={() => void loadCatalog(true)}>重试</Action></>}
      {/* Keep both grids mounted: toggling styles reuses the decoded images and
          their cached local URLs instead of mounting placeholder Photos again. */}
      <View className='image-preset-pages'>{presetStyles.map(presetStyle => <View key={presetStyle.id} className={`image-preset-grid ${style !== presetStyle.id ? 'image-panel-inactive' : ''}`} aria-hidden={style !== presetStyle.id}>{catalog.filter(option => option.style === presetStyle.id).map(option => {
        const checked = pending.imagePresetId === option.id
        return <Action key={option.id} className={`image-preset-option ${checked ? 'selected' : ''}`} label={`${option.name}${checked ? '，已选中' : ''}`} disabled={busy} onClick={() => setPending(presetItemImage(option.id))}>
          <View className='image-preset-art'><Photo src='' presetId={option.id} />{checked && <Text className='image-preset-check'>✓</Text>}</View>
        </Action>
      })}</View>)}</View>
    </View>
    <View className={`image-album-panel image-picker-panel ${tab !== 'album' ? 'image-panel-inactive' : ''}`} aria-hidden={tab !== 'album'}>
      <View className='image-album-preview'>
        <View className={`image-album-photo ${selected ? 'has-photo' : ''}`}>
          {selected && <Photo src={pending.image} fileId={pending.imageFileId} presetId={pending.imagePresetId} />}
          <Action className='image-album-trigger' label={busy ? '正在处理照片' : selected ? '更换照片' : '添加照片'} disabled={busy} onClick={() => void choose()}>
            <View className='image-album-camera'>{busy ? <View className='action-spinner' /> : <SymbolIcon name='camera' color='#fff' />}</View>
          </Action>
        </View>
      </View>
    </View>
    </View>
    <View className='image-picker-remove-row'><Action className='image-picker-remove' disabled={busy || !selected} onClick={() => { setPending(emptyItemImage()); setCropped(false); setError('') }}>
      <SymbolIcon name='trash' color='#7d8d82' /><Text>移除图片</Text>
    </Action></View>
    <ErrorNote message={error} /></>}
  </Sheet>
}
