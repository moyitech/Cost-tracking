import { useMemo, useState } from 'react'
import { Input, Text, View } from '@tarojs/components'
import Taro, { useDidShow, useRouter } from '@tarojs/taro'
import { Action, Empty, FooterNote, Header, Icon, Photo, Pill, Sheet } from '../../components'
import { canEdit, isDisposed, Item, metrics, money, spaceDaily, statusLabels } from '../../domain'
import { ItemForm } from '../../forms'
import { useAdaptiveLayout } from '../../layout'
import { useLedger } from '../../store'
import { GlassTabBar, Tab } from '../../glass-tab-bar'
import { Analysis, Records, Spaces } from './sections'

export default function Home() {
  const layout = useAdaptiveLayout()
  const router = useRouter()
  const { data, spaceId, setSpaceId, loading, error, refresh } = useLedger()
  const [tab, setTab] = useState<Tab>((router.params.tab as Tab) || 'items')
  const [spaceMenu, setSpaceMenu] = useState(false); const [adding, setAdding] = useState(false)
  const [query, setQuery] = useState(''); const [category, setCategory] = useState('全部'); const [status, setStatus] = useState('all')
  useDidShow(() => { void refresh() })
  const space = data.spaces.find(s => s.id === spaceId) || data.spaces[0]
  const items = data.items.filter(i => i.spaceId === space?.id && !i.deleted)
  const writable = canEdit(space)
  const known = items.reduce((sum, item) => sum + metrics(item).known, 0)
  const incomplete = items.filter(i => i.purchaseAmount === null).length
  const active = items.filter(i => i.status === 'active').length
  const daily = spaceDaily(items)
  const filtered = useMemo(() => items.filter(item => {
    const matchStatus = status === 'all' || (status === 'holding' ? !isDisposed(item) : status === 'history' ? isDisposed(item) : item.status === status)
    const matchCategory = category === '全部' || item.category === category
    return matchStatus && matchCategory && `${item.name} ${item.brand} ${item.model}`.toLowerCase().includes(query.trim().toLowerCase())
  }), [items, category, status, query])
  const filterFromAnalysis = (filter: string, value: string) => { setTab('items'); setQuery(''); setCategory(filter === 'category' ? value : '全部'); setStatus(filter === 'status' ? value : 'all') }
  return <View className='page home-page' style={layout.style}>
    <Header onProfile={() => setTab('spaces')} />
    <View className='space-bar'><Action className='space-selector' onClick={() => setSpaceMenu(true)}>🏠 {space?.name || '正在读取'} <Icon name='home-container' /></Action><Pill tone='green' dot>{writable ? '记录每一份价值' : '仅可查看'}</Pill></View>
    {loading ? <Empty title='正在整理你的物品…' text='加载本地档案' /> : error ? <Empty title='档案暂时无法读取' text={error}><Action className='primary' onClick={() => void refresh()}>重新加载</Action></Empty> : <>
      {tab === 'items' && <View className='page-content' style={layout.style}>
        <View className='summary-card'>
          <View className='summary-main'><View><View className='row'><Text className='summary-label'>{incomplete ? '空间已知投入' : '空间累计投入'}</Text><Pill>{items.length}件在册</Pill></View><View className='summary-amount'><Text className='currency'>¥</Text><Text>{money(known, 0)}</Text></View></View><Action className='summary-right' onClick={() => { setStatus('holding'); setCategory('全部'); setQuery('') }}><View><Text className='summary-label'>{daily.incomplete ? '已知日均投入' : '当前日均投入'}</Text><View className='summary-daily'><Text className='summary-count'>{daily.count > 0 && daily.incomplete === daily.count ? '待补充' : `¥${money(daily.amount)}`}</Text>{!(daily.count > 0 && daily.incomplete === daily.count) && <Text className='summary-unit'> /天</Text>}</View></View></Action></View>
          <View className='row spread'><View className='row summary-tags'><Pill dot>{active} 件在用</Pill></View><Text className='summary-caption'>{daily.incomplete ? `${daily.incomplete} 件日均待补充` : '从购买日起按天分摊'}</Text></View>
        </View>
        <View className='entry-actions'><Action className='primary' disabled={!writable} onClick={() => Taro.navigateTo({ url: '/pages/import/index' })}><Icon name='home-container1' />AI 截图导入</Action><Action className='secondary' disabled={!writable} onClick={() => setAdding(true)}><Icon name='home-container2' />手动添加</Action></View>
        <View className='search-box'><Icon name='home-icon' /><Input ariaLabel='搜索资产或品牌型号' placeholder='搜索资产或品牌型号' value={query} onInput={e => setQuery(e.detail.value)} />{query && <Action className='search-clear' label='清除搜索' onClick={() => setQuery('')}>×</Action>}</View>
        <View className='category-scroller'>{['全部', ...Array.from(new Set(items.map(i => i.category)))].map(c => <Action key={c} className={`category-chip ${category === c ? 'selected' : ''}`} onClick={() => setCategory(c)}>{c} <Text>{c === '全部' ? items.length : items.filter(i => i.category === c).length}</Text></Action>)}</View>
        <View className='status-tabs'>{[['all', '全部', items.length], ['active', '在用', active], ['history', '历史处置', items.filter(isDisposed).length]].map(([key, label, count]) => <Action key={key} className={status === key ? 'selected' : ''} onClick={() => setStatus(String(key))}>{label} <Text>({count})</Text></Action>)}</View>
        {status === 'holding' && <View className='holding-filter'>当前持有 · 参与日均统计的物品 <Action onClick={() => setStatus('all')}>清除 ×</Action></View>}<View className='item-list'>{filtered.map(item => <ItemCard item={item} key={item.id} />)}</View>
        {!filtered.length && <Empty title={items.length ? '没有符合条件的物品' : '给物品一个有迹可循的家'} text={items.length ? '试试其他名称、类别或状态。' : '从手动添加或截图导入开始。'}><Action className='secondary' onClick={() => { setQuery(''); setCategory('全部'); setStatus('all'); if (!items.length && writable) setAdding(true) }}>{items.length ? '清除筛选' : writable ? '添加第一件物品' : '等待家庭成员添加'}</Action></Empty>}
        <FooterNote>OBJET LEDGER SYSTEM · {items.length} ITEMS</FooterNote>
      </View>}
      {tab === 'analysis' && <Analysis items={items} onFilter={filterFromAnalysis} />}
      {tab === 'records' && <Records items={items} />}
      {tab === 'spaces' && space && <Spaces space={space} />}
    </>}
    <GlassTabBar value={tab} onChange={setTab} />
    {spaceMenu && <Sheet title='切换空间' onClose={() => setSpaceMenu(false)}><Text className='form-intro'>个人物品仅自己可见；加入家庭不会自动迁移物品。</Text>{data.spaces.map(s => <Action key={s.id} className={`space-option ${space?.id === s.id ? 'selected' : ''}`} onClick={() => { setSpaceId(s.id); setSpaceMenu(false); setCategory('全部'); setStatus('all'); setQuery('') }}><Text>{s.kind === 'personal' ? '🏠' : '⌂'} {s.name}</Text><Text className='muted'>{s.role === 'viewer' ? '仅查看' : '可编辑'} {space?.id === s.id ? '✓' : ''}</Text></Action>)}</Sheet>}
    {adding && <ItemForm onClose={() => setAdding(false)} />}
  </View>
}

