import Taro from '@tarojs/taro'
import { assertSquareImage, AVATAR_IMAGE_OPTIONS, createImageQueue, ImageEncoder, imageDimensions, ImageProcessingOptions, ImageSize, isLongScreenshot, processImage, ProcessedImage } from './image-processing'
import { AvatarCrop, avatarCropRect, chooseAvatarCrop, initialAvatarCrop, supportsNativeAvatarCrop } from './avatar-crop'

export const IMAGE_CANVAS_ID = 'local-image-canvas'
const enqueue = createImageQueue()
const IMAGE_TIMEOUT = 20000

function loadImage<T extends { onload: ((...args: any[]) => void) | null; onerror: ((...args: any[]) => void) | null; src: string }>(image: T, path: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { clean(); reject(new Error('读取图片超时，请重新选择')) }, IMAGE_TIMEOUT)
    const clean = () => { clearTimeout(timer); image.onload = null; image.onerror = null }
    image.onload = () => { clean(); resolve(image) }
    image.onerror = () => { clean(); reject(new Error('无法读取图片，请换一张图片重试')) }
    image.src = path
  })
}

async function nativeCanvas(): Promise<Taro.Canvas> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('图片处理暂不可用，请返回页面重试')), 5000)
    Taro.createSelectorQuery().select(`#${IMAGE_CANVAS_ID}`).fields({ node: true }).exec(results => {
      clearTimeout(timer)
      const canvas = results[0]?.node as Taro.Canvas | undefined
      if (canvas) resolve(canvas)
      else reject(new Error('图片处理暂不可用，请返回页面重试'))
    })
  })
}

async function nativeImage(path: string, warnLong: boolean, options: ImageProcessingOptions): Promise<ProcessedImage> {
  const info = await Taro.getImageInfo({ src: path })
  if (warnLong && isLongScreenshot(info)) void Taro.showToast({ title: '长截图建议分段上传，文字更清晰', icon: 'none', duration: 4000 }).catch(() => {})
  const canvas = await nativeCanvas()
  const image = await loadImage(canvas.createImage(), info.path || path)
  let drawn = ''
  let webpAvailable = typeof canvas.toDataURL === 'function'
  const encode: ImageEncoder = async (size, mime, quality) => {
    const key = `${size.width}:${size.height}`
    if (drawn !== key) {
      canvas.width = size.width; canvas.height = size.height
      const context = canvas.getContext('2d') as unknown as CanvasRenderingContext2D
      // Flatten transparency consistently for both WebP and JPEG receipts.
      context.fillStyle = '#ffffff'; context.fillRect(0, 0, size.width, size.height)
      context.drawImage(image as unknown as CanvasImageSource, 0, 0, size.width, size.height)
      drawn = key
      await new Promise<void>(resolve => Taro.nextTick(resolve))
    }
    if (mime === 'image/webp') {
      if (!webpAvailable) throw new Error('WebP encoding unavailable')
      try {
        const data = canvas.toDataURL(mime, quality)
        if (!data.startsWith('data:image/webp;base64,')) throw new Error('WebP encoding unavailable')
        return Taro.base64ToArrayBuffer(data.slice(data.indexOf(',') + 1))
      } catch (error) { webpAvailable = false; throw error }
    }
    // Native file export supports JPEG even where toDataURL WebP is unavailable.
    const result = await Taro.canvasToTempFilePath({ canvas, fileType: 'jpg', quality, x: 0, y: 0, width: size.width, height: size.height, destWidth: size.width, destHeight: size.height })
    const fs = Taro.getFileSystemManager()
    try {
      const file = await new Promise<ArrayBuffer>((resolve, reject) => fs.readFile({ filePath: result.tempFilePath, success: r => resolve(r.data as ArrayBuffer), fail: reject }))
      return file
    } finally { fs.unlink({ filePath: result.tempFilePath, fail: () => {} }) }
  }
  try { return await processImage(info, encode, options) }
  finally { image.src = ''; canvas.width = 1; canvas.height = 1 }
}

async function browserImage(path: string, warnLong: boolean, options: ImageProcessingOptions): Promise<ProcessedImage> {
  const image = new Image()
  // CORS is required if an older local draft happens to reference an external URL.
  image.crossOrigin = 'anonymous'
  const loaded = await loadImage(image, path)
  const size: ImageSize = { width: loaded.naturalWidth, height: loaded.naturalHeight }
  if (warnLong && isLongScreenshot(size)) void Taro.showToast({ title: '长截图建议分段上传，文字更清晰', icon: 'none', duration: 4000 }).catch(() => {})
  const canvas = document.createElement('canvas')
  let drawn = ''
  const encode: ImageEncoder = async (dimensions, mime, quality) => {
    const key = `${dimensions.width}:${dimensions.height}`
    if (drawn !== key) {
      canvas.width = dimensions.width; canvas.height = dimensions.height
      const context = canvas.getContext('2d')
      if (!context) throw new Error('当前浏览器暂不支持图片处理')
      context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height)
      context.drawImage(loaded, 0, 0, canvas.width, canvas.height)
      drawn = key
    }
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('图片转换失败')), mime, quality))
    return blob.arrayBuffer()
  }
  try { return await processImage(size, encode, options) }
  finally { image.src = ''; canvas.width = 1; canvas.height = 1 }
}

