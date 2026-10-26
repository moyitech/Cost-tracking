import { useEffect, useMemo, useRef, useState } from 'react'
import { Input, Text, View } from '@tarojs/components'
import Taro, { useDidHide, usePullDownRefresh, useRouter, useShareAppMessage } from '@tarojs/taro'
import { Action, choosePictures, Empty, ErrorNote, Header, Icon, Photo, Pill, SymbolIcon } from '../../components'
import { canEdit, isDisposed, Item, metrics, money, newestItemsFirst, spaceDaily, statusLabels } from '../../domain'
import { ItemForm } from '../../forms'
import { useAdaptiveLayout } from '../../layout'
import { useLedger } from '../../store'
import { stageImportPictures } from '../../import-selection'
import { GlassTabBar, Tab } from '../../glass-tab-bar'
import { Analysis, Records, Spaces } from './sections'
import { invitationShareMessage } from '../../invitation-share'
import { AvatarEditor, LedgerAvatar, SpaceSwitcher } from '../../spaces'
import type { Space } from '../../domain'
import { SyncInfo } from '../../sync-info'
const invitationCover = `${API_BASE_URL.replace(/\/$/, '')}/assets/invitation-cover.png?v=1`

export default function Home() {
  const layout = useAdaptiveLayout()
  const router = useRouter()
  const { data, spaceId, setSpaceId, loading, ready, error, refresh, pageError, lastSyncedAt } = useLedger()
  const [tab, setTab] = useState<Tab>((router.params.tab as Tab) || 'items')
  const [spaceMenu, setSpaceMenu] = useState(false); const [adding, setAdding] = useState(false)
  const [syncInfoOpen, setSyncInfoOpen] = useState(false)
  const [avatarTarget, setAvatarTarget] = useState<{ scope: Space['kind']; spaceId: string } | null>(null)
  const [query, setQuery] = useState(''); const [status, setStatus] = useState('all')
  const pickerLock = useRef(false); const [picking, setPicking] = useState(false); const [pickerError, setPickerError] = useState('')
  useDidHide(() => setSyncInfoOpen(false))
  useEffect(() => { setSyncInfoOpen(false) }, [tab, spaceId, spaceMenu, adding, avatarTarget])
  useEffect(() => {
    if (!syncInfoOpen || process.env.TARO_ENV !== 'h5') return
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setSyncInfoOpen(false) }
    document.addEventListener('keydown', close)
    return () => document.removeEventListener('keydown', close)
  }, [syncInfoOpen])
  useShareAppMessage(options => {
    const dataset = (options.target as { dataset?: { token?: string; family?: string } } | undefined)?.dataset
    return invitationShareMessage(dataset, invitationCover)
  })
  usePullDownRefresh(() => { void refresh().finally(() => Taro.stopPullDownRefresh()) })
  const startImport = async () => {
    if (pickerLock.current) return
    pickerLock.current = true; setPicking(true); setPickerError('')
    try {
      const paths = await choosePictures(9, false, ['album'])
      if (!paths.length) return
      stageImportPictures(paths, spaceId)
      await Taro.navigateTo({ url: '/pages/import/index' })
    } catch (e) {
      const message = typeof e === 'object' && e && 'errMsg' in e ? String(e.errMsg) : String(e)
      if (!/cancel/i.test(message)) setPickerError('无法打开相册，请重试')
    } finally { pickerLock.current = false; setPicking(false) }
  }
  const space = data.spaces.find(s => s.id === spaceId) || data.spaces[0]
  const items = data.items.filter(i => i.spaceId === space?.id && !i.deleted)
  const writable = canEdit(space)
  const known = items.reduce((sum, item) => sum + metrics(item).known, 0)
  const incomplete = items.filter(i => i.purchaseAmount === null).length
  const active = items.filter(i => i.status === 'active').length
  const itemCount = items.length
  const historyCount = items.filter(isDisposed).length
  const daily = spaceDaily(items)
  const filtered = useMemo(() => newestItemsFirst(items.filter(item => {
    const matchStatus = status === 'all' || (status === 'history' ? isDisposed(item) : item.status === status)
    return matchStatus && item.name.toLowerCase().includes(query.trim().toLowerCase())
  })), [items, status, query])
  const filterFromAnalysis = (filter: string, value: string) => { setTab('items'); setQuery(''); setStatus(filter === 'status' ? value : 'all') }
  return <View className={`page home-page ${tab === 'spaces' ? 'space-surface' : ''}`} style={layout.style} onClick={() => setSyncInfoOpen(false)} onTouchMove={syncInfoOpen ? () => setSyncInfoOpen(false) : undefined}>
    <Header hideProfile />
    <View className='space-bar'><Action className='space-selector space-selector-refined' label={`${space?.name || '正在读取'}，展开全部空间`} expanded={spaceMenu} onClick={() => setSpaceMenu(true)}><LedgerAvatar kind={space?.kind} src={space?.kind === 'personal' ? data.profile?.avatar : space?.avatar} fileId={space?.kind === 'personal' ? data.profile?.avatarFileId : space?.avatarFileId} size='small' /><Text className='space-selector-name'>{space?.name || '正在读取'}</Text><SymbolIcon name='down' /></Action><View className='row space-bar-actions'>{!writable && tab !== 'spaces' && <Pill>仅可查看</Pill>}<SyncInfo lastSyncedAt={lastSyncedAt} open={syncInfoOpen} onToggle={() => setSyncInfoOpen(value => !value)} /><Action className='refresh-button' label='刷新当前空间' loading={loading} onClick={() => void refresh()}>{!loading && <SymbolIcon name='refresh' />}</Action></View></View>
    {!ready && !error ? <View className='page-content loading-skeleton' ariaLabel='正在加载物品'><View className='skeleton-summary' />{[1, 2, 3].map(i => <View className='skeleton-card' key={i} />)}</View> : !ready && error ? <Empty title='档案暂时无法读取' text={error}><Action className='primary' onClick={() => void refresh()}>重新加载</Action></Empty> : <>
      {error && <View className='sync-notice'><View><Text>同步失败，已保留本地内容</Text><Text className='sync-error-detail'>{error}</Text></View><Action className='text-button' onClick={() => void refresh()}>重试</Action></View>}
      {tab === 'items' && <View className='page-content' style={layout.style}>
        <View className='summary-card'>
          <View className='summary-main'><View><View className='row'><Text className='summary-label'>{incomplete ? '空间已知投入' : '空间累计投入'}</Text><Pill>{itemCount}件在册</Pill></View><View className={`summary-amount ${money(known).length > 11 ? 'compact-amount' : ''}`}><Text className='currency'>¥</Text><Text>{money(known)}</Text></View></View><Action className='summary-right' onClick={() => { setStatus('active'); setQuery('') }}><View><Text className='summary-label'>{daily.incomplete ? '已知日均投入' : '日均持有成本'}</Text><View className='summary-daily'><Text className='summary-count'>{daily.count > 0 && daily.incomplete === daily.count ? '待补充' : `¥${money(daily.amount)}`}</Text>{!(daily.count > 0 && daily.incomplete === daily.count) && <Text className='summary-unit'> /天</Text>}</View></View></Action></View>
          <View className='row spread'><View className='row summary-tags'><Pill dot>{active} 件在用</Pill></View><Text className='summary-caption'>{daily.incomplete ? `${daily.incomplete} 件待补充` : ''}</Text></View>
        </View>
        <View className='entry-actions'><Action className='primary' disabled={!writable} loading={picking} onClick={() => void startImport()}><Icon name='home-container1' /><View className='entry-label'><Text>AI 识别</Text><Text className='entry-caption'>支持多张</Text></View></Action><Action className='secondary' disabled={!writable} onClick={() => setAdding(true)}><Icon name='home-container2' />手动添加</Action></View>
        <ErrorNote message={pickerError} /><View className='search-box'><Icon name='home-icon' /><Input ariaLabel='搜索商品名' placeholder='搜索商品名' value={query} onInput={e => setQuery(e.detail.value)} />{query && <Action className='search-clear' label='清除搜索' onClick={() => setQuery('')}>×</Action>}</View>
        <View className='status-tabs'>{[['all', '全部', itemCount], ['active', '在用', active], ['history', '历史处置', historyCount]].map(([key, label, count]) => <Action key={key} className={status === key ? 'selected' : ''} label={`${label}，${count} 件${status === key ? '，已选中' : ''}`} onClick={() => setStatus(String(key))}><Text className='status-label'>{label}</Text><Text className='status-count'>{Number(count) > 999 ? '999+' : count}</Text></Action>)}</View>
        <View className='item-list'>{filtered.map(item => <ItemCard item={item} key={item.id} />)}</View>
        {!filtered.length && <Empty title={itemCount ? '没有符合条件的物品' : '给物品一个有迹可循的家'} text={itemCount ? '' : '从手动添加第一件物品开始。'}>{!itemCount && writable && <Action className='secondary' onClick={() => setAdding(true)}>添加第一件物品</Action>}</Empty>}
        <ErrorNote message={pageError} />
      </View>}
      {tab === 'analysis' && <Analysis items={items} onFilter={filterFromAnalysis} />}
      {tab === 'records' && <Records items={items} />}
      {tab === 'spaces' && space && <Spaces space={space} onItems={() => { setTab('items'); setStatus('all'); setQuery('') }} onAvatar={() => setAvatarTarget({ scope: space.kind, spaceId: space.id })} />}
    </>}
    <GlassTabBar value={tab} onChange={setTab} />
    {spaceMenu && <SpaceSwitcher current={space} onClose={() => setSpaceMenu(false)} onSelect={id => { setSpaceId(id); setStatus('all'); setQuery('') }} />}
    {avatarTarget && <AvatarEditor key={`${avatarTarget.scope}:${avatarTarget.spaceId}`} {...avatarTarget} onClose={() => setAvatarTarget(null)} />}
    {adding && <ItemForm onClose={() => setAdding(false)} />}
  </View>
}

