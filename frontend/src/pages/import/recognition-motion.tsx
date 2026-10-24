import { View } from '@tarojs/components'
import './recognition-motion.scss'

export type RecognitionVariant = 'scan' | 'orbit' | 'objects'
export function RecognitionMotion({ variant, paused = false, complete = false }: { variant: RecognitionVariant; paused?: boolean; complete?: boolean }) {
  return <View className={`recognition-motion motion-${variant}${paused ? ' motion-paused' : ''}${complete ? ' motion-complete' : ''}`} aria-hidden='true'>
    <View className='motion-part motion-halo' />
    {complete ? <View className='motion-part motion-success'><View className='motion-part' /></View> : <>
      {variant === 'scan' && <>
        <View className='motion-part scan-sheet scan-sheet-back' />
        <View className='motion-part scan-sheet scan-sheet-front'>
          <View className='motion-part scan-picture'><View className='motion-part' /></View>
          <View className='motion-part scan-line scan-line-one' /><View className='motion-part scan-line scan-line-two' />
          <View className='motion-part scan-beam' />
        </View>
        <View className='motion-part scan-chip scan-chip-one' /><View className='motion-part scan-chip scan-chip-two' />
        <View className='motion-part scan-corner scan-corner-one' /><View className='motion-part scan-corner scan-corner-two' />
      </>}
      {variant === 'orbit' && <>
        <View className='motion-part orbit-track orbit-track-one'><View className='motion-part orbit-dot' /></View>
        <View className='motion-part orbit-track orbit-track-two'><View className='motion-part orbit-dot' /></View>
        <View className='motion-part orbit-core'><View className='motion-part orbit-core-inner' /></View>
        <View className='motion-part orbit-spark orbit-spark-one' /><View className='motion-part orbit-spark orbit-spark-two' />
      </>}
      {variant === 'objects' && <>
        <View className='motion-part objects-track' />
        <View className='motion-part object-tile object-phone'><View className='motion-part object-icon phone-icon'><View className='motion-part' /></View></View>
        <View className='motion-part object-tile object-camera'><View className='motion-part object-icon camera-icon'><View className='motion-part' /></View></View>
        <View className='motion-part object-tile object-headphones'><View className='motion-part object-icon headphones-icon'><View className='motion-part' /><View className='motion-part' /></View></View>
        <View className='motion-part objects-card'><View className='motion-part' /><View className='motion-part' /></View>
      </>}
    </>}
  </View>
}
