import phone from './assets/presets/cartoon/phone.png'
import tablet from './assets/presets/cartoon/tablet.png'
import laptop from './assets/presets/cartoon/laptop.png'
import desktop from './assets/presets/cartoon/desktop.png'
import headphones from './assets/presets/cartoon/headphones.png'
import earbuds from './assets/presets/cartoon/earbuds.png'
import watch from './assets/presets/cartoon/watch.png'
import camera from './assets/presets/cartoon/camera.png'
import gamepad from './assets/presets/cartoon/gamepad.png'
import speaker from './assets/presets/cartoon/speaker.png'
import realisticPhone from './assets/presets/realistic/phone.png'
import realisticTablet from './assets/presets/realistic/tablet.png'
import realisticLaptop from './assets/presets/realistic/laptop.png'
import realisticDesktop from './assets/presets/realistic/desktop.png'
import realisticHeadphones from './assets/presets/realistic/headphones.png'
import realisticEarbuds from './assets/presets/realistic/earbuds.png'
import realisticWatch from './assets/presets/realistic/watch.png'
import realisticCamera from './assets/presets/realistic/camera.png'
import realisticGamepad from './assets/presets/realistic/gamepad.png'
import realisticSpeaker from './assets/presets/realistic/speaker.png'
import { presetOptions, PresetStyle, PresetSubject } from './item-image'

// Separate generated artwork for each style; local previews retain transparent alpha.
const sources: Record<PresetStyle, Record<PresetSubject, string>> = {
  cartoon: { phone, tablet, laptop, desktop, headphones, earbuds, watch, camera, gamepad, speaker },
  realistic: { phone: realisticPhone, tablet: realisticTablet, laptop: realisticLaptop, desktop: realisticDesktop, headphones: realisticHeadphones, earbuds: realisticEarbuds, watch: realisticWatch, camera: realisticCamera, gamepad: realisticGamepad, speaker: realisticSpeaker },
}
export const imagePresets = presetOptions.map(preset => ({ ...preset, src: sources[preset.style][preset.key] }))
export const imagePreset = (id?: string) => imagePresets.find(preset => preset.id === id)
