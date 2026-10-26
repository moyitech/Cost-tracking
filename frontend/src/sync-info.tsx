import { Text, View } from '@tarojs/components'
import { Action, SymbolIcon } from './components'
import { syncTimeValue } from './offline-sync'

export function SyncInfo({ lastSyncedAt, open, onToggle }: { lastSyncedAt: string | null; open: boolean; onToggle: () => void }) {
  return <View className={`sync-info${open ? ' is-open' : ''}`} onClick={event => event.stopPropagation()}>
    <Action className='sync-info-button' label={open ? '收起同步时间' : '查看上次同步时间'} expanded={open} onClick={onToggle}><SymbolIcon name='info' /></Action>
    {open && <View className='sync-popover' role='tooltip'>
      <Text className='sync-popover-label'>上次同步时间</Text>
      <Text className='sync-popover-time'>{syncTimeValue(lastSyncedAt)}</Text>
    </View>}
  </View>
}
