import { useEffect, useRef, useState } from 'react'
import { Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { Action, ErrorNote, Field, Sheet, useSubmit } from './components'
import { Space, roleLabels } from './domain'
import { familyApi, FamilyMember, mockEnabled } from './services'
import { canManageMember, orderedMembers } from './family-state'
import { useLedger } from './store'
import { LedgerAvatar } from './spaces'

const roleDescriptions = { admin: '家庭管理者', editor: '可添加、整理和编辑家庭物品', viewer: '仅查看家庭物品与记录' }

export function FamilyMembers({ space, onLayoutChange }: { space: Space; onLayoutChange: () => void }) {
  const { data, execute } = useLedger()
  const [me, setMe] = useState<FamilyMember | null>(null)
  const [members, setMembers] = useState<FamilyMember[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loadError, setLoadError] = useState(''); const [loading, setLoading] = useState(false)
  const [nickname, setNickname] = useState('')
  const [editingNickname, setEditingNickname] = useState(false)
  const [nicknameError, setNicknameError] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const generation = useRef(0)
  const { busy, error, submit } = useSubmit(() => {})
  const load = async (more = false) => {
    const run = ++generation.current; setLoading(true); setLoadError('')
    try {
      const [page, own] = mockEnabled ? (() => {
        const items = space.members.map(m => ({ id: m.id, user_id: m.id, display_name: m.name, role: m.role, revision: m.revision || 1 }))
        return [{ items, next_cursor: null }, items.find(m => m.user_id === 'me') || null] as const
      })() : await Promise.all([familyApi.members(space.id, more ? cursor : null), familyApi.me(space.id)])
      if (run !== generation.current) return
      setMe(own)
      setMembers(old => more ? [...old, ...page.items.filter(m => !old.some(o => o.id === m.id))] : page.items)
      setCursor(page.next_cursor)
    } catch (e) {
      if (run === generation.current) {
        setLoadError(e instanceof Error ? e.message : '成员读取失败')
        if (e && typeof e === 'object' && 'status' in e && [403, 404].includes(Number(e.status))) {
          setMembers([]); setMe(null); setCursor(null); setSelectedId(null); setEditingNickname(false)
        }
      }
    } finally { if (run === generation.current) setLoading(false) }
  }
  useEffect(() => { void load(); return () => { generation.current++ } }, [space.id, space.members])
  // Async rows and status messages must trigger the owning native Sheet's measurement.
  useEffect(() => { onLayoutChange() }, [members, me, cursor, loading, loadError, error, onLayoutChange])
  const selected = members.find(m => m.id === selectedId)
  useEffect(() => { if (selected && !canManageMember(me, selected)) setSelectedId(null) }, [me, selected])
  const run = (action: () => Promise<unknown>) => submit(async () => { try { await action() } finally { if (!mockEnabled) await load() } })
  const changeRole = async (member: FamilyMember, role: 'editor' | 'viewer' | 'remove') => {
    if (busy || loading || !canManageMember(me, member) || role === member.role) return
    const result = await Taro.showModal({
      title: role === 'remove' ? `移除「${member.display_name}」？` : `将「${member.display_name}」设为${roleLabels[role]}？`,
      content: role === 'remove' ? '移除后将无法访问家庭，再次加入需要使用移除后生成的新邀请。' : `${roleDescriptions[role]}，新的权限立即生效。`,
      confirmText: role === 'remove' ? '确认移除' : '确认修改',
    })
    if (result.confirm) await run(async () => {
      await execute({ type: 'member', spaceId: space.id, memberId: member.id, revision: member.revision, role })
      setSelectedId(null)
    })
  }
  return <View className='family-members'>
    <View className='members-list'>
      {orderedMembers(members, me?.id).map(m => <View className='family-person' key={m.id}>
        <View className={`member-avatar${m.role === 'admin' ? ' member-avatar-admin' : ''}`}>{m.avatar_file_id || (mockEnabled && m.user_id === 'me' && data.profile?.avatar) ? <LedgerAvatar src={mockEnabled && m.user_id === 'me' ? data.profile?.avatar : undefined} fileId={m.avatar_file_id || undefined} size='medium' fallback={Array.from(m.display_name.trim())[0] || '家'} /> : Array.from(m.display_name.trim())[0] || '家'}</View>
        <View className='member-identity'><View className='member-name-line'><Text className='member-name'>{m.display_name}</Text>{m.id === me?.id && <Text className='member-self'>我</Text>}</View><Text className='member-description'>{roleDescriptions[m.role]}</Text></View>
        {canManageMember(me, m) ? <Action className='member-options' label={`管理${m.display_name}的权限`} disabled={busy || loading} onClick={() => setSelectedId(m.id)}>···</Action> : <Text className='member-role-badge'>{roleLabels[m.role]}</Text>}
      </View>)}
    </View>
    {cursor && <Action loading={loading} className='members-more' onClick={() => void load(true)}>加载更多成员</Action>}
    {me && <Action className='member-nickname-entry' disabled={busy} onClick={() => { setNickname(me.display_name); setNicknameError(''); setEditingNickname(true) }}><View><Text className='member-entry-title'>我的家庭昵称</Text><Text className='member-entry-hint'>家人会看到这个名字</Text></View><Text className='member-entry-link'>修改 ›</Text></Action>}
    {loading && <Text className='member-load-state'>正在读取成员…</Text>}
    {loadError && <Action className='secondary members-more' onClick={() => void load()}>重新加载成员</Action>}
    <ErrorNote message={loadError || (!editingNickname && !selected ? error : '')} />
    {me && <Text className='members-footnote'>{me.role === 'admin' ? '管理者可调整其他成员的权限' : me.role === 'editor' ? '你可以添加和编辑家庭物品' : '你可以查看家庭物品与记录'}</Text>}
    {editingNickname && me && <Sheet title='修改家庭昵称' nested className='member-edit-sheet' onClose={() => { if (!busy) setEditingNickname(false) }}>
      <Text className='member-panel-hint'>家人会用这个名字认出你，仅在当前家庭显示。</Text>
      <View className={nicknameError ? 'member-nickname-invalid' : ''}><Field label='家庭昵称' value={nickname} disabled={busy} onChange={value => { setNickname(value); setNicknameError('') }} placeholder='填写家庭昵称' required /></View>
      <ErrorNote message={nicknameError || error} />
      <Action className='primary submit-button' loading={busy} onClick={() => {
        const value = nickname.trim()
        if (!value || Array.from(value).length > 100) { setNicknameError(value ? '家庭昵称不能超过100个字符' : '请填写家庭昵称'); return }
        if (value === me.display_name) { setEditingNickname(false); return }
        void run(async () => { await execute({ type: 'nickname', spaceId: space.id, nickname: value, revision: me.revision }); setEditingNickname(false) })
      }}>保存昵称</Action>
    </Sheet>}
    {selected && canManageMember(me, selected) && <Sheet title='成员权限' nested className='member-permissions-sheet' onClose={() => { if (!busy) setSelectedId(null) }}>
      <Text className='member-panel-name'>{selected.display_name}</Text><Text className='member-panel-hint'>选择这位成员可以在家庭里做什么。</Text>
      {(['editor', 'viewer'] as const).map(role => <Action key={role} className={`member-permission-option${selected.role === role ? ' selected' : ''}`} disabled={busy || loading} onClick={() => void changeRole(selected, role)}><View><Text className='member-permission-title'>{roleLabels[role]}</Text><Text className='member-description'>{roleDescriptions[role]}</Text></View><Text className='member-permission-check'>{selected.role === role ? '✓' : '○'}</Text></Action>)}
      <Action className='member-remove' disabled={busy || loading} onClick={() => void changeRole(selected, 'remove')}>移除成员</Action>
      <ErrorNote message={error} />
    </Sheet>}
  </View>
}
