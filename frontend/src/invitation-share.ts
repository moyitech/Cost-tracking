export function invitationShareMessage(dataset?: { token?: string; family?: string }, imageUrl?: string) {
  const token = dataset?.token
  return {
    title: token ? `邀请你加入「${dataset?.family || '家庭'}」` : '用本 · 记录物品价值',
    path: token ? `/pages/invitation/index?token=${encodeURIComponent(token)}` : '/pages/index/index',
    ...(token && imageUrl ? { imageUrl } : {}),
  }
}

export function invitationToken(params: { token?: string; scene?: string }) {
  if (params.token) return params.token.trim()
  try { return decodeURIComponent(params.scene || '').trim() } catch { return '' }
}

/** Only accept this app's invitation page; never navigate to arbitrary scan results. */
export function scannedInvitationPath(path: string): string | null {
  if (!/^\/?pages\/invitation\/index\?/.test(path)) return null
  const params: { token?: string; scene?: string } = {}
  try {
    for (const pair of path.slice(path.indexOf('?') + 1).split('&')) {
      const [key, ...rest] = pair.split('=')
      if (key === 'token' || key === 'scene') params[key] = decodeURIComponent(rest.join('='))
    }
    const token = invitationToken(params)
    return /^[A-Za-z0-9_-]{1,128}$/.test(token) ? `/pages/invitation/index?token=${encodeURIComponent(token)}` : null
  } catch { return null }
}

export function invitationExpired(value: string, now = Date.now()) {
  return !!value && (!Number.isFinite(Date.parse(value)) || Date.parse(value) <= now)
}

export function formatInvitationExpiry(value: string, now = Date.now()) {
  if (!value) return '本机演示 · 邀请有效期为 7 天'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '有效期暂不可用'
  const pad = (n: number) => String(n).padStart(2, '0')
  const remaining = date.getTime() - now
  const hours = Math.floor(remaining / 3600000)
  const label = remaining <= 0 ? '已过期' : hours < 1 ? '剩余不足1小时' : `剩余${Math.floor(hours / 24)}天${hours % 24}小时`
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())} 过期（${label}）`
}
