import { audit, canEdit, Expense, isDisposed, Item, ItemInput, Ledger, money, newItem, Role, statusLabels, stripRetiredItemFields, today, validateDisposal, validateExpense, validateInput } from './domain'

export type Command =
  | { type: 'avatar'; scope: 'personal' | 'family'; spaceId: string; image: string; fileId?: string }
  | { type: 'create'; spaceId: string; input: ItemInput; key: string }
  | { type: 'import'; spaceId: string; entries: { input: ItemInput; key: string }[] }
  | { type: 'edit'; id: string; revision: number; input: ItemInput }
  | { type: 'expense'; id: string; revision: number; expense: Expense }
  | { type: 'dispose'; id: string; revision: number; status: 'sold' | 'retired'; date: string; recovery: number | null; confirmedZero: boolean }
  | { type: 'delete' | 'restore'; id: string; revision: number }
  | { type: 'move'; id: string; revision: number; spaceId: string }
  | { type: 'createSpace'; name: string; nickname: string; key: string }
  | { type: 'joinDemo'; nickname: string }
  | { type: 'acceptInvite'; token: string; nickname: string; key: string }
  | { type: 'nickname'; spaceId: string; nickname: string; revision: number }
  | { type: 'invite'; spaceId: string; role: 'editor' | 'viewer'; key: string }
  | { type: 'revokeInvite'; id: string; spaceId?: string }
  | { type: 'acceptDemoInvite'; id: string; name: string }
  | { type: 'member'; spaceId: string; memberId: string; role: Role | 'remove'; revision?: number }

