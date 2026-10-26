import test from 'node:test'
import assert from 'node:assert/strict'
import { avatarCropRect, chooseAvatarCrop, cropNativeAvatar, hasNativeCropRounding, initialAvatarCrop, moveAvatarCrop, positionedAvatarCrop, supportsNativeAvatarCrop, zoomAvatarCrop } from '../src/avatar-crop'

test('landscape, portrait and square sources select an actual square in original pixels', () => {
  assert.deepEqual(avatarCropRect({ width: 900, height: 300 }, initialAvatarCrop()), { x: 300, y: 0, side: 300, outputSize: 300, zoom: 1 })
  assert.deepEqual(avatarCropRect({ width: 300, height: 900 }, initialAvatarCrop()), { x: 0, y: 300, side: 300, outputSize: 300, zoom: 1 })
  assert.deepEqual(avatarCropRect({ width: 2000, height: 2000 }, initialAvatarCrop()), { x: 0, y: 0, side: 2000, outputSize: 512, zoom: 1 })
})

test('panning cannot expose blank pixels and reversing at an edge reacts immediately', () => {
  const size = { width: 900, height: 300 }
  const atLeft = moveAvatarCrop(size, initialAvatarCrop(), 10000, 10000, 300)
  assert.deepEqual(avatarCropRect(size, atLeft), { x: 0, y: 0, side: 300, outputSize: 300, zoom: 1 })
  const reversed = moveAvatarCrop(size, atLeft, -30, 0, 300)
  assert.ok(Math.abs(avatarCropRect(size, reversed).x - 30) < 1e-8)
  const atRight = moveAvatarCrop(size, reversed, -10000, -10000, 300)
  assert.equal(avatarCropRect(size, atRight).x, 600)
})

test('zoom keeps the selected source center and crop coordinates survive viewport resizing', () => {
  const size = { width: 1000, height: 500 }
  const zoomed = zoomAvatarCrop(size, initialAvatarCrop(), 2)
  const rect = avatarCropRect(size, zoomed)
  assert.deepEqual([rect.x, rect.y, rect.side], [375, 125, 250])
  const wide = moveAvatarCrop(size, zoomed, 80, 40, 320)
  const narrow = moveAvatarCrop(size, zoomed, 40, 20, 160)
  assert.deepEqual(avatarCropRect(size, wide), avatarCropRect(size, narrow))
  assert.equal(avatarCropRect(size, wide).x, 312.5)
})

test('small crops are not upscaled and invalid source/position data is rejected', () => {
  assert.equal(avatarCropRect({ width: 90, height: 50 }, { zoom: 4, centerX: 1, centerY: 1 }).outputSize, 12)
  assert.equal(avatarCropRect({ width: 900, height: 300 }, { zoom: 100, centerX: -5, centerY: 10 }).zoom, 4)
  for (const n of [0, -1, NaN, Infinity]) assert.throws(() => avatarCropRect({ width: n, height: 100 }, initialAvatarCrop()), /尺寸/)
  assert.throws(() => avatarCropRect({ width: 100, height: 100 }, { zoom: NaN, centerX: .5, centerY: .5 }), /位置/)
})

test('native flow fixes 1:1, waits for confirmation, inspects output and never returns the original', async () => {
  const events: string[] = []
  let confirm!: (result: { tempFilePath: string }) => void
  const task = cropNativeAvatar('original.jpg', {
    supported: true,
    crop: async options => { assert.deepEqual(options, { src: 'original.jpg', cropScale: '1:1' }); events.push('crop'); return new Promise(resolve => { confirm = resolve }) },
    inspect: async path => { events.push('inspect:' + path); return { width: 1024, height: 1024 } },
  })
  await Promise.resolve()
  assert.deepEqual(events, ['crop'])
  confirm({ tempFilePath: 'cropped.jpg' })
  assert.equal(await task, 'cropped.jpg')
  assert.deepEqual(events, ['crop', 'inspect:cropped.jpg'])
})