// All callers share the canvas: serialize encoding and release it after each image.
export function prepareUploadImage(path: string, warnLong = false, options: ImageProcessingOptions = {}) {
  return enqueue(() => process.env.TARO_ENV === 'weapp' ? nativeImage(path, warnLong, options) : browserImage(path, warnLong, options))
}

export function cropAvatarImage(path: string) {
  let supported = false
  try {
    let platform: string
    try { platform = Taro.getDeviceInfo().platform } catch { platform = Taro.getSystemInfoSync().platform }
    supported = supportsNativeAvatarCrop(platform, Taro.canIUse('cropImage') && typeof Taro.cropImage === 'function')
  } catch { /* Unknown hosts use the in-app cropper as well. */ }
  return chooseAvatarCrop(path, {
    supported,
    crop: options => Taro.cropImage(options),
    inspect: src => Taro.getImageInfo({ src }),
    // Reuse the pixel exporter on the user's confirmed crop, never on the original.
    normalize: (src, size) => exportNativeAvatarCrop({ ...size, original: src, preview: src }, initialAvatarCrop()),
  })
}

export type NativeAvatarSource = ImageSize & { original: string; preview: string }

/** Use the same decoder for a bounded PNG preview and the final crop, including EXIF orientation. */
export function prepareNativeAvatarSource(path: string): Promise<NativeAvatarSource> {
  return enqueue(async () => {
    const info = await Taro.getImageInfo({ src: path })
    const original = info.path || path
    const canvas = await nativeCanvas()
    const image = await loadImage(canvas.createImage(), original)
    try {
      const size = { width: image.width || info.width, height: image.height || info.height }
      const preview = imageDimensions(size, 1536)
      canvas.width = preview.width; canvas.height = preview.height
      const context = canvas.getContext('2d') as unknown as CanvasRenderingContext2D
      context.fillStyle = '#fff'; context.fillRect(0, 0, preview.width, preview.height)
      context.drawImage(image as unknown as CanvasImageSource, 0, 0, preview.width, preview.height)
      const result = await Taro.canvasToTempFilePath({ canvas, fileType: 'png', x: 0, y: 0, width: preview.width, height: preview.height, destWidth: preview.width, destHeight: preview.height })
      return { ...size, original, preview: result.tempFilePath }
    } finally { image.src = ''; canvas.width = 1; canvas.height = 1 }
  })
}

/** Export selected source pixels as a square PNG. Lossy compression still happens only on Save. */
export function exportNativeAvatarCrop(source: NativeAvatarSource, crop: AvatarCrop): Promise<string> {
  return enqueue(async () => {
    const rect = avatarCropRect(source, crop)
    const canvas = await nativeCanvas()
    const image = await loadImage(canvas.createImage(), source.original)
    try {
      canvas.width = canvas.height = rect.outputSize
      const context = canvas.getContext('2d') as unknown as CanvasRenderingContext2D
      context.fillStyle = '#fff'; context.fillRect(0, 0, rect.outputSize, rect.outputSize)
      context.drawImage(image as unknown as CanvasImageSource, rect.x, rect.y, rect.side, rect.side, 0, 0, rect.outputSize, rect.outputSize)
      const result = await Taro.canvasToTempFilePath({ canvas, fileType: 'png', x: 0, y: 0, width: rect.outputSize, height: rect.outputSize, destWidth: rect.outputSize, destHeight: rect.outputSize })
      assertSquareImage(await Taro.getImageInfo({ src: result.tempFilePath }))
      return result.tempFilePath
    } finally { image.src = ''; canvas.width = 1; canvas.height = 1 }
  })
}

export function releaseNativeAvatarSource(source: NativeAvatarSource) {
  Taro.getFileSystemManager().unlink({ filePath: source.preview, fail: () => {} })
}

/** Mock saves the same bounded, cropped bytes as the API path, never a temporary original. */
export async function persistSquarePreview(path: string, kind: 'avatar' | 'item' = 'avatar'): Promise<string> {
  const image = await prepareUploadImage(path, false, AVATAR_IMAGE_OPTIONS)
  if (process.env.TARO_ENV !== 'weapp') return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('图片保存失败，请重试'))
    reader.readAsDataURL(new Blob([image.bytes], { type: image.mime }))
  })
  const extension = image.mime === 'image/webp' ? 'webp' : 'jpg'
  const filePath = `${Taro.env.USER_DATA_PATH}/${kind}-${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`
  await new Promise<void>((resolve, reject) => Taro.getFileSystemManager().writeFile({ filePath, data: image.bytes, success: () => resolve(), fail: reject }))
  return filePath
}
