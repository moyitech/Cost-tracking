import { useState } from 'react'
import { Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { Action, Empty, ErrorNote, Field, FooterNote, Pill, SelectField, Sheet, useSubmit } from '../../components'
import { canEdit, isDisposed, Item, metrics, money, roleLabels, Space, statusLabels, today, uid } from '../../domain'
import { InvitationPanel } from '../../invitations'
import { useLedger } from '../../store'

export function Analysis({ items, onFilter }: { items: Item[]; onFilter: (filter: string, value: string) => void }) {
  const known = items.reduce((s, i) => s + metrics(i).known, 0)
  const missing = items.filter(i => i.purchaseAmount === null).length
  const disposed = items.filter(isDisposed)
  const completeDisposed = disposed.filter(i => metrics(i).net !== null)
  const groups = Array.from(new Set(items.map(i => i.category))).map(name => ({ name, count: items.filter(i => i.category === name).length, value: items.filter(i => i.category === name).reduce((s, i) => s + metrics(i).known, 0) })).sort((a, b) => b.value - a.value)
  return <View className='page-content secondary-page'><Text className='section-kicker'>VALUE, OVER TIME</Text><Text className='page-heading'>看见每一份投入</Text><Text className='muted'>当前空间 · {today()} 状态快照</Text>
    <View className='analysis-hero'><Text>{missing ? '已知投入' : '累计投入'}</Text><Text className='analysis-total'>¥{money(known)}</Text><Text className='muted'>{missing ? `${missing} 件购入金额待补充，统计尚不完整` : '所有有效档案 · 从购买以来的全部投入'}</Text></View>
    <View className='stat-grid'>{(['active', 'sold', 'retired'] as const).map(s => <Action className='card stat' key={s} onClick={() => onFilter('status', s)}><Text className='muted'>{statusLabels[s]}</Text><Text className='stat-number'>{items.filter(i => i.status === s).length}<Text className='stat-unit'> 件</Text></Text></Action>)}</View>
    <View className='card analysis-breakdown'><Text className='card-heading'>投入构成</Text><View className='info-row'><Text>已确认购入</Text><Text>¥{money(items.reduce((s, i) => s + (i.purchaseAmount ?? 0), 0))}</Text></View><View className='info-row'><Text>有效追加支出</Text><Text>¥{money(items.reduce((s, i) => s + metrics(i).extra, 0))}</Text></View><Text className='small muted'>金额缺失的物品仅计入已知支出；在用物品从购买日起持续按天分摊。</Text></View>
    <View className='card category-analysis'><View className='row spread'><Text className='card-heading'>类别投入</Text><Text className='small muted'>点击查看物品</Text></View>{groups.map(group => <Action className='category-row' key={group.name} onClick={() => onFilter('category', group.name)}><View className='row spread'><Text>{group.name} <Text className='muted'>· {group.count} 件</Text></Text><Text>¥{money(group.value, 0)}</Text></View><View className='bar-track'><View className='bar-fill' style={{ width: `${known ? group.value / known * 100 : 0}%` }} /></View></Action>)}<Text className='small muted'>占比基于当前空间的已知投入。</Text></View>
    <Action className='card disposal-summary' onClick={() => onFilter('status', 'history')}><View className='row spread'><Text>已处置实际成本</Text><Text>查看 {disposed.length} 件 ›</Text></View><Text className='stat-number'>¥{money(completeDisposed.reduce((s, i) => s + metrics(i).net!, 0))}</Text><Text className='small muted'>全生命周期投入 − 实际回收 · {disposed.length - completeDisposed.length} 件待补充</Text></Action>
    {!items.length && <Empty title='还没有可分析的物品' text='添加档案后，投入与状态会在这里呈现。' />}
  </View>
}

export function Records({ items }: { items: Item[] }) {
  const rows = items.flatMap(item => item.history.map(event => ({ item, event }))).sort((a, b) => (b.event.occurredOn || '').localeCompare(a.event.occurredOn || '') || b.event.recordedAt.localeCompare(a.event.recordedAt))
  return <View className='page-content secondary-page'><Text className='section-kicker'>A LIFE WELL RECORDED</Text><Text className='page-heading'>物品的时间线</Text><Text className='muted'>当前空间 · 按实际发生日期倒序排列</Text><View className='record-list'>{rows.map(({ item, event }) => <Action key={`${item.id}-${event.id}`} className='record-card' onClick={() => Taro.navigateTo({ url: `/pages/detail/index?id=${item.id}` })}><View className='row spread'><Text className='record-date'>{event.occurredOn || '发生日期待补充'}</Text><Text className='small muted'>{event.actor}</Text></View><Text className='record-title'>{event.title}</Text><Text className='record-item'>{item.name} ›</Text><Text className='small muted'>记录于 {event.recordedAt.slice(0, 10)} · 完整修改详情见物品档案</Text></Action>)}</View>{!rows.length && <Empty title='时间线还很安静' text='购买、维护和状态变化都会留下记录。' />}</View>
}

export function Spaces({ space }: { space: Space }) {
  const { data, execute, setSpaceId } = useLedger()
  const [modal, setModal] = useState<'create' | 'join' | 'trash' | 'members' | 'invite' | null>(null)
  const [name, setName] = useState(''); const [code, setCode] = useState('')
  const [createKey, setCreateKey] = useState(uid)
  const { error, busy, submit } = useSubmit(() => { setModal(null); setCreateKey(uid()); setName('') })
  const localInvite = data.invitations?.find(i => i.code === code.trim().toUpperCase())
  const invitedSpace = data.spaces.find(s => s.id === localInvite?.spaceId)
  const deleted = data.items.filter(i => i.spaceId === space.id && i.deleted)
  const count = data.items.filter(i => i.spaceId === space.id && !i.deleted).length
  return <View className='page-content secondary-page'><Text className='section-kicker'>A PLACE FOR WHAT MATTERS</Text><Text className='page-heading'>物有所属</Text><View className='card space-profile'><View className='space-avatar'>{space.kind === 'personal' ? '我' : '家'}</View><Text className='space-title'>{space.name}</Text><View className='row'><Pill tone='green'>{space.kind === 'personal' ? '仅自己可见' : roleLabels[space.role]}</Pill><Pill>{count} 件物品</Pill></View><Text className='muted'>{space.kind === 'personal' ? '你的私人物品，与你独有的故事。' : '共享档案与历史，按角色共同维护。'}</Text></View>
    <View className='card menu-list'><Action onClick={() => setModal('create')}><Text>＋ 创建家庭空间</Text><Text>›</Text></Action><Action onClick={() => setModal('join')}><Text>加入家庭</Text><Text>›</Text></Action>{space.kind === 'family' && <><Action onClick={() => setModal('members')}><Text>家庭成员与权限</Text><Text>{space.members.length} 人 ›</Text></Action>{space.role === 'admin' && <Action onClick={() => setModal('invite')}><Text>邀请成员</Text><Text>›</Text></Action>}</>}<Action onClick={() => setModal('trash')}><Text>回收站</Text><Text>{deleted.length} 件 ›</Text></Action></View>
    <View className='notice'><Text className='notice-title'>关于空间与隐私</Text><Text>加入家庭不会公开个人档案。个人物品迁入家庭前，会再次确认共享范围。</Text></View>
    <View className='mock-notice'>本地演示模式 · 数据仅保存在当前设备。家庭与成员为模拟数据；邀请支持本机生成、撤销与模拟加入；跨设备邀请、登录和真实权限由后端接入。</View>
    <FooterNote>物序 · 让每件物品的价值有迹可循</FooterNote>
    {modal && <Sheet title={{ create: '创建家庭空间', join: '接受家庭邀请', trash: '回收站', members: '家庭成员', invite: '邀请成员（演示）' }[modal]} onClose={() => setModal(null)}>
      {modal === 'create' && <><Field label='家庭名称' value={name} onChange={setName} placeholder='例如：我们的家' required /><Text className='form-intro'>创建后你将成为管理者，个人档案保持原样。</Text><Action className='primary submit-button' loading={busy} onClick={() => void submit(async () => { await execute({ type: 'createSpace', name, key: createKey }); setSpaceId(createKey) })}>创建并进入</Action></>}
      {modal === 'join' && <><Text className='form-intro'>输入本机生成的 LOCAL 邀请码可查看对应家庭。体验首次加入可使用 DEMO-FAMILY；其他设备的邀请码需要后端接入。</Text><Field label='邀请码' value={code} onChange={setCode} placeholder='输入邀请码' />{code.trim() === 'DEMO-FAMILY' ? <View className='notice'><Text className='notice-title'>周末小家 · 邀请人：家庭管理者</Text><Text>以「编辑者」身份加入，可维护共享物品。你的个人档案不会公开。</Text><Action className='primary submit-button' loading={busy} onClick={() => void submit(async () => { await execute({ type: 'joinDemo' }); setSpaceId('joined-demo') })}>我同意加入这个家庭</Action></View> : localInvite && invitedSpace ? <View className='notice'><Text className='notice-title'>{invitedSpace.name} · {roleLabels[localInvite.role]}</Text>{localInvite.status === 'revoked' ? <ErrorNote message='这份本地邀请已撤销' /> : <><Text>当前用户已是该家庭成员。可进入家庭；模拟其他成员加入请在该家庭的邀请面板操作。</Text><Action className='primary submit-button' onClick={() => { setSpaceId(invitedSpace.id); setModal(null) }}>进入已加入的家庭</Action></>}</View> : code && <ErrorNote message='找不到本机邀请码，请核对或使用 DEMO-FAMILY' />}</>}
      {modal === 'trash' && <><Text className='form-intro'>删除的档案不参与统计。演示版不自动清理，恢复期与永久删除规则待确认。</Text>{deleted.map(item => <View key={item.id} className='restore-row'><Text>{item.name}</Text><Action className='secondary' disabled={!canEdit(space)} loading={busy} onClick={() => void submit(async () => { await execute({ type: 'restore', id: item.id, revision: item.revision }) })}>恢复</Action></View>)}{!deleted.length && <Empty title='回收站是空的' text='移除的物品可以在这里找回。' />}</>}
      {modal === 'members' && <>{space.members.map(member => <View className='member-row' key={member.id}><View><Text>{member.name}</Text><Text className='small muted'>{member.id === 'me' ? ' · 当前用户' : ''}</Text></View>{space.role === 'admin' && member.id !== 'me' && member.role !== 'admin' ? <SelectField label='角色' value={roleLabels[member.role]} options={['编辑者', '查看者', '移除成员']} onChange={(_, index) => { void (async () => { const result = await Taro.showModal({ title: '确认成员权限变更', content: index === 2 ? '此成员将失去家庭空间访问权限，历史操作仍会保留。' : '新的权限将立即生效。' }); if (result.confirm) await submit(() => execute({ type: 'member', spaceId: space.id, memberId: member.id, role: (['editor', 'viewer', 'remove'] as const)[index] })) })() }} /> : <Pill tone='green'>{roleLabels[member.role]}</Pill>}</View>)}<Text className='form-intro'>查看者仅可查询。管理者转交与家庭迁出规则尚待确认。</Text></>}
      {modal === 'invite' && <InvitationPanel space={space} />}
      <ErrorNote message={error} />
    </Sheet>}
  </View>
}
