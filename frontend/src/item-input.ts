import type { ItemInput } from './domain'
import { validateItemImage } from './item-image'

// Presets are shared IDs, never upload sources. Both keys are sent to clear old references.
export async function prepareItemInput(input: ItemInput, upload: (path: string, purpose: 'item_image' | 'receipt') => Promise<string>) {
  validateItemImage(input)
  const image = input.imageFileId || (input.image ? await upload(input.image, 'item_image') : null)
  const attachments: string[] = []
  for (const a of input.attachments || []) attachments.push(a.fileId || await upload(a.path, 'receipt'))
  return { name: input.name, note: input.note || null, purchase_amount_cents: input.purchaseAmount, purchase_date: input.purchaseDate, image_file_id: image, image_preset_id: input.imagePresetId || null, attachment_file_ids: attachments }
}
