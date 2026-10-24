export const IMAGE_MAX_BYTES = 2 * 1024 * 1024
export const IMAGE_MAX_EDGE = 8192
// Keep the canvas backing store under 64 MiB on phones, even for square images.
const CANVAS_MAX_PIXELS = 16 * 1024 * 1024
export type ImageSize = { width: number; height: number }
export type ImageMime = 'image/webp' | 'image/jpeg' | 'image/png'
export type ProcessedImage = ImageSize & { bytes: ArrayBuffer; mime: ImageMime }
export type ImageEncoder = (size: ImageSize, mime: 'image/webp' | 'image/jpeg', quality: number) => Promise<ArrayBuffer>
export type ImageProcessingOptions = { maxEdge?: number; maxBytes?: number; minEdge?: number; requireSquare?: boolean }
export const AVATAR_IMAGE_OPTIONS: ImageProcessingOptions = { maxEdge: 512, maxBytes: 256 * 1024, minEdge: 128, requireSquare: true }
export const AVATAR_PROCESSING_VERSION = 'avatar-square-v1'
export const isAvatarPurpose = (purpose: string) => purpose === 'personal_avatar' || purpose === 'family_avatar'

export function assertSquareImage(size: ImageSize) {
  if (!Number.isInteger(size.width) || !Number.isInteger(size.height) || size.width < 1 || size.width !== size.height) throw new Error('请先将头像裁剪为正方形')
}

export function imageMime(bytes: ArrayBuffer): ImageMime {
  const b = new Uint8Array(bytes)
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => b[i] === v)) return 'image/png'
  if (b.length >= 16 && String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP' && ['VP8 ', 'VP8L', 'VP8X'].includes(String.fromCharCode(...b.slice(12, 16)))) return 'image/webp'
  throw new Error('图片格式无效，请重新选择图片')
}

export function imageDimensions(size: ImageSize, maxEdge = IMAGE_MAX_EDGE): ImageSize {
  if (!Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width < 1 || size.height < 1) throw new Error('无法读取图片尺寸，请重新选择')
  const scale = Math.min(1, maxEdge / Math.max(size.width, size.height), Math.sqrt(CANVAS_MAX_PIXELS / (size.width * size.height)))
  return { width: Math.max(1, Math.floor(size.width * scale)), height: Math.max(1, Math.floor(size.height * scale)) }
}

export function isLongScreenshot(size: ImageSize) { return size.height / size.width >= 3 }

// The encoder must return actual file bytes: a PNG fallback is not WebP support.
export async function processImage(size: ImageSize, encode: ImageEncoder, options: ImageProcessingOptions = {}): Promise<ProcessedImage> {
  if (options.requireSquare) assertSquareImage(size)
  const maxBytes = options.maxBytes ?? IMAGE_MAX_BYTES
  let dimensions = imageDimensions(size, options.maxEdge ?? IMAGE_MAX_EDGE)
  let mime: 'image/webp' | 'image/jpeg' = 'image/webp'
  for (let attempt = 0; attempt < 12; attempt++) {
    for (const quality of [.85, .75, .65]) {
      let bytes: ArrayBuffer
      if (mime === 'image/webp') {
        try {
          bytes = await encode(dimensions, mime, quality)
          if (imageMime(bytes) !== mime) throw new Error('WebP encoding unavailable')
        } catch {
          mime = 'image/jpeg'
          bytes = await encode(dimensions, mime, quality)
        }
      } else bytes = await encode(dimensions, mime, quality)
      if (imageMime(bytes) !== mime) throw new Error('图片转换失败，请重新选择图片')
      if (bytes.byteLength > 0 && bytes.byteLength <= maxBytes) return { ...dimensions, bytes, mime }
    }
    // Bound quality loss; reduce resolution instead of repeatedly degrading text.
    const next = { width: Math.max(1, Math.floor(dimensions.width * .8)), height: Math.max(1, Math.floor(dimensions.height * .8)) }
    if (Math.max(next.width, next.height) < (options.minEdge ?? 512) || next.width === dimensions.width && next.height === dimensions.height) break
    dimensions = next
  }
  throw new Error(options.requireSquare ? '头像压缩后仍然过大，请换一张图片重试' : '图片压缩后仍超过 2 MiB，请裁剪图片或分段截图后重试')
}

export function createImageQueue() {
  let pending: Promise<unknown> = Promise.resolve()
  return <T>(task: () => Promise<T>): Promise<T> => {
    const result = pending.then(task)
    pending = result.catch(() => {})
    return result
  }
}
