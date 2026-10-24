import type { Command } from './commands'
import type { Ledger } from './domain'
import { mergeItems } from './ledger-cache'

export const itemCommand = (command: Command) => ['create', 'import', 'edit', 'expense', 'dispose', 'delete', 'restore', 'move'].includes(command.type)
export function mergeCommandResult(current: Ledger, next: Ledger, command: Command): Ledger {
  const merged = itemCommand(command) ? mergeItems(current, next.items) : { ...current, spaces: next.spaces }
  return { ...merged, ...(command.type === 'avatar' && command.scope === 'personal' ? { profile: next.profile } : {}), resultSpaceId: next.resultSpaceId }
}
export function affectedSpaces(current: Ledger, command: Command): string[] {
  if (command.type !== 'move') return []
  return [...new Set([current.items.find(i => i.id === command.id)?.spaceId, command.spaceId].filter((id): id is string => !!id))]
}
export const invitationMessages: Record<string, string> = {
  active: '邀请有效', expired: '邀请已过期，请联系管理者生成新邀请', revoked: '邀请已撤销', unavailable: '邀请者已无管理权限', new_invitation_required: '你曾被移出该家庭，请管理者生成新邀请后重新加入',
}


/** Keep role groups stable for Mock and loaded pages; the API sorts before pagination. */
export function orderedMembers<T extends { id: string; role: 'admin' | 'editor' | 'viewer' }>(members: T[], selfId?: string): T[] {
  const rank = { admin: 0, editor: 1, viewer: 2 }
  return [...members].sort((a, b) => rank[a.role] - rank[b.role] || Number(b.id === selfId) - Number(a.id === selfId))
}
export function canManageMember(me: { id: string; role: string } | null, member: { id: string; role: string }): boolean {
  return me?.role === 'admin' && member.role !== 'admin' && member.id !== me.id
}
