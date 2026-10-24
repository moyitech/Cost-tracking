export const presetStyles = [
  { id: 'cartoon', name: '卡通' },
  { id: 'realistic', name: '实物' },
] as const
export type PresetStyle = typeof presetStyles[number]['id']
const subjects = [
  { key: 'phone', name: '手机' },
  { key: 'tablet', name: '平板' },
  { key: 'laptop', name: '笔记本' },
  { key: 'desktop', name: '台式电脑' },
  { key: 'headphones', name: '头戴耳机' },
  { key: 'earbuds', name: '无线耳机' },
  { key: 'watch', name: '智能手表' },
  { key: 'camera', name: '相机' },
  { key: 'gamepad', name: '游戏手柄' },
  { key: 'speaker', name: '音箱' },
] as const
export type PresetSubject = typeof subjects[number]['key']

// Keep existing cartoon IDs stable so saved items and drafts still resolve.
export const presetOptions = presetStyles.flatMap(style => subjects.map(subject => ({
  ...subject, style: style.id, id: `${style.id === 'cartoon' ? 'emoji' : 'realistic'}-${subject.key}-v1`,
})))
export const presetStyle = (id?: string): PresetStyle => presetOptions.find(preset => preset.id === id)?.style || 'cartoon'

export type ItemImage = { image: string; imageFileId?: string; imagePresetId?: string }
export const emptyItemImage = (): ItemImage => ({ image: '', imageFileId: undefined, imagePresetId: undefined })
export const presetItemImage = (id: string): ItemImage => ({ ...emptyItemImage(), imagePresetId: id })
export const albumItemImage = (image: string, imageFileId?: string): ItemImage => ({ ...emptyItemImage(), image, imageFileId })
export function itemImage(input: ItemImage): ItemImage {
  return input.imagePresetId ? presetItemImage(input.imagePresetId) : albumItemImage(input.image, input.imageFileId)
}
export const hasItemImage = (input: ItemImage) => !!(input.imagePresetId || input.image || input.imageFileId)
export const imageTab = (input: ItemImage): 'emoji' | 'album' => input.imagePresetId || !hasItemImage(input) ? 'emoji' : 'album'
export function validateItemImage(input: ItemImage) {
  if (!input.imagePresetId) return
  if (input.image || input.imageFileId) throw new Error('预设与相册照片只能选择一种')
  // The backend catalog owns availability; new presets do not require a client release.
  if (!/^[a-z][a-z0-9-]{0,79}$/.test(input.imagePresetId)) throw new Error('这张预设暂不可用，请重新选择')
}
