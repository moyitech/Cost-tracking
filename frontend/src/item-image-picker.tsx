import { useEffect, useRef, useState } from 'react'
import { Text, View } from '@tarojs/components'
import { Action, choosePictures, ErrorNote, Photo, Sheet } from './components'
import { listImagePresets } from './services'
import type { ImagePreset } from './image-preset-client'
import { albumItemImage, emptyItemImage, hasItemImage, imageTab, itemImage, ItemImage, presetItemImage, presetStyle, presetStyles } from './item-image'
import './item-image-picker.scss'

export function ItemImagePicker({ value, temporaryPictures, onConfirm, onClose }: {
  value: ItemImage; temporaryPictures: boolean; onConfirm: (image: ItemImage) => void; onClose: () => void
}) {
  const [tab, setTab] = useState(() => imageTab(value))
  const [style, setStyle] = useState(() => presetStyle(value.imagePresetId))
  const [pending, setPending] = useState(() => itemImage(value))
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
  const choose = async (source: 'album' | 'camera') => {
    if (lock.current) return
    lock.current = true; setBusy(true); setError('')
    try {
      const [path] = await choosePictures(1, !temporaryPictures, [source])
      if (active.current && path) setPending(albumItemImage(path))
    } catch (e) {
      const message = e instanceof Error ? e.message : typeof e === 'object' && e && 'errMsg' in e ? String(e.errMsg) : String(e)
      if (active.current && !/cancel/i.test(message)) setError('照片未能读取，请检查相册或相机权限后重试')
    } finally { lock.current = false; if (active.current) setBusy(false) }
  }
  const options = catalog.filter(option => option.style === style)
  const selected = hasItemImage(pending)
  return <Sheet title='选择物品图片' closeLabel='取消图片选择' className='image-picker-sheet' nested onClose={onClose}
    footer={<><ErrorNote message={error} /><View className='image-picker-footer'>{hasItemImage(value) && <Action className='text-button danger' disabled={busy} onClick={() => { onConfirm(emptyItemImage()); onClose() }}>移除图片</Action>}{selected && <Photo src={pending.image} fileId={pending.imageFileId} presetId={pending.imagePresetId} />}<Action className='primary' disabled={!selected || busy} onClick={() => { onConfirm(pending); onClose() }}>使用图片</Action></View></>}>
    <View className='image-source-tabs'>
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
    </View>}
  </Sheet>
}
