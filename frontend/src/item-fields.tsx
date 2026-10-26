import { ReactNode, useState } from 'react'
import { Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { Action, choosePictures, DateField, Field, Photo, SymbolIcon } from './components'
import { ItemInput } from './domain'
import { fileUrl } from './services'
import { ItemImagePicker } from './item-image-picker'
import { albumItemImage, hasItemImage } from './item-image'

// One form layout for both manual entry and AI-prefilled items.
export function ItemFields({ input, amount, date, onInput, onAmount, onDate, onError, disabled = false, spaceControl, temporaryPictures = false, amountPlaceholder = '0.00' }: {
  input: ItemInput; amount: string; date: string; onInput: (patch: Partial<ItemInput>) => void
  onAmount: (value: string) => void; onDate: (value: string) => void; onError: (message: string) => void
  disabled?: boolean; spaceControl?: ReactNode; temporaryPictures?: boolean; amountPlaceholder?: string
}) {
  const [more, setMore] = useState(false)
  const [pickingImage, setPickingImage] = useState(false)
  const addPhoto = async (attachment = false) => {
    try {
      const [path] = await choosePictures(1, !temporaryPictures)
      if (!path) return
      onInput(attachment ? { attachments: [...(input.attachments || []), { name: `凭证 ${(input.attachments?.length || 0) + 1}`, path }] } : albumItemImage(path))
      onError('')
    } catch (e) { if (!String(e).includes('cancel')) onError('图片未能读取，请重试') }
  }
  const preview = async (attachment: NonNullable<ItemInput['attachments']>[number]) => {
    try { const url = attachment.fileId ? await fileUrl(attachment.fileId, true, 'original') : attachment.path; await Taro.previewImage({ urls: [url] }) }
    catch { onError('图片暂时无法打开，请重试') }
  }
  return <>
    <View className='form-section'>
      <Action className='upload-photo' label={hasItemImage(input) ? '更换物品图片' : '添加物品图片'} disabled={disabled} onClick={() => setPickingImage(true)}><Photo src={input.image} fileId={input.imageFileId} presetId={input.imagePresetId} /><View className='photo-edit-badge'><SymbolIcon name='camera' /></View></Action>
      <Field label='商品名' value={input.name} disabled={disabled} onChange={name => onInput({ name })} placeholder='例如：索尼 A7M4 相机' required />
      {spaceControl}
      <View className='form-grid form-purchase'><Field label='价格（元）' value={amount} disabled={disabled} onChange={onAmount} type='digit' placeholder={amountPlaceholder} /><DateField label='购买日期' value={date} disabled={disabled} onChange={onDate} /></View>
    </View>
    <Action className='form-disclosure' expanded={more} label={more ? '收起更多信息' : '展开更多信息'} onClick={() => setMore(!more)}><View><Text className='form-section-title'>更多信息</Text></View><Text className={`disclosure-chevron ${more ? 'expanded' : ''}`}>⌄</Text></Action>
    {more && <View className='form-section form-more'>
      <Field label='备注' value={input.note} disabled={disabled} onChange={note => onInput({ note })} />
      <View className='field'><Text className='field-label'>购买凭证</Text><View className='attachment-list'>{input.attachments?.map((a, index) => <View key={index}><Action onClick={() => void preview(a)}><Photo src={a.path} fileId={a.fileId} /></Action><Action className='text-button danger' disabled={disabled} onClick={() => onInput({ attachments: input.attachments?.filter((_, i) => i !== index) })}>移除</Action></View>)}</View><Action className='secondary' disabled={disabled} onClick={() => void addPhoto(true)}>＋ 添加凭证图片</Action></View>
    </View>}
    {pickingImage && !disabled && <ItemImagePicker value={input} temporaryPictures={temporaryPictures} onClose={() => setPickingImage(false)} onConfirm={image => { onInput(image); onError('') }} />}
  </>
}
