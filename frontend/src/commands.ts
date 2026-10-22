import { audit, canEdit, Expense, isDisposed, Item, ItemInput, Ledger, money, newItem, Role, statusLabels, today, validateDisposal, validateExpense, validateInput } from './domain'

export type Command =
  | { type: 'create'; spaceId: string; input: ItemInput; key: string }
  | { type: 'import'; spaceId: string; entries: { input: ItemInput; key: string }[] }
  | { type: 'edit'; id: string; revision: number; input: ItemInput }
  | { type: 'expense'; id: string; revision: number; expense: Expense }
  | { type: 'dispose'; id: string; revision: number; status: 'sold' | 'retired'; date: string; recovery: number | null; confirmedZero: boolean }
  | { type: 'delete' | 'restore'; id: string; revision: number }
  | { type: 'move'; id: string; revision: number; spaceId: string }
  | { type: 'createSpace'; name: string; key: string }
  | { type: 'joinDemo' }
  | { type: 'invite'; spaceId: string; role: 'editor' | 'viewer'; key: string }
  | { type: 'revokeInvite'; id: string }
  | { type: 'acceptDemoInvite'; id: string; name: string }
  | { type: 'member'; spaceId: string; memberId: string; role: Role | 'remove' }

export function applyCommand(current: Ledger, command: Command): Ledger {
  const data: Ledger = JSON.parse(JSON.stringify(current))
  const writable = (spaceId: string) => {
    const space = data.spaces.find(s => s.id === spaceId)
    if (!canEdit(space)) throw new Error('当前空间为只读或权限已变化，输入已保留')
    return space!
  }
  if (command.type === 'createSpace') {
    if (!command.name.trim()) throw new Error('请填写家庭名称')
    if (!data.spaces.some(s => s.id === command.key)) data.spaces.push({ id: command.key, name: command.name.trim(), kind: 'family', role: 'admin', members: [{ id: 'me', name: '我', role: 'admin' }] })
    return data
  }
  if (command.type === 'joinDemo') {
    if (!data.spaces.some(s => s.id === 'joined-demo')) data.spaces.push({ id: 'joined-demo', name: '周末小家（演示邀请）', kind: 'family', role: 'editor', members: [{ id: 'host', name: '邀请人', role: 'admin' }, { id: 'me', name: '我', role: 'editor' }] })
    return data
  }
  if (command.type === 'invite') {
    const space = writable(command.spaceId)
    if (space.kind !== 'family' || space.role !== 'admin') throw new Error('仅家庭管理者可以邀请成员')
    if (!['editor', 'viewer'].includes(command.role)) throw new Error('当前支持邀请编辑者或查看者')
    data.invitations ||= []
    if (!data.invitations.some(i => i.id === command.key)) data.invitations.unshift({ id: command.key, code: `LOCAL-${command.key.toUpperCase()}`, spaceId: space.id, role: command.role, status: 'pending' })
    return data
  }
  if (command.type === 'revokeInvite' || command.type === 'acceptDemoInvite') {
    const invite = data.invitations?.find(i => i.id === command.id)
    if (!invite) throw new Error('找不到这份本地邀请')
    const space = writable(invite.spaceId)
    if (space.role !== 'admin') throw new Error('仅管理者可操作本地演示邀请')
    if (command.type === 'revokeInvite') {
      if (invite.status !== 'pending') throw new Error('这份邀请已处理')
      invite.status = 'revoked'
    } else {
      if (invite.status === 'revoked') throw new Error('邀请已撤销，不能加入')
      if (invite.status === 'accepted') return data
      if (!command.name.trim()) throw new Error('请填写模拟成员姓名')
      const id = `invite-${invite.id}`
      space.members.push({ id, name: command.name.trim(), role: invite.role })
      invite.status = 'accepted'; invite.memberId = id
    }
    return data
  }
  if (command.type === 'member') {
    const space = writable(command.spaceId)
    if (space.role !== 'admin') throw new Error('仅管理者可以管理成员')
    if (command.memberId === 'me') throw new Error('管理者转交规则待确认，当前不支持修改自己的角色')
    const member = space.members.find(m => m.id === command.memberId)
    if (!member) throw new Error('成员已不在此空间')
    if (member.role === 'admin' || command.role === 'admin') throw new Error('管理者转交规则待确认，当前仅可调整编辑者或查看者')
    if (command.role === 'remove') space.members = space.members.filter(m => m.id !== command.memberId)
    else member.role = command.role
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
  if (item.revision !== command.revision) throw new Error('档案已被其他操作更新，请重新打开后核对；本次输入已保留')
  if (item.deleted && command.type !== 'restore') throw new Error('档案已移入回收站，请先恢复')
  switch (command.type) {
    case 'edit': {
      validateInput(command.input)
      const updated = { ...item, ...command.input }
      updated.expenses.forEach(e => validateExpense(updated, e))
      if (isDisposed(updated)) validateDisposal(updated, updated.disposalDate!, updated.recoveryAmount, true)
      const changed = Object.keys(command.input).filter(k => item[k as keyof Item] !== command.input[k as keyof ItemInput])
      const labels: Record<string, string> = { name: '名称', category: '分类', brand: '品牌', model: '型号', image: '物品图片', purchaseAmount: '购入实付', purchaseDate: '购买日期', location: '位置', channel: '购买渠道', serial: '序列号', warranty: '保修', note: '备注', attachments: '凭证附件' }
      const detail = changed.map(k => {
        if (k === 'image' || k === 'attachments') return `${labels[k]}已更新`
        const display = (value: unknown) => value === null || value === '' ? '待补充' : k === 'purchaseAmount' ? `¥${money(value as number)}` : String(value)
        return `${labels[k]}: ${display(item[k as keyof Item])} → ${display(command.input[k as keyof ItemInput])}`
      }).join('；')
      Object.assign(item, command.input, { name: command.input.name.trim() })
      item.history.unshift(audit('编辑物品资料', today(), detail))
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
