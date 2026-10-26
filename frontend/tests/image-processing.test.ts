import test from 'node:test'
import assert from 'node:assert/strict'
import { AVATAR_IMAGE_OPTIONS, createImageQueue, IMAGE_MAX_BYTES, imageDimensions, imageMime, isAvatarPurpose, isLongScreenshot, processImage, squareImageProcessing } from '../src/image-processing'

function file(mime: 'webp' | 'jpeg' | 'png', size = 100) {
  const bytes = new Uint8Array(size)
  if (mime === 'webp') bytes.set(Array.from('RIFF1234WEBPVP8 ', c => c.charCodeAt(0)))
  if (mime === 'jpeg') bytes.set([255, 216, 255])
  if (mime === 'png') bytes.set([137, 80, 78, 71, 13, 10, 26, 10])
  return bytes.buffer
}

test('preserves small dimensions; fits oversized images into the edge and phone memory limits', () => {
  assert.deepEqual(imageDimensions({ width: 640, height: 480 }), { width: 640, height: 480 })
  assert.deepEqual(imageDimensions({ width: 1080, height: 12000 }), { width: 737, height: 8192 })
  assert.deepEqual(imageDimensions({ width: 12000, height: 1080 }), { width: 8192, height: 737 })
  assert.deepEqual(imageDimensions({ width: 8192, height: 8192 }), { width: 4096, height: 4096 })
  assert.deepEqual(imageDimensions({ width: 1, height: 16000 }), { width: 1, height: 8192 })
  for (const width of [0, -1, NaN, Infinity]) assert.throws(() => imageDimensions({ width, height: 10 }), /尺寸/)
  assert.equal(isLongScreenshot({ width: 1080, height: 4000 }), true)
  assert.equal(isLongScreenshot({ width: 4000, height: 1080 }), false)
})

test('encodes small images as WebP without upscaling and accepts exactly 2 MiB', async () => {
  const calls: unknown[] = []
  const result = await processImage({ width: 640, height: 480 }, async (size, mime, quality) => {
    calls.push([size, mime, quality]); return file('webp', IMAGE_MAX_BYTES)
  })
  assert.deepEqual(calls, [[{ width: 640, height: 480 }, 'image/webp', .85]])
  assert.equal(result.mime, 'image/webp'); assert.equal(result.bytes.byteLength, IMAGE_MAX_BYTES)
})

test('unsupported WebP throws or silently returns PNG: both switch to actual JPEG', async () => {
  for (const silent of [true, false]) {
    const formats: string[] = []
    const result = await processImage({ width: 1080, height: 1920 }, async (_, mime) => {
      formats.push(mime)
      if (mime === 'image/webp') { if (silent) return file('png'); throw new Error('unsupported') }
      return file('jpeg')
    })
    assert.equal(result.mime, 'image/jpeg')
    assert.deepEqual(formats, ['image/webp', 'image/jpeg'])
  }
})

test('tries quality before resizing; never returns a file over the size limit', async () => {
  const calls: [number, number, string, number][] = []
  const result = await processImage({ width: 2000, height: 1000 }, async (size, mime, quality) => {
    calls.push([size.width, size.height, mime, quality])
    return file('webp', size.width > 1600 ? IMAGE_MAX_BYTES + 1 : 1024)
  })
  assert.deepEqual(calls, [[2000, 1000, 'image/webp', .85], [2000, 1000, 'image/webp', .75], [2000, 1000, 'image/webp', .65], [1600, 800, 'image/webp', .85]])
  assert.deepEqual([result.width, result.height], [1600, 800])
})

test('does not keep probing unsupported WebP during JPEG quality reduction', async () => {
  let webpCalls = 0
  const result = await processImage({ width: 1200, height: 800 }, async (_, mime, quality) => {
    if (mime === 'image/webp') { webpCalls++; return file('png') }
    return file('jpeg', quality > .65 ? IMAGE_MAX_BYTES + 1 : 1234)
  })
  assert.equal(webpCalls, 1); assert.equal(result.mime, 'image/jpeg')
})

test('invalid encoder output or failed JPEG encoding cannot be uploaded', async () => {
  await assert.rejects(() => processImage({ width: 1000, height: 1000 }, async () => new ArrayBuffer(0)), /格式/)
  await assert.rejects(() => processImage({ width: 1000, height: 1000 }, async () => file('png')), /转换/)
  await assert.rejects(() => processImage({ width: 1000, height: 1000 }, async () => { throw new Error('decode failure') }), /decode failure/)
  assert.throws(() => imageMime(new Uint8Array([82, 73, 70, 70]).buffer), /格式/)
})