test('cancel and unsupported native cropping do not produce a pending avatar', async () => {
  let inspected = false
  const port = { supported: true, crop: async () => { throw { errMsg: 'cropImage:fail cancel' } }, inspect: async () => { inspected = true; return { width: 100, height: 100 } } }
  assert.equal(await cropNativeAvatar('original', port), null)
  assert.equal(inspected, false)
  await assert.rejects(() => cropNativeAvatar('original', { ...port, supported: false, crop: async () => { throw new Error('must not open') } }), /原生头像裁剪不可用/)
})

test('failed, empty or non-square native results cannot bypass cropping', async () => {
  const port = { supported: true, crop: async () => ({ tempFilePath: 'cropped' }), inspect: async () => ({ width: 100, height: 99 }) }
  await assert.rejects(() => cropNativeAvatar('original', port), /正方形/)
  await assert.rejects(() => cropNativeAvatar('original', { ...port, crop: async () => ({ tempFilePath: '' }) }), /裁剪结果/)
  await assert.rejects(() => cropNativeAvatar('original', { ...port, crop: async () => { throw new Error('unavailable') } }), /未能完成/)
})

test('unsupported and failed native crop routes to in-app cropping, never the original avatar', async () => {
  let called = false
  const port = { supported: true, crop: async () => { called = true; return { tempFilePath: 'cropped' } }, inspect: async () => ({ width: 100, height: 100 }) }
  assert.deepEqual(await chooseAvatarCrop('original', { ...port, supported: false }), { kind: 'fallback' })
  assert.equal(called, false)
  assert.deepEqual(await chooseAvatarCrop('original', { ...port, crop: async () => { throw { errMsg: 'cropImage:fail not supported' } } }), { kind: 'fallback' })
})

test('a successful native crop never opens fallback for an empty, unreadable or non-square result', async () => {
  let cropCalls = 0; let reads = 0
  const port = { supported: true, crop: async () => { cropCalls++; return { tempFilePath: 'confirmed' } }, inspect: async () => ({ width: 100, height: 100 }) }
  await assert.rejects(() => chooseAvatarCrop('original', { ...port, crop: async () => ({ tempFilePath: '' }) }), /裁剪结果/)
  await assert.rejects(() => chooseAvatarCrop('original', { ...port, inspect: async () => ({ width: 100, height: 90 }) }), /正方形/)
  await assert.rejects(() => chooseAvatarCrop('original', { ...port, inspect: async path => { reads++; assert.equal(path, 'confirmed'); throw { errMsg: 'getImageInfo:fail' } } }), /裁剪结果暂时无法读取/)
  assert.equal(cropCalls, 2)
  assert.equal(reads, 3)
})

test('temporary native result read failures retry the confirmed file without another crop', async () => {
  let cropCalls = 0; let reads = 0
  const result = await chooseAvatarCrop('original', {
    supported: true,
    crop: async () => { cropCalls++; return { tempFilePath: 'confirmed' } },
    inspect: async path => { assert.equal(path, 'confirmed'); if (++reads < 3) throw { errMsg: 'getImageInfo:fail' }; return { width: 900, height: 900 } },
    normalize: async () => { throw new Error('square crops need no adjustment') },
  })
  assert.deepEqual(result, { kind: 'cropped', path: 'confirmed' })
  assert.equal(cropCalls, 1)
  assert.equal(reads, 3)
})

