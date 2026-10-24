import { useCallback, useEffect, useState } from 'react'
import { Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { Action, Empty, ErrorNote, Sheet, SymbolIcon, useSubmit } from '../../components'
import { canEdit, isDisposed, Item, metrics, money, roleLabels, Space, statusLabels } from '../../domain'
import { LedgerAvatar, SpaceMenuRow } from '../../spaces'
import { FamilyMembers } from '../../family-members'
import { InvitationPanel } from '../../invitations'
import { useLedger } from '../../store'
import { mockEnabled } from '../../services'
import { compareLifecycleEvents, lifecycleEvents } from '../../lifecycle'

export function Analysis({ items, onFilter }: { items: Item[]; onFilter: (filter: string, value: string) => void }) {
  const known = items.reduce((s, i) => s + metrics(i).known, 0)
  const missing = items.filter(i => i.purchaseAmount === null).length
  const disposed = items.filter(isDisposed)
  const completeDisposed = disposed.filter(i => metrics(i).net !== null)
  return <View className='page-content secondary-page'><Text className='page-heading'>投入分析</Text>
    <View className='analysis-hero'><Text>{missing ? '已知投入' : '累计投入'}</Text><Text className='analysis-total'>¥{money(known)}</Text>{missing > 0 && <Text className='muted'>{missing} 件价格待补充</Text>}</View>
    <View className='stat-grid'>{(['active', 'sold', 'retired'] as const).map(s => <Action className='card stat' key={s} onClick={() => onFilter('status', s)}><Text className='muted'>{statusLabels[s]}</Text><Text className='stat-number'>{items.filter(i => i.status === s).length}<Text className='stat-unit'> 件</Text></Text></Action>)}</View>
    <View className='card analysis-breakdown'><Text className='card-heading'>投入构成</Text><View className='info-row'><Text>购买支出</Text><Text>¥{money(items.reduce((s, i) => s + (i.purchaseAmount ?? 0), 0))}</Text></View><View className='info-row'><Text>追加支出</Text><Text>¥{money(items.reduce((s, i) => s + metrics(i).extra, 0))}</Text></View></View>
    <Action className='card disposal-summary' onClick={() => onFilter('status', 'history')}><View className='row spread'><Text>已处置实际成本</Text><Text>查看 {disposed.length} 件 ›</Text></View><Text className='stat-number'>¥{money(completeDisposed.reduce((s, i) => s + metrics(i).net!, 0))}</Text>{disposed.length > completeDisposed.length && <Text className='small muted'>{disposed.length - completeDisposed.length} 件待补充</Text>}</Action>
    {!items.length && <Empty title='还没有可分析的物品' text='添加档案后，投入与状态会在这里呈现。' />}
  </View>
}

export function Records({ items }: { items: Item[] }) {
  const rows = items.flatMap(item => lifecycleEvents(item).map(event => ({ itemId: item.id, name: item.name, event })))
    .sort((a, b) => compareLifecycleEvents(a.event, b.event))
  return <View className='page-content secondary-page'><Text className='page-heading'>物品记录</Text><View className='record-list'>{rows.map(({ itemId, name, event }) => <Action key={event.id} className='record-card' onClick={() => { void Taro.navigateTo({ url: `/pages/detail/index?id=${itemId}` }) }}><View className='row spread'><Text className='record-date'>{event.occurredOn || '发生日期待补充'}</Text><Text className='small muted'>{event.amount}</Text></View><Text className='record-title'>{event.title}{event.detail ? ` · ${event.detail}` : ''}</Text><Text className='record-item'>{name} ›</Text></Action>)}</View>{!rows.length && <Empty title='还没有物品记录' text='购买、追加支出、出售和淘汰会在这里呈现。' />}</View>
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
    <View className='space-identity-card'>
      <View className='space-identity-main'>
        {space.role === 'admin' ? <Action className={`space-avatar-edit ${own ? '' : 'space-avatar-edit-family'}`} label={own ? '更换个人头像' : '更换家庭头像'} onClick={onAvatar}>{image}<View className='space-avatar-camera'><SymbolIcon name='camera' /></View></Action> : image}
        <View className='space-identity-copy'><Text className='space-identity-title'>{space.name}</Text><View className='space-identity-subtitle'>{own ? <><SymbolIcon name='lock' /><Text>仅自己可见</Text></> : <><Text className='space-role-pill'>{roleLabels[space.role]}</Text><Text>家庭共享空间</Text></>}</View></View>
      </View>
      <View className='space-identity-stats'><Action className='space-stat-action' onClick={onItems}><Text className='space-stat-value'>{count}</Text><Text>件物品</Text></Action>{own ? <Action className='space-stat-link' onClick={onItems}>查看物品<SymbolIcon name='chevron' /></Action> : <Action className='space-stat-action space-stat-members' onClick={() => setModal('members')}>{members === undefined ? <Text>查看成员</Text> : <><Text className='space-stat-value'>{members}</Text><Text>位成员</Text></>}<SymbolIcon name='chevron' /></Action>}</View>
    </View>
    <Text className='space-management-heading'>空间管理</Text>
    <View className='space-management-card'>
      {!own && <SpaceMenuRow icon='people' title='家庭成员与权限' caption='查看家人，管理自己的家庭昵称' trailing={members === undefined ? undefined : `${members} 位`} onClick={() => setModal('members')} />}
      {!own && space.role === 'admin' && <SpaceMenuRow icon='invite' title='邀请成员' caption='邀请家人，一起整理日常物品' onClick={() => setModal('invite')} />}
      <SpaceMenuRow icon='trash' title='回收站' caption='找回暂时移除的物品' trailing={mockEnabled && deleted.length ? String(deleted.length) : undefined} onClick={() => { setModal('trash'); void loadTrash() }} />
    </View>
    <View className='space-privacy-note'><SymbolIcon name={own ? 'shield' : 'lock'} /><Text>{own ? '个人物品不会自动共享到家庭' : space.role === 'viewer' ? '你可以查看物品与记录，暂不支持编辑' : '这里只共享家庭物品，个人空间依然私密'}</Text></View>
    {mockEnabled && <View className='mock-notice'>本地演示 · 数据仅保存在此设备</View>}
    {modal && <Sheet title={{ trash: '回收站', members: '家庭成员', invite: '邀请成员' }[modal]} className={modal === 'members' ? 'family-members-sheet' : ''} heading={modal === 'members' ? <View className='members-heading'><Text className='members-eyebrow'>用本 · 家庭共享</Text><Text className='members-family-name'>{space.name}</Text><Text className='members-heading-caption'>家庭成员 · 一起记录生活</Text></View> : undefined} onClose={() => { if (!busy) setModal(null) }}>
      {modal === 'trash' && <><Text className='space-sheet-intro'>{space.name} · {canEdit(space) ? '移除的物品，可以在这里找回。' : '你可以查看，恢复操作需要编辑权限。'}</Text>{deleted.map(item => <View key={item.id} className='restore-row'><Text>{item.name}</Text>{canEdit(space) ? <Action className='secondary' loading={busy} onClick={() => void submit(async () => { await execute({ type: 'restore', id: item.id, revision: item.revision }) })}>恢复</Action> : <Text className='muted small'>仅查看</Text>}</View>)}<ErrorNote message={pageError} />{moreLoading && <Text>正在读取回收站…</Text>}{!mockEnabled && remoteState.trashCursor && <Action className='secondary' loading={moreLoading} onClick={() => void loadMore('trash')}>加载更多</Action>}{!deleted.length && !moreLoading && !pageError && <Empty title='回收站是空的' text='移除的物品可以在这里找回。' />}</>}
      {modal === 'members' && <FamilyMembers space={space} onLayoutChange={sheetLayoutChanged} />}
      {modal === 'invite' && space.role === 'admin' && <InvitationPanel space={space} onLayoutChange={sheetLayoutChanged} />}
      <ErrorNote message={error} />
    </Sheet>}
  </View>
}