test('stops compression at a bounded resolution and asks for crop/segmented screenshots', async () => {
  let calls = 0
  await assert.rejects(() => processImage({ width: 1000, height: 1000 }, async () => { calls++; return file('webp', IMAGE_MAX_BYTES + 1) }), /裁剪图片或分段截图/)
  assert.equal(calls, 12)
})

test('shared canvas work is serial and a failed image does not block the next one', async () => {
  const enqueue = createImageQueue(); const events: string[] = []
  let release!: () => void
  const first = enqueue(async () => { events.push('first'); await new Promise<void>(resolve => { release = resolve }); throw new Error('bad image') })
  const rejected = assert.rejects(first, /bad image/)
  const second = enqueue(async () => { events.push('second'); return 'processed' })
  await Promise.resolve(); assert.deepEqual(events, ['first']); release()
  await rejected; assert.equal(await second, 'processed'); assert.deepEqual(events, ['first', 'second'])
})

test('avatar processing caps output at 512 square and 256 KiB without enlarging small images', async () => {
  for (const edge of [4000, 512, 120]) {
    const result = await processImage({ width: edge, height: edge }, async (size, mime, quality) => {
      assert.deepEqual(size, { width: Math.min(edge, 512), height: Math.min(edge, 512) })
      assert.equal(quality, .85)
      return file('webp', 256 * 1024)
    }, AVATAR_IMAGE_OPTIONS)
    assert.equal(result.width, Math.min(edge, 512))
    assert.equal(result.bytes.byteLength, 256 * 1024)
  }
})

test('an uncropped avatar is rejected before the encoder is called', async () => {
  let called = false
  await assert.rejects(() => processImage({ width: 1600, height: 900 }, async () => { called = true; return file('webp') }, AVATAR_IMAGE_OPTIONS), /正方形/)
  assert.equal(called, false)
})

test('avatar fallback uses real JPEG bytes and may shrink below 512 to meet its own limit', async () => {
  const calls: [number, string, number][] = []
  const result = await processImage({ width: 2000, height: 2000 }, async (size, mime, quality) => {
    calls.push([size.width, mime, quality])
    if (mime === 'image/webp') return file('png')
    return file('jpeg', size.width > 409 ? 256 * 1024 + 1 : 1024)
  }, AVATAR_IMAGE_OPTIONS)
  assert.equal(result.mime, 'image/jpeg')
  assert.deepEqual([result.width, result.height], [409, 409])
  assert.deepEqual(calls, [[512, 'image/webp', .85], [512, 'image/jpeg', .85], [512, 'image/jpeg', .75], [512, 'image/jpeg', .65], [409, 'image/jpeg', .85]])
  assert.equal(isAvatarPurpose('personal_avatar'), true)
  assert.equal(isAvatarPurpose('family_avatar'), true)
  assert.equal(isAvatarPurpose('receipt'), false)
})

test('failed avatar compression stays bounded and leaves other image limits unchanged', async () => {
  const edges: number[] = []
  await assert.rejects(() => processImage({ width: 512, height: 512 }, async size => { edges.push(size.width); return file('webp', 256 * 1024 + 1) }, AVATAR_IMAGE_OPTIONS), /图片压缩/)
  assert.ok(Math.min(...edges) >= 128)
  const ordinary = await processImage({ width: 1000, height: 800 }, async () => file('webp', IMAGE_MAX_BYTES))
  assert.deepEqual([ordinary.width, ordinary.height, ordinary.bytes.byteLength], [1000, 800, IMAGE_MAX_BYTES])
})

test('item uploads enforce square crops and avatar compression limits without affecting receipts or screenshots', async () => {
  const policy = squareImageProcessing('item_image')!
  assert.equal(policy.version, 'item-square-v1')
  assert.notEqual(policy.version, squareImageProcessing('personal_avatar')!.version)
  for (const edge of [4000, 128]) {
    const image = await processImage({ width: edge, height: edge }, async (size, mime) => {
      assert.equal(size.width, Math.min(edge, 512))
      return mime === 'image/webp' ? file('png') : file('jpeg', 256 * 1024)
    }, policy.options)
    assert.equal(image.width, image.height)
    assert.equal(image.mime, 'image/jpeg')
    assert.ok(image.bytes.byteLength <= 256 * 1024)
  }
  await assert.rejects(() => processImage({ width: 900, height: 300 }, async () => { throw new Error('uncropped originals must never reach the encoder') }, policy.options), /正方形/)
  for (const purpose of ['receipt', 'import_source']) assert.equal(squareImageProcessing(purpose), undefined)
})
