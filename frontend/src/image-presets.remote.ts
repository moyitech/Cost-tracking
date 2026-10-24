import type { ImagePreset } from './image-preset-client'

// Production builds load the COS catalog and do not bundle the Mock PNG library.
export const imagePresets: ImagePreset[] = []