function ItemCard({ item }: { item: Item }) {
  const m = metrics(item); const disposed = isDisposed(item)
  return <Action className={`item-card ${item.status}`} onClick={() => Taro.navigateTo({ url: `/pages/detail/index?id=${item.id}` })}>
    <View className='item-top'><Photo src={item.image} fileId={item.imageFileId} presetId={item.imagePresetId} /><View className='item-info'><View className='row spread'><Text className='item-name'>{item.name}</Text></View><View className='row item-tags'><Pill tone={disposed ? 'gray' : 'green'} dot>{statusLabels[item.status]}{disposed && item.recoveryAmount !== null ? ` · 回收 ¥${money(item.recoveryAmount)}` : ''}</Pill></View></View></View>
    <View className='holding-label'>{disposed ? '生命周期' : '持有'} {m.days === null ? '待补充' : `${m.days} 天`}</View>
    <View className='item-cost'><View><Text className='cost-label'>{disposed ? '实际持有成本' : m.total === null ? '已知投入 · 待补充' : '累计投入'}</Text><Text className='cost-amount'>{(disposed && m.net === null) || (!disposed && m.total === null && !item.expenses.length) ? '待补充' : `¥${money(disposed ? m.net : m.known)}`}</Text></View><View className='cost-right'><Text className='cost-label'>{disposed ? '实际日均成本' : '日均持有成本'}</Text><View><Text className='daily-amount'>{m.daily === null ? '待补充' : `¥${money(m.daily)}`}</Text>{m.daily !== null && <Text className='day-unit'> /天</Text>}</View></View></View>
  </Action>
}
