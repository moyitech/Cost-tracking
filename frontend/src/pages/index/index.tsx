import { PropsWithChildren, useEffect, useMemo, useRef, useState } from 'react'
import { Input, ScrollView, Text, View } from '@tarojs/components'
import Taro, { useDidHide, usePullDownRefresh, useRouter, useShareAppMessage } from '@tarojs/taro'
import { Action, Amount, choosePictures, Empty, ErrorNote, Header, Icon, Photo, Pill, SymbolIcon } from '../../components'
import { canEdit, completionHint, isDisposed, isIncompleteHolding, Item, metrics, missingFields, money, moneyShort, newestItemsFirst, spaceDaily, statusLabels } from '../../domain'
import { distribute, estimateCardHeight, headerLeadingWidth, homeLayout, masonryCardWidth, masonryColumns } from '../../masonry'
import type { ItemFilter } from '../../domain'
import { ItemForm } from '../../forms'
import { useAdaptiveLayout } from '../../layout'
import { roomForFilterList } from '../../layout-metrics'
import { useLedger } from '../../store'
import { stageImportPictures } from '../../import-selection'
import { GlassTabBar, Tab } from '../../glass-tab-bar'
import { Analysis, Records, Spaces } from './sections'
import { invitationShareMessage } from '../../invitation-share'
import { AvatarEditor, LedgerAvatar, SpaceSwitcher } from '../../spaces'
import type { Space } from '../../domain'
import { SyncInfo } from '../../sync-info'
const invitationCover = `${API_BASE_URL.replace(/\/$/, '')}/assets/invitation-cover.png?v=1`
// Filters outside the segmented control show as one removable chip.
const chipLabels: Partial<Record<ItemFilter, string>> = { incomplete: '待补充', unpriced: '价格待补充', sold: '已出售', retired: '已淘汰' }

