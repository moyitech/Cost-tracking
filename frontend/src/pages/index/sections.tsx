import { useCallback, useEffect, useState } from 'react'
import { Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { Action, Amount, Empty, ErrorNote, Photo, Sheet, SymbolIcon, useSubmit } from '../../components'
import { canEdit, dailyRanking, isDisposed, Item, metrics, money, roleLabels, Space, statusLabels, today } from '../../domain'
import type { ItemFilter } from '../../domain'
import { LedgerAvatar, SpaceMenuRow } from '../../spaces'
import { FamilyMembers } from '../../family-members'
import { InvitationPanel } from '../../invitations'
import { useLedger } from '../../store'
import { mockEnabled } from '../../services'
import { compareLifecycleEvents, dayLabel, groupByMonth, lifecycleEvents } from '../../lifecycle'

export function Analysis({ items, onFilter }: { items: Item[]; onFilter: (filter: ItemFilter) => void }) {
  if (!items.length) return <View className='page-content secondary-page'><Text className='page-heading'>投入分析</Text><Empty title='还没有可分析的物品' text='添加档案后，投入与状态会在这里呈现。' /></View>
  const purchase = items.reduce((s, i) => s + (i.purchaseAmount ?? 0), 0)
  const extra = items.reduce((s, i) => s + metrics(i).extra, 0)
  const known = purchase + extra
  const unpriced = items.filter(i => i.purchaseAmount === null).length
  const counts = (['active', 'sold', 'retired'] as const).map(status => ({ status, count: items.filter(i => i.status === status).length }))
  const disposed = items.filter(isDisposed)
  const completeDisposed = disposed.filter(i => metrics(i).net !== null)
  const ranking = dailyRanking(items)
  const top = ranking[0]?.daily || 1
  // Wide windows set the overview beside the ranking; phones read them in this order.
  return <View className='page-content secondary-page analysis-page'><Text className='page-heading'>投入分析</Text><View className='analysis-columns'><View className='analysis-column'>
    <View className='analysis-hero'>
      <Text className='analysis-label'>{unpriced ? '已知投入' : '累计投入'}</Text>
      <Amount className={`analysis-total ${money(known).length > 9 ? 'compact-amount' : ''}`} cents={known} />
      <View className='analysis-hero-meta'><Text>{items.length} 件物品</Text>{unpriced > 0 && <Action className='summary-pending-link' label={`${unpriced} 件价格待补充，查看`} onClick={() => onFilter('unpriced')}>{unpriced} 件价格待补充 ›</Action>}</View>
    </View>
    <View className='card analysis-card'>
      <Text className='analysis-card-title'>投入构成</Text>
      {known > 0 && <View className='stack-bar'><View className='stack-segment segment-purchase' style={{ width: `${purchase / known * 100}%` }} />{extra > 0 && <View className='stack-segment segment-extra' style={{ width: `${extra / known * 100}%` }} />}</View>}
      <View className='legend'>
        <View className='legend-item'><View className='legend-dot segment-purchase' /><Text className='legend-label'>购买</Text><Amount className='legend-amount' cents={purchase} short /></View>
        <View className='legend-item'><View className='legend-dot segment-extra' /><Text className='legend-label'>追加支出</Text><Amount className='legend-amount' cents={extra} short /></View>
      </View>
    </View>
    <View className='card analysis-card'>
      <View className='analysis-card-head'><Text className='analysis-card-title'>状态分布</Text><Text className='analysis-asof'>截至 {dayLabel(today())}</Text></View>
      <View className='stack-bar'>{counts.filter(c => c.count).map(c => <View key={c.status} className={`stack-segment segment-${c.status}`} style={{ width: `${c.count / items.length * 100}%` }} />)}</View>
      <View className='legend'>{counts.map(c => <Action key={c.status} className='legend-item legend-action' label={`${statusLabels[c.status]} ${c.count} 件，查看`} onClick={() => onFilter(c.status)}><View className={`legend-dot segment-${c.status}`} /><Text className='legend-label'>{statusLabels[c.status]}</Text><Text className='legend-count'>{c.count}</Text></Action>)}</View>
    </View>
    </View>{(ranking.length > 0 || disposed.length > 0) && <View className='analysis-column'>
    {ranking.length > 0 && <View className='card analysis-card'>
      <Text className='analysis-card-title'>日均成本最高</Text>
      <View className='ranking'>{ranking.map(({ item, daily }) => <Action key={item.id} className='ranking-row' label={`${item.name}，日均 ${money(daily)} 元`} onClick={() => { void Taro.navigateTo({ url: `/pages/detail/index?id=${item.id}` }) }}>
        <Photo src={item.image} fileId={item.imageFileId} presetId={item.imagePresetId} />
        <View className='ranking-main'><View className='ranking-line'><Text className='ranking-name'>{item.name}</Text><Amount className='ranking-amount' cents={daily} unit='/天' /></View><View className='ranking-track'><View className='ranking-fill' style={{ width: `${Math.max(4, daily / top * 100)}%` }} /></View></View>
      </Action>)}</View>
    </View>}
    {disposed.length > 0 && <Action className='card analysis-card disposal-row' label={`已处置实际成本，${disposed.length} 件，查看`} onClick={() => onFilter('history')}>
      <View className='disposal-copy'><Text className='analysis-card-title'>已处置实际成本</Text><Text className='analysis-asof'>{disposed.length} 件{disposed.length > completeDisposed.length ? ` · ${disposed.length - completeDisposed.length} 件待补充` : ''}</Text></View>
      <Amount className='disposal-amount' cents={completeDisposed.reduce((s, i) => s + metrics(i).net!, 0)} short /><Text className='timeline-chevron'>›</Text>
    </Action>}
    </View>}</View>
  </View>
}

export function Records({ items }: { items: Item[] }) {
  const rows = items.flatMap(item => lifecycleEvents(item).map(event => ({ item, event })))
    .sort((a, b) => compareLifecycleEvents(a.event, b.event))
  return <View className='page-content secondary-page records-page'><Text className='page-heading'>物品记录</Text>
    {groupByMonth(rows).map(group => <View className='record-group' key={group.key}>
      <Text className='record-month'>{group.label}</Text>
      <View className='record-rows'>{group.rows.map(({ item, event }) => <Action key={event.id} className='record-row' label={`${event.title}，${item.name}，${dayLabel(event.occurredOn)}，${event.amount}`} onClick={() => { void Taro.navigateTo({ url: `/pages/detail/index?id=${item.id}` }) }}>
        <Photo src={item.image} fileId={item.imageFileId} presetId={item.imagePresetId} />
        <View className='record-main'><Text className='record-title'>{event.title}{event.detail ? ` · ${event.detail}` : ''}</Text><Text className='record-meta'>{event.occurredOn ? `${dayLabel(event.occurredOn)} · ` : ''}{item.name}</Text></View>
        {event.cents === null ? <Text className='record-missing'>待补充</Text> : <View className='record-value'>{event.kind === 'sold' || event.kind === 'retired' ? <Text className='record-value-label'>回收</Text> : null}<Amount className='record-amount' cents={event.cents} /></View>}
      </Action>)}</View>
    </View>)}
    {!rows.length && <Empty title='还没有物品记录' text='购买、追加支出、出售和淘汰会在这里呈现。' />}
  </View>
}

export function Spaces({ space, onAvatar, onItems }: { space: Space; onAvatar: () => void; onItems: () => void }) {
  const { data, execute, remoteState, loadTrash, loadMore, moreLoading, pageError } = useLedger()
  const [modal, setModal] = useState<'trash' | 'members' | 'invite' | null>(null)
  const [, setSheetLayout] = useState(0)
  const sheetLayoutChanged = useCallback(() => setSheetLayout(value => value + 1), [])
  useEffect(() => { setModal(null) }, [space.id])
  const { error, busy, submit } = useSubmit(() => {})
  const deleted = mockEnabled ? data.items.filter(i => i.spaceId === space.id && i.deleted) : remoteState.trashIds.map(id => data.items.find(i => i.id === id)).filter((i): i is Item => !!i && i.deleted)
  const count = data.items.filter(i => i.spaceId === space.id && !i.deleted).length
  const own = space.kind === 'personal'
  const members = mockEnabled ? space.members.length : space.memberCount
  const image = <LedgerAvatar kind={space.kind} src={own ? data.profile?.avatar : space.avatar} fileId={own ? data.profile?.avatarFileId : space.avatarFileId} />
  return <View className='page-content secondary-page spaces-page'>
    <Text className='page-heading'>空间</Text>
    <View className='spaces-columns'><View className='spaces-column'>
    <View className='space-identity-card'>
      <View className='space-identity-main'>
        {space.role === 'admin' ? <Action className={`space-avatar-edit ${own ? '' : 'space-avatar-edit-family'}`} label={own ? '更换个人头像' : '更换家庭头像'} onClick={onAvatar}>{image}<View className='space-avatar-camera'><SymbolIcon name='camera' /></View></Action> : image}
        <View className='space-identity-copy'><Text className='space-identity-title'>{space.name}</Text><View className='space-identity-subtitle'>{own ? <><SymbolIcon name='lock' /><Text>仅自己可见</Text></> : <><Text className='space-role-pill'>{roleLabels[space.role]}</Text><Text>家庭共享空间</Text></>}</View></View>
      </View>
      <View className='space-identity-stats'><Action className='space-stat-action' onClick={onItems}><Text className='space-stat-value'>{count}</Text><Text>件物品</Text></Action>{own ? <Action className='space-stat-link' onClick={onItems}>查看物品<SymbolIcon name='chevron' /></Action> : <Action className='space-stat-action space-stat-members' onClick={() => setModal('members')}>{members === undefined ? <Text>查看成员</Text> : <><Text className='space-stat-value'>{members}</Text><Text>位成员</Text></>}<SymbolIcon name='chevron' /></Action>}</View>
    </View>
    </View><View className='spaces-column'>
    <View className='space-management-card'>
      {!own && <SpaceMenuRow icon='people' title='家庭成员与权限' trailing={members === undefined ? undefined : `${members} 位`} onClick={() => setModal('members')} />}
      {!own && space.role === 'admin' && <SpaceMenuRow icon='invite' title='邀请成员' onClick={() => setModal('invite')} />}
      <SpaceMenuRow icon='trash' title='回收站' trailing={mockEnabled && deleted.length ? String(deleted.length) : undefined} onClick={() => { setModal('trash'); void loadTrash() }} />
    </View>
    <View className='space-privacy-note'><SymbolIcon name={own ? 'shield' : 'lock'} /><Text>{own ? '个人物品不会自动共享到家庭' : space.role === 'viewer' ? '你可以查看物品与记录，暂不支持编辑' : '这里只共享家庭物品，个人空间依然私密'}</Text></View>
    {mockEnabled && <View className='mock-notice'>本地演示 · 数据仅保存在此设备</View>}
    </View></View>
    {modal && <Sheet title={{ trash: '回收站', members: '家庭成员', invite: '邀请成员' }[modal]} className={modal === 'members' ? 'family-members-sheet' : ''} heading={modal === 'members' ? <View className='members-heading'><Text className='members-family-name'>{space.name}</Text>{members !== undefined && <Text className='members-heading-caption'>{members} 位成员</Text>}</View> : undefined} onClose={() => { if (!busy) setModal(null) }}>
      {modal === 'trash' && <>{!canEdit(space) && <Text className='space-sheet-intro'>恢复需要编辑权限。</Text>}{deleted.map(item => <View key={item.id} className='restore-row'><Photo src={item.image} fileId={item.imageFileId} presetId={item.imagePresetId} /><Text className='restore-name'>{item.name}</Text>{canEdit(space) ? <Action className='secondary' loading={busy} onClick={() => void submit(async () => { await execute({ type: 'restore', id: item.id, revision: item.revision }) }, '已恢复')}>恢复</Action> : <Text className='muted small'>仅查看</Text>}</View>)}<ErrorNote message={pageError} />{moreLoading && <Text>正在读取回收站…</Text>}{!mockEnabled && remoteState.trashCursor && <Action className='secondary' loading={moreLoading} onClick={() => void loadMore('trash')}>加载更多</Action>}{!deleted.length && !moreLoading && !pageError && <Empty title='回收站是空的' text='移除的物品可以在这里找回。' />}</>}
      {modal === 'members' && <FamilyMembers space={space} onLayoutChange={sheetLayoutChanged} />}
      {modal === 'invite' && space.role === 'admin' && <InvitationPanel space={space} onLayoutChange={sheetLayoutChanged} />}
      <ErrorNote message={error} />
    </Sheet>}
  </View>
}
