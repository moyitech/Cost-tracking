import test from 'node:test'
import assert from 'node:assert/strict'
import { applyCommand } from '../src/commands'
import { ItemInput, Ledger, migrateLedger, validateInput } from '../src/domain'
import { albumItemImage, emptyItemImage, imageTab, presetItemImage, presetStyle } from '../src/item-image'
import { prepareItemInput } from '../src/item-input'
import { createDemoImports, demoInputBody } from '../src/import-demo'
import { reviewDraft, reviewInput } from '../src/import-review'
import { apiItem, ApiItem } from '../src/api-types'

const input = (patch: Partial<ItemInput> = {}): ItemInput => ({ name: '随身物品', image: '', note: '', purchaseAmount: null, purchaseDate: null, attachments: [], ...patch })
const ledger = (): Ledger => ({ version: 1, items: [], spaces: [{ id: 'personal', name: '个人', kind: 'personal', role: 'admin', members: [] }] })

test('preset identity survives a saved draft, item reload and edit; replacing/removing clears old references', () => {
  const draft = JSON.parse(JSON.stringify(input(presetItemImage('emoji-phone-v1'))))
  let data = applyCommand(ledger(), { type: 'create', spaceId: 'personal', input: draft, key: 'new-phone' })
  data = migrateLedger(JSON.parse(JSON.stringify(data)))
  const item = data.items[0]
  assert.equal(item.imagePresetId, 'emoji-phone-v1')
  assert.equal(item.image, '')
  assert.equal(item.imageFileId, undefined)
  assert.equal(imageTab(item), 'emoji')
  assert.equal(presetStyle(item.imagePresetId), 'cartoon')
  data = applyCommand(data, { type: 'edit', id: item.id, revision: item.revision, input: { ...item, ...presetItemImage('realistic-phone-v1') } })
  data = migrateLedger(JSON.parse(JSON.stringify(data)))
  assert.equal(data.items[0].imagePresetId, 'realistic-phone-v1')
  assert.equal(presetStyle(data.items[0].imagePresetId), 'realistic')
  assert.equal(imageTab(data.items[0]), 'emoji')
  data = applyCommand(data, { type: 'edit', id: item.id, revision: data.items[0].revision, input: { ...data.items[0], ...albumItemImage('photo.png', 'file-123') } })
  assert.equal(data.items[0].imagePresetId, undefined)
  assert.equal(data.items[0].imageFileId, 'file-123')
  assert.equal(imageTab(data.items[0]), 'album')
  data = applyCommand(data, { type: 'edit', id: item.id, revision: data.items[0].revision, input: { ...data.items[0], ...presetItemImage('emoji-camera-v1') } })
  assert.equal(data.items[0].imageFileId, undefined)
  assert.equal(data.items[0].image, '')
  data = applyCommand(data, { type: 'edit', id: item.id, revision: data.items[0].revision, input: { ...data.items[0], ...emptyItemImage() } })
  assert.equal(data.items[0].imagePresetId, undefined)
  assert.equal(data.items[0].imageFileId, undefined)
  assert.equal(data.items[0].image, '')
})

test('older album items remain valid; conflicting sources and malformed IDs are rejected', () => {
  assert.doesNotThrow(() => validateInput(input({ image: 'old.png' })))
  assert.doesNotThrow(() => validateInput(input({ imageFileId: 'old-file' })))
  assert.throws(() => validateInput(input({ imagePresetId: '../private/file' })), /重新选择/)
  assert.doesNotThrow(() => validateInput(input({ imagePresetId: 'new-server-preset-v2' })))
  assert.throws(() => validateInput(input({ imagePresetId: 'emoji-phone-v1', image: 'old.png' })), /只能选择一种/)
  assert.throws(() => validateInput(input({ imagePresetId: 'emoji-phone-v1', imageFileId: 'old-file' })), /只能选择一种/)
})