export default function Home() {
  const layout = useAdaptiveLayout()
  const router = useRouter()
  const { data, spaceId, setSpaceId, loading, ready, error, refresh, pageError, lastSyncedAt } = useLedger()
  const [tab, setTab] = useState<Tab>((router.params.tab as Tab) || 'items')
  const [spaceMenu, setSpaceMenu] = useState(false); const [adding, setAdding] = useState(false)
  const [syncInfoOpen, setSyncInfoOpen] = useState(false)
  const [avatarTarget, setAvatarTarget] = useState<{ scope: Space['kind']; spaceId: string } | null>(null)
  const [query, setQuery] = useState(''); const [status, setStatus] = useState<ItemFilter>('all')
  const pickerLock = useRef(false); const [picking, setPicking] = useState(false); const [pickerError, setPickerError] = useState('')
  const [paneRefreshing, setPaneRefreshing] = useState(false)
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
  const itemCount = items.length
  const activeCount = items.filter(i => i.status === 'active').length
  const historyCount = items.filter(isDisposed).length
  const daily = spaceDaily(items)
  const allUnknown = daily.count > 0 && daily.incomplete === daily.count
  const search = query.trim()
  const filtered = useMemo(() => newestItemsFirst(items.filter(item => {
    const matchStatus = status === 'all' || (status === 'history' ? isDisposed(item) : status === 'incomplete' ? isIncompleteHolding(item) : status === 'unpriced' ? item.purchaseAmount === null : item.status === status)
    return matchStatus && item.name.toLowerCase().includes(search.toLowerCase())
  })), [items, status, search])
  const { gridWidth } = homeLayout(layout.window.windowWidth)
  const columnCount = masonryColumns(gridWidth); const cardWidth = masonryCardWidth(gridWidth, columnCount)
  const columns = distribute(filtered, columnCount, item => estimateCardHeight({ name: item.name, hint: completionHint(missingFields(item)) }, cardWidth))
  // A filter whose items have all been completed or restored falls back to all.
  const emptyFilter = (status === 'incomplete' && !daily.incomplete) || (status === 'unpriced' && !incomplete)
  // Chip filters refine a segment: 待补充 belongs to 在用, sold and retired to 已处置.
  const segment = status === 'incomplete' ? 'active' : status === 'sold' || status === 'retired' ? 'history' : status === 'unpriced' ? 'all' : status
  useEffect(() => { if (emptyFilter) setStatus('all') }, [emptyFilter])
  const showItems = (filter: ItemFilter) => { setTab('items'); setQuery(''); setStatus(filter) }
  // Wide windows show the items tab as two panes that scroll on their own.
  // Tall ones have room to list the filters down the sidebar.
  const split = layout.wide && tab === 'items'
  const sidebarList = split && roomForFilterList(layout.window.windowHeight, layout.headerHeight, layout.safeBottom)
  const refreshPane = () => { setPaneRefreshing(true); void refresh().finally(() => setPaneRefreshing(false)) }
  // The chip names the waterfall's current filter: under the segments on
  // phones, at the head of the waterfall on wide windows.
  const filterChip = chipLabels[status] && <View className='filter-chip-row'><Action className='filter-chip' label={`清除${chipLabels[status]}筛选`} onClick={() => setStatus('all')}><Text>{chipLabels[status]} · {filtered.length}</Text><Text className='filter-chip-close'>✕</Text></Action></View>
  // Wide windows carry the space switcher and its tools in the navigation bar,
  // whose row is otherwise empty between the brand and the WeChat capsule.
  const spaceSelector = <Action className='space-selector space-selector-refined' label={`${space?.name || '正在读取'}，展开全部空间`} expanded={spaceMenu} onClick={() => setSpaceMenu(true)}><LedgerAvatar kind={space?.kind} src={space?.kind === 'personal' ? data.profile?.avatar : space?.avatar} fileId={space?.kind === 'personal' ? data.profile?.avatarFileId : space?.avatarFileId} size='small' /><Text className='space-selector-name'>{space?.name || '正在读取'}</Text><SymbolIcon name='down' /></Action>
  const spaceActions = <View className='row space-bar-actions'>{!writable && tab !== 'spaces' && <Pill>仅可查看</Pill>}<SyncInfo lastSyncedAt={lastSyncedAt} open={syncInfoOpen} onToggle={() => setSyncInfoOpen(value => !value)} /><Action className='refresh-button' label='刷新当前空间' loading={loading} onClick={() => void refresh()}>{!loading && <SymbolIcon name='refresh' />}</Action></View>
  // In the split view the notice heads the waterfall, keeping the summary panel's height steady.
  const syncNotice = error && <View className='sync-notice'><View><Text>同步失败，已保留本地内容</Text><Text className='sync-error-detail'>{error}</Text></View><Action className='text-button' onClick={() => void refresh()}>重试</Action></View>
  return <View className={`page home-page ${layout.wide ? 'is-wide' : ''} ${split ? 'home-split' : ''} ${sidebarList ? 'sidebar-list' : ''} ${tab === 'spaces' ? 'space-surface' : ''}`} style={layout.style} onClick={() => setSyncInfoOpen(false)} onTouchMove={syncInfoOpen ? () => setSyncInfoOpen(false) : undefined}>
    {layout.wide ? <Header hideProfile leading={spaceSelector} leadingWidth={headerLeadingWidth(layout.window.windowWidth, process.env.TARO_ENV === 'weapp')} actions={spaceActions} /> : <><Header hideProfile /><View className='space-bar'>{spaceSelector}{spaceActions}</View></>}
    {!ready && !error ? <View className='page-content home-layout loading-skeleton' ariaLabel='正在加载物品'><View className='home-sidebar'><View className='skeleton-summary' /></View><View className='home-main'><View className='masonry'>{Array.from({ length: columnCount }, (_, column) => <View className='masonry-column' key={column}>{[0, 1].map(i => <View className='skeleton-card' key={i} />)}</View>)}</View></View></View> : !ready && error ? <Empty title='档案暂时无法读取' text={error}><Action className='primary' onClick={() => void refresh()}>重新加载</Action></Empty> : <>
      {!split && syncNotice}
      {tab === 'items' && <View className='page-content home-layout' style={layout.style}><Pane scroll={split} className='home-sidebar'>
        <View className='summary-card'>
          <Action className='summary-main' label={`${daily.incomplete ? '已知日均投入' : '日均持有成本'}${allUnknown ? '待补充' : ` ${money(daily.amount)} 元每天`}，查看在用物品`} onClick={() => showItems('active')}>
            <View className='summary-label'><Text>{daily.incomplete ? '已知日均投入' : '日均持有成本'}</Text><Text className='summary-chevron'>›</Text></View>
            {allUnknown ? <Text className='summary-pending'>待补充</Text> : <Amount className={`summary-amount ${money(daily.amount).length > 9 ? 'compact-amount' : ''}`} cents={daily.amount} unit='/天' />}
          </Action>
          <View className='summary-meta'><Text>{incomplete ? '已知投入' : '累计'} ¥{moneyShort(known)} · {itemCount} 件</Text>{daily.incomplete > 0 && <Action className='summary-pending-link' label={`${daily.incomplete} 件待补充，查看`} onClick={() => showItems('incomplete')}>{daily.incomplete} 件待补充 ›</Action>}</View>
        </View>
        <View className='entry-actions'><Action className='primary' label='AI 识别，支持多张截图' disabled={!writable} loading={picking} onClick={() => void startImport()}><Icon name='home-container1' /><Text>AI 识别</Text></Action><Action className='secondary' disabled={!writable} onClick={() => setAdding(true)}><Icon name='home-container2' /><Text>手动添加</Text></Action></View>
        <ErrorNote message={pickerError} /><View className='search-box'><Icon name='home-icon' /><Input ariaLabel='搜索商品名' placeholder='搜索商品名' value={query} onInput={e => setQuery(e.detail.value)} />{query && <Action className='search-clear' label='清除搜索' onClick={() => setQuery('')}>×</Action>}</View>
        <View className='status-tabs'>{([['all', '全部', itemCount], ['active', '在用', activeCount], ['history', '已处置', historyCount]] as const).map(([key, label, count]) => <Action key={key} className={segment === key ? 'selected' : ''} label={`${label}，${count} 件${segment === key ? '，已选中' : ''}`} onClick={() => setStatus(key)}><Text className='status-label'>{label}</Text><Text className='status-count'>{count > 999 ? '999+' : count}</Text></Action>)}</View>
        {!layout.wide && filterChip}
      </Pane><Pane scroll={split} className='home-main' refreshing={paneRefreshing} onRefresh={refreshPane}>
        {split && syncNotice}
        {layout.wide && filterChip}
        {filtered.length > 0 && <View className='masonry'>{columns.map((column, i) => <View className='masonry-column' key={i}>{column.map(item => <ItemCard item={item} key={item.id} />)}</View>)}</View>}
        {!filtered.length && (search
          ? <Empty title={`没有找到「${search}」`} text=''><Action className='secondary' onClick={() => setQuery('')}>清除搜索</Action></Empty>
          : <Empty title={itemCount ? '没有符合条件的物品' : '给物品一个有迹可循的家'} text={itemCount ? '' : '从手动添加第一件物品开始。'}>{!itemCount && writable && <Action className='secondary' onClick={() => setAdding(true)}>添加第一件物品</Action>}</Empty>)}
        <ErrorNote message={pageError} />
      </Pane></View>}
      {tab === 'analysis' && <Analysis items={items} onFilter={showItems} />}
      {tab === 'records' && <Records items={items} />}
      {tab === 'spaces' && space && <Spaces space={space} onItems={() => showItems('all')} onAvatar={() => setAvatarTarget({ scope: space.kind, spaceId: space.id })} />}
    </>}
    <GlassTabBar value={tab} onChange={setTab} />
    {spaceMenu && <SpaceSwitcher current={space} onClose={() => setSpaceMenu(false)} onSelect={id => { setSpaceId(id); setStatus('all'); setQuery('') }} />}
    {avatarTarget && <AvatarEditor key={`${avatarTarget.scope}:${avatarTarget.spaceId}`} {...avatarTarget} onClose={() => setAvatarTarget(null)} />}
    {adding && <ItemForm onClose={() => setAdding(false)} />}
  </View>
}