export function applyCommand(current: Ledger, command: Command): Ledger {
  const data: Ledger = JSON.parse(JSON.stringify(current))
  const writable = (spaceId: string) => {
    const space = data.spaces.find(s => s.id === spaceId)
    if (!canEdit(space)) throw new Error('当前空间为只读或权限已变化，输入已保留')
    return space!
  }
  delete data.resultSpaceId
  if (command.type === 'avatar') {
    const space = data.spaces.find(s => s.id === command.spaceId)
    if (!space || space.kind !== command.scope || space.role !== 'admin') throw new Error('仅空间管理者可以更换头像')
    if (command.scope === 'personal') data.profile = { ...(data.profile || { id: 'me', displayName: '我' }), avatar: command.image || undefined, avatarFileId: command.fileId }
    else { space.avatar = command.image || undefined; space.avatarFileId = command.fileId }
    return data
  }
  if (command.type === 'acceptInvite') {
    const invite = data.invitations?.find(i => i.code === command.token.trim().toUpperCase())
    if (!invite) throw new Error('找不到本机邀请码')
    if (invite.status === 'revoked') throw new Error('邀请已撤销')
    if (invite.expiresAt && Date.parse(invite.expiresAt) <= Date.now()) throw new Error('邀请已过期')
    if (!command.nickname.trim()) throw new Error('请填写家庭昵称')
    data.resultSpaceId = invite.spaceId
    return data
  }
  if (command.type === 'nickname') {
    const space = data.spaces.find(s => s.id === command.spaceId)
    const member = space?.members.find(m => m.id === 'me')
    if (!member || !command.nickname.trim()) throw new Error('请填写家庭昵称')
    if ((member.revision || 1) !== command.revision) throw new Error('成员资料已更新，请重新加载')
    member.name = command.nickname.trim(); member.revision = (member.revision || 1) + 1
    return data
  }
  if (command.type === 'createSpace') {
    if (!command.nickname.trim()) throw new Error('请填写家庭昵称')
    data.resultSpaceId = command.key
    if (!command.name.trim()) throw new Error('请填写家庭名称')
    if (!data.spaces.some(s => s.id === command.key)) data.spaces.push({ id: command.key, name: command.name.trim(), kind: 'family', role: 'admin', members: [{ id: 'me', name: command.nickname.trim(), role: 'admin' }] })
    return data
  }
  if (command.type === 'joinDemo') {
    if (!command.nickname.trim()) throw new Error('请填写家庭昵称')
    data.resultSpaceId = 'joined-demo'
    if (!data.spaces.some(s => s.id === 'joined-demo')) data.spaces.push({ id: 'joined-demo', name: '周末小家（演示邀请）', kind: 'family', role: 'editor', members: [{ id: 'host', name: '邀请人', role: 'admin' }, { id: 'me', name: command.nickname.trim(), role: 'editor' }] })
    return data
  }
  if (command.type === 'invite') {
    const space = writable(command.spaceId)
    if (space.kind !== 'family' || space.role !== 'admin') throw new Error('仅家庭管理者可以邀请成员')
    if (!['editor', 'viewer'].includes(command.role)) throw new Error('当前支持邀请编辑者或查看者')
    data.invitations ||= []
    if (!data.invitations.some(i => i.id === command.key)) data.invitations.unshift({ id: command.key, code: `LOCAL-${command.key.toUpperCase()}`, spaceId: space.id, role: command.role, status: 'pending', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(), acceptedMembers: [] })
    return data
  }
  if (command.type === 'revokeInvite' || command.type === 'acceptDemoInvite') {
    const invite = data.invitations?.find(i => i.id === command.id)
    if (!invite) throw new Error('找不到这份本地邀请')
    const space = writable(invite.spaceId)
    if (space.role !== 'admin') throw new Error('仅管理者可操作本地演示邀请')
    if (command.type === 'revokeInvite') {
      invite.status = 'revoked'
    } else {
      if (invite.status === 'revoked') throw new Error('邀请已撤销，不能加入')
      if (invite.expiresAt && Date.parse(invite.expiresAt) <= Date.now()) throw new Error('邀请已过期')
      if (!command.name.trim()) throw new Error('请填写模拟成员姓名')
      const id = `demo-${command.name.trim()}`
      const removedAt = data.removals?.[`${space.id}:${id}`]
      if (removedAt && (!invite.createdAt || invite.createdAt <= removedAt)) throw new Error('请管理者生成新邀请后重新加入')
      if (!space.members.some(m => m.id === id)) space.members.push({ id, name: command.name.trim(), role: invite.role })
      invite.acceptedMembers = [...new Set([...(invite.acceptedMembers || []), id])]; invite.memberId = id
    }
    return data
  }
  if (command.type === 'member') {
    const space = writable(command.spaceId)
    if (space.role !== 'admin') throw new Error('仅管理者可以管理成员')
    if (command.memberId === 'me') throw new Error('管理者转交规则待确认，当前不支持修改自己的角色')
    const member = space.members.find(m => m.id === command.memberId)
    if (!member) throw new Error('成员已不在此空间')
    if (command.revision !== undefined && command.revision !== (member.revision || 1)) throw new Error('成员资料已更新，请重新加载')
    if (member.role === 'admin' || command.role === 'admin') throw new Error('管理者转交规则待确认，当前仅可调整编辑者或查看者')
    if (command.role === 'remove') { space.members = space.members.filter(m => m.id !== command.memberId); data.removals ||= {}; data.removals[`${space.id}:${command.memberId}`] = new Date().toISOString() }
    else { member.role = command.role; member.revision = (member.revision || 1) + 1 }
    return data
  }
  if (command.type === 'create' || command.type === 'import') {
    writable(command.spaceId)
    const entries = command.type === 'create' ? [{ input: command.input, key: command.key }] : command.entries
    for (const entry of entries) {
      if (data.items.some(i => i.importKey === entry.key)) continue
      const item = newItem(entry.input, command.spaceId)
      item.importKey = entry.key
      data.items.unshift(item)
    }
    return data
  }
  const item = data.items.find(i => i.id === command.id)
  if (!item) throw new Error('找不到这件物品')
  const source = writable(item.spaceId)
  if (item.revision !== command.revision) throw new Error('档案已被其他操作更新；输入已保留，请核对后再保存')
  if (item.deleted && command.type !== 'restore') throw new Error('档案已移入回收站，请先恢复')
  switch (command.type) {
    case 'edit': {
      const input = stripRetiredItemFields(command.input)
      validateInput(input)
      const updated = { ...item, ...input }
      updated.expenses.forEach(e => validateExpense(updated, e))
      if (isDisposed(updated)) validateDisposal(updated, updated.disposalDate!, updated.recoveryAmount, true)
      Object.assign(item, input, { name: input.name.trim() })
      break
    }
    case 'expense': {
      validateExpense(item, command.expense)
      const existing = item.expenses.findIndex(e => e.id === command.expense.id)
      const before = existing < 0 ? null : item.expenses[existing]
      if (existing < 0) item.expenses.push(command.expense)
      else item.expenses[existing] = command.expense
      item.history.unshift(audit(`${before ? '更正' : '追加'}${command.expense.category}支出`, command.expense.date, `${before ? `原金额 ¥${(before.amount / 100).toFixed(2)} → ` : ''}¥${(command.expense.amount / 100).toFixed(2)} · ${command.expense.note}`))
      break
    }
    case 'dispose':
      validateDisposal(item, command.date, command.recovery, command.confirmedZero)
      item.history.unshift(audit(isDisposed(item) ? '更正处置信息' : '登记处置', command.date, `${statusLabels[item.status]} → ${statusLabels[command.status]}；回收 ${item.recoveryAmount === null ? '未知' : item.recoveryAmount / 100} → ¥${command.recovery! / 100}；处置日期 ${item.disposalDate ?? '无'} → ${command.date}`))
      item.status = command.status; item.disposalDate = command.date; item.recoveryAmount = command.recovery
      break
    case 'delete': case 'restore':
      item.deleted = command.type === 'delete'
      item.history.unshift(audit(item.deleted ? '移入回收站' : '恢复档案'))
      break
    case 'move': {
      const target = writable(command.spaceId)
      if (source.kind !== 'personal' || target.kind !== 'family') throw new Error('目前支持个人物品迁入家庭；家庭迁出规则待确认')
      item.history.unshift(audit('迁入家庭空间', today(), `${source.name} → ${target.name}；历史与凭证一并可见`))
      item.spaceId = target.id
      break
    }
    default: throw new Error('不支持此操作，请刷新后重试')
  }
  item.revision += 1
  return data
}