test('real presets only submit their ID; receipt uploads remain independent', async () => {
  const uploads: string[] = []
  for (const id of ['emoji-camera-v1', 'realistic-camera-v1']) {
    const body = await prepareItemInput(input({ ...presetItemImage(id), attachments: [{ name: '凭证', path: 'receipt.png' }] }), async path => { uploads.push(path); return 'receipt-file' })
    assert.equal(body.image_file_id, null)
    assert.equal(body.image_preset_id, id)
    assert.deepEqual(body.attachment_file_ids, ['receipt-file'])
  }
  assert.deepEqual(uploads, ['receipt.png', 'receipt.png'])
  await assert.rejects(() => prepareItemInput(input({ imagePresetId: 'emoji-camera-v1', image: 'album.png' }), async () => { throw new Error('must not upload') }), /只能选择一种/)
  const body = await prepareItemInput(input(presetItemImage('emoji-phone-v1')), async () => { throw new Error('must not upload') })
  assert.equal(body.image_preset_id, 'emoji-phone-v1')
  const mapped = apiItem({ ...body, id: 'id', expenses: [] } as unknown as ApiItem)
  assert.equal(mapped.imagePresetId, 'emoji-phone-v1')
  assert.equal(mapped.image, '')
  assert.equal(mapped.imageFileId, undefined)
  const draft = reviewDraft({ values: body } as Parameters<typeof reviewDraft>[0])
  assert.equal(reviewInput(draft).imagePresetId, 'emoji-phone-v1')
})

test('real album requests reuse file IDs and upload local photos without sending preset metadata', async () => {
  const uploads: [string, string][] = []
  const body = await prepareItemInput(input({ image: 'album.png', attachments: [{ name: '已上传凭证', path: '', fileId: 'receipt-ready' }] }), async (path, purpose) => { uploads.push([path, purpose]); return 'uploaded-image' })
  assert.deepEqual(uploads, [['album.png', 'item_image']])
  assert.equal(body.image_file_id, 'uploaded-image')
  assert.equal(body.image_preset_id, null)
  assert.deepEqual(body.attachment_file_ids, ['receipt-ready'])
  assert.equal('imagePresetId' in body, false)
  const existing = await prepareItemInput(input({ image: 'signed-url', imageFileId: 'ready-image' }), async () => { throw new Error('must not upload') })
  assert.equal(existing.image_file_id, 'ready-image')
})

test('mock import preserves the preset through review, refresh, commit and duplicate-save recovery', async () => {
  let data = ledger()
  const client = createDemoImports(() => data, async command => { data = applyCommand(data, command); return data })
  const originalNow = Date.now; let now = originalNow(); Date.now = () => now
  try {
    let task = await client.create('personal', ['source.png'], 'batch')
    now += 2000; task = await client.get(task.id)
    const entry = task.entries[0]
    const draft = { ...reviewDraft(entry), ...presetItemImage('realistic-camera-v1') }
    const values = await demoInputBody(reviewInput(draft))
    assert.equal(values.image_file_id, null)
    const updated = await client.patch(task.id, entry.id, entry.revision, { values, confirmed: true })
    const reloaded = (await client.get(task.id)).entries[0]
    assert.equal(reviewInput(reviewDraft(reloaded)).imagePresetId, 'realistic-camera-v1')
    const rows = [{ entry_id: updated.id, revision: updated.revision }]
    const first = await client.commit(task.id, rows, 'save')
    const retry = await client.commit(task.id, rows, 'save')
    assert.equal(first.results[0].item_id, retry.results[0].item_id)
    assert.equal(data.items.length, 1)
    assert.equal(data.items[0].imagePresetId, 'realistic-camera-v1')
    assert.equal(data.items[0].imageFileId, undefined)
    assert.equal(data.items[0].image, '')
  } finally { Date.now = originalNow }
})

test('switching a mock import from a preset to an album explicitly clears its previous ID', async () => {
  const values = await demoInputBody(input({ ...presetItemImage('emoji-phone-v1'), ...albumItemImage('album.png') }))
  assert.equal(values.image_preset_id, null)
  assert.equal(values.image_file_id, 'album.png')
})