// A pane of the wide items tab scrolls by itself, so moving the waterfall
// never drags the summary column; phones keep a single page scroll.
function Pane({ scroll, className, refreshing, onRefresh, children }: PropsWithChildren<{ scroll: boolean; className: string; refreshing?: boolean; onRefresh?: () => void }>) {
  if (!scroll) return <View className={className}>{children}</View>
  return <ScrollView className={className} scrollY enhanced showScrollbar={false} refresherEnabled={!!onRefresh} refresherTriggered={refreshing} refresherBackground='#f7f9f8' onRefresherRefresh={onRefresh}><View className='pane-body'>{children}</View></ScrollView>
}

function ItemCard({ item }: { item: Item }) {
  const m = metrics(item); const disposed = isDisposed(item)
  const hint = completionHint(missingFields(item))
  const days = m.days === null ? '' : `${m.days} 天`
  const value = m.daily === null ? '日均成本待补充' : `${disposed ? '实际日均' : '日均'} ${money(m.daily)} 元`
  const hasImage = !!(item.image || item.imageFileId || item.imagePresetId)
  return <Action className={`item-card cover-card ${item.status}`} label={`${item.name}，${disposed ? `${statusLabels[item.status]}，` : ''}${hint || value}${days && !hint ? `，持有 ${days}` : ''}`} onClick={() => Taro.navigateTo({ url: `/pages/detail/index?id=${item.id}` })}>
    <View className={`cover ${item.imagePresetId ? 'cover-preset' : ''}`}>
      {hasImage ? <Photo src={item.image} fileId={item.imageFileId} presetId={item.imagePresetId} className='cover-image' /> : <View className='cover-placeholder'><Text>{Array.from(item.name.trim())[0] || '物'}</Text></View>}
      {disposed && <Text className='cover-badge'>{statusLabels[item.status]}</Text>}
    </View>
    <View className='cover-body'>
      <View className='cover-name'>{item.name}</View>
      {hint ? <Text className='cover-hint'>{hint} ›</Text> : <View className='cover-footer'>{m.daily === null ? <Text className='cover-pending'>待补充</Text> : <Amount className='cover-daily' cents={m.daily} unit='/天' />}{days && <Text className='cover-days'>{days}</Text>}</View>}
    </View>
  </Action>
}
