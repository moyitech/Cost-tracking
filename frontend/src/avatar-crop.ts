import { assertSquareImage, ImageSize } from './image-processing'

export type AvatarCrop = { zoom: number; centerX: number; centerY: number }
export const initialAvatarCrop = (): AvatarCrop => ({ zoom: 1, centerX: .5, centerY: .5 })
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

/** Source-image coordinates, independent of viewport width or CSS pixel ratio. */
export function avatarCropRect(size: ImageSize, crop: AvatarCrop) {
  if (![size.width, size.height].every(n => Number.isFinite(n) && n > 0)) throw new Error('无法读取图片尺寸，请重新选择')
  if (![crop.zoom, crop.centerX, crop.centerY].every(Number.isFinite)) throw new Error('裁剪位置无效，请重新选择')
  const zoom = clamp(crop.zoom, 1, 4)
  const side = Math.min(size.width, size.height) / zoom
  const x = clamp(crop.centerX * size.width - side / 2, 0, size.width - side)
  const y = clamp(crop.centerY * size.height - side / 2, 0, size.height - side)
  return { x, y, side, outputSize: Math.max(1, Math.floor(Math.min(512, side))), zoom }
}

export function zoomAvatarCrop(size: ImageSize, crop: AvatarCrop, zoom: number): AvatarCrop {
  const rect = avatarCropRect(size, { ...crop, zoom })
  return { zoom: rect.zoom, centerX: (rect.x + rect.side / 2) / size.width, centerY: (rect.y + rect.side / 2) / size.height }
}

export function moveAvatarCrop(size: ImageSize, crop: AvatarCrop, dx: number, dy: number, frameEdge: number): AvatarCrop {
  if (!Number.isFinite(frameEdge) || frameEdge <= 0 || ![dx, dy].every(Number.isFinite)) return crop
  const rect = avatarCropRect(size, crop)
  return zoomAvatarCrop(size, {
    ...crop,
    centerX: crop.centerX - dx * rect.side / frameEdge / size.width,
    centerY: crop.centerY - dy * rect.side / frameEdge / size.height,
  }, crop.zoom)
}

/** Convert native movable-view offsets back to the same source-pixel crop used for export. */
export function positionedAvatarCrop(size: ImageSize, crop: AvatarCrop, x: number, y: number, frameEdge: number): AvatarCrop {
  if (!Number.isFinite(frameEdge) || frameEdge <= 0 || ![x, y].every(Number.isFinite)) return crop
  const { side } = avatarCropRect(size, crop)
  return zoomAvatarCrop(size, {
    ...crop,
    centerX: (-x * side / frameEdge + side / 2) / size.width,
    centerY: (-y * side / frameEdge + side / 2) / size.height,
  }, crop.zoom)
}

export function imageActionCancelled(error: unknown) {
  const message = error instanceof Error ? error.message : String((error as { errMsg?: string } | null)?.errMsg || error)
  return /cancel/i.test(message)
}

export type NativeCropPort = {
  supported: boolean
  crop: (options: { src: string; cropScale: '1:1' }) => Promise<{ tempFilePath: string }>
  inspect: (path: string) => Promise<ImageSize>
}

/** Desktop hosts may advertise cropImage but never settle its callback. */
export function supportsNativeAvatarCrop(platform: string, advertised: boolean) {
  return advertised && /^(ios|android)$/i.test(platform)
}

export async function cropNativeAvatar(src: string, port: NativeCropPort): Promise<string | null> {
  if (!port.supported) throw new Error('原生头像裁剪不可用')
  let result: { tempFilePath: string }
  try { result = await port.crop({ src, cropScale: '1:1' }) }
  catch (error) {
    if (imageActionCancelled(error)) return null
    throw new Error('原生头像裁剪未能完成')
  }
  if (!result.tempFilePath) throw new Error('未能取得裁剪结果，请重新选择图片')
  assertSquareImage(await port.inspect(result.tempFilePath))
  return result.tempFilePath
}

export type AvatarCropChoice = { kind: 'cropped'; path: string } | { kind: 'cancelled' } | { kind: 'fallback' }

/** A failed capability probe/result uses the original in-app; a user cancellation ends the flow. */
export async function chooseAvatarCrop(src: string, port: NativeCropPort): Promise<AvatarCropChoice> {
  if (!port.supported) return { kind: 'fallback' }
  try {
    const path = await cropNativeAvatar(src, port)
    return path ? { kind: 'cropped', path } : { kind: 'cancelled' }
  } catch { return { kind: 'fallback' } }
}
