import { Button, Text, View } from '@tarojs/components'
import type { ImportEntry } from '../../import-api'
import './duplicate-notice.scss'

export function DuplicateNotice({ candidates, selected, disabled = false, onSkip, onSelect }: {
  candidates: ImportEntry['duplicate_candidates']; selected: boolean; disabled?: boolean; onSkip: () => void; onSelect: () => void
}) {
  if (!candidates.length) return null
  return <View className={`duplicate-notice${selected ? ' duplicate-notice-selected' : ''}`}>
    <View className='duplicate-notice-heading'><View className='duplicate-notice-symbol' aria-hidden='true'><View className='duplicate-notice-symbol-sheet' /><View className='duplicate-notice-symbol-sheet duplicate-notice-symbol-front' /></View><View className='duplicate-notice-heading-copy'><Text className='duplicate-notice-title'>可能已记录</Text><Text className='duplicate-notice-caption'>发现相似物品，请确认是否为同一件</Text></View></View>
    <View className='duplicate-notice-items'>{candidates.map(candidate => <View className='duplicate-notice-item' key={candidate.id}><Text className='duplicate-notice-tag'>已有物品</Text><Text className='duplicate-notice-name'>{candidate.name}</Text></View>)}</View>
    <View className='duplicate-notice-actions'>
      <Button className='duplicate-notice-button' disabled={disabled} onClick={onSkip}>同一件，跳过</Button>
      <Button className={`duplicate-notice-button duplicate-notice-select${selected ? ' is-selected' : ''}`} disabled={disabled} aria-pressed={selected} onClick={onSelect}>{selected && <Text aria-hidden='true'>✓ </Text>}{selected ? '已选择作为新物品' : '仍作为新物品'}</Button>
    </View>
    {selected && <View className='duplicate-notice-confirmation' role='status'>确认后，点击下方“保存物品”</View>}
  </View>
}