function ItemCard({ item }: { item: Item }) {
  const m = metrics(item); const disposed = isDisposed(item)
  return <Action className={`item-card ${item.status}`} onClick={() => Taro.navigateTo({ url: `/pages/detail/index?id=${item.id}` })}>
    <View className='item-top'><Photo src={item.image} /><View className='item-info'><View className='row spread'><Text className='item-name'>{item.name}</Text></View><View className='row item-tags'><Pill>{item.category}</Pill><Pill tone={disposed ? 'gray' : 'green'} dot>{statusLabels[item.status]}{disposed && item.recoveryAmount !== null ? ` · 回收 ¥${money(item.recoveryAmount, 0)}` : ''}</Pill></View>{item.model && <Text className='item-model'>{item.model}</Text>}</View></View>
    <View className='holding-label'>{disposed ? '生命周期' : '持有'} {m.days === null ? '待补充' : `${m.days} 天`}</View>
    <View className='item-cost'><View><Text className='cost-label'>{disposed ? '实际持有成本' : m.total === null ? '已知投入 · 待补充' : '累计投入'}</Text><Text className='cost-amount'>{(disposed && m.net === null) || (!disposed && m.total === null && !item.expenses.length) ? '待补充' : `¥${money(disposed ? m.net : m.known, 0)}`}</Text></View><View className='cost-right'><Text className='cost-label'>{disposed ? '实际日均成本' : '当前日均投入'}</Text><View><Text className='daily-amount'>{m.daily === null ? '待补充' : `¥${money(m.daily)}`}</Text>{m.daily !== null && <Text className='day-unit'> /天</Text>}</View></View></View>
  </Action>
}