test('one-pixel native rounding is corrected only on confirmed pixels and the result stays square', async () => {
  for (const size of [{ width: 1024, height: 1023 }, { width: 1023, height: 1024 }]) {
    const events: string[] = []
    const result = await chooseAvatarCrop('original', {
      supported: true,
      crop: async () => { events.push('crop'); return { tempFilePath: 'confirmed' } },
      inspect: async path => { events.push('inspect:' + path); return path === 'confirmed' ? size : { width: 512, height: 512 } },
      normalize: async (path, dimensions) => {
        events.push('normalize:' + path)
        assert.deepEqual(dimensions, size)
        const rect = avatarCropRect(dimensions, initialAvatarCrop())
        assert.equal(rect.side, 1023)
        assert.equal(rect.outputSize, 512)
        assert.ok(rect.x + rect.y <= 1)
        return 'normalized'
      },
    })
    assert.deepEqual(result, { kind: 'cropped', path: 'normalized' })
    assert.deepEqual(events, ['crop', 'inspect:confirmed', 'normalize:confirmed', 'inspect:normalized'])
  }
  for (const size of [{ width: 100, height: 98 }, { width: 100, height: 100 }, { width: 0, height: 1 }, { width: NaN, height: 100 }, { width: 1.5, height: 2.5 }]) assert.equal(hasNativeCropRounding(size), false)
})

test('normalization failure or malformed output reports an error instead of reopening a cropper', async () => {
  const port = { supported: true, crop: async () => ({ tempFilePath: 'confirmed' }), inspect: async () => ({ width: 100, height: 99 }) }
  await assert.rejects(() => chooseAvatarCrop('original', { ...port, normalize: async () => { throw new Error('canvas failed') } }), /裁剪结果处理失败/)
  await assert.rejects(() => chooseAvatarCrop('original', { ...port, normalize: async () => '' }), /裁剪结果/)
  await assert.rejects(() => chooseAvatarCrop('original', { ...port, normalize: async () => 'still-not-square' }), /正方形/)
})

test('desktop, DevTools and unknown hosts skip a misleading native capability advertisement', () => {
  for (const platform of ['devtools', 'windows', 'mac', 'linux', 'ohos', '']) {
    assert.equal(supportsNativeAvatarCrop(platform, true), false)
  }
  for (const platform of ['ios', 'android']) {
    assert.equal(supportsNativeAvatarCrop(platform, true), true)
    assert.equal(supportsNativeAvatarCrop(platform, false), false)
  }
})

test('native success uses the confirmed crop, user cancellation never opens another cropper', async () => {
  const port = { supported: true, crop: async () => ({ tempFilePath: 'cropped' }), inspect: async () => ({ width: 100, height: 100 }) }
  assert.deepEqual(await chooseAvatarCrop('original', port), { kind: 'cropped', path: 'cropped' })
  for (const error of [{ errMsg: 'cropImage:fail cancel' }, new Error('cropImage:fail user cancel')]) {
    assert.deepEqual(await chooseAvatarCrop('original', { ...port, crop: async () => { throw error } }), { kind: 'cancelled' })
  }
})

test('native movable offsets preserve selected pixels across sizes, zoom, and frame widths', () => {
  for (const size of [{ width: 900, height: 300 }, { width: 300, height: 900 }, { width: 128, height: 128 }]) {
    for (const zoom of [1, 2, 4]) {
      const crop = zoomAvatarCrop(size, { zoom: 1, centerX: .25, centerY: .8 }, zoom)
      const rect = avatarCropRect(size, crop)
      for (const edge of [280, 320, 430]) {
        const scale = edge / rect.side
        const restored = avatarCropRect(size, positionedAvatarCrop(size, crop, -rect.x * scale, -rect.y * scale, edge))
        assert.ok(Math.abs(restored.x - rect.x) < 1e-8)
        assert.ok(Math.abs(restored.y - rect.y) < 1e-8)
        assert.equal(restored.side, rect.side)
        const clamped = avatarCropRect(size, positionedAvatarCrop(size, crop, -100000, 100000, edge))
        assert.ok(Math.abs(clamped.x - (size.width - rect.side)) < 1e-8)
        assert.equal(clamped.y, 0)
      }
      assert.equal(positionedAvatarCrop(size, crop, NaN, 0, 320), crop)
      assert.equal(positionedAvatarCrop(size, crop, 0, 0, 0), crop)
    }
  }
})
