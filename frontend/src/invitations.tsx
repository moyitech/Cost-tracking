import { useEffect, useRef, useState } from 'react'
import { Button, Image, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { Action, ErrorNote } from './components'
import { roleLabels, Space, uid } from './domain'
import { useLedger } from './store'
import { familyApi, FamilyInvitation, mockEnabled } from './services'
import { formatInvitationExpiry, invitationExpired } from './invitation-share'
import { useInvitationClock } from './invitation-clock'

export function InvitationPanel({ space, onLayoutChange }: { space: Space; onLayoutChange: () => void }) {
  const { execute, refresh } = useLedger()
  const [role, setRole] = useState<'editor' | 'viewer'>('editor')
  const [invite, setInvite] = useState<FamilyInvitation | null>(null)
  const [image, setImage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const key = useRef(uid()); const locked = useRef(false); const generation = useRef(0)
  const imagePath = useRef('')
  const now = useInvitationClock()
  const expired = invite ? invitationExpired(invite.expires_at, now) : false
  useEffect(() => { onLayoutChange() }, [invite, image, busy, error, expired, onLayoutChange])
  const cleanImage = () => {
    if (imagePath.current && process.env.TARO_ENV === 'weapp') {
      Taro.getFileSystemManager().unlink({ filePath: imagePath.current, fail: () => {} })
    }
    imagePath.current = ''
  }
  useEffect(() => () => { generation.current++; cleanImage() }, [])
  const generate = async () => {
    if (locked.current) return
    locked.current = true; setBusy(true); setError('')
    const run = ++generation.current
    try {
      let result = invite
      if (!result) {
        if (mockEnabled) {
          const next = await execute({ type: 'invite', spaceId: space.id, role, key: key.current })
          const local = next.invitations!.find(i => i.id === key.current)!
          result = { id: local.id, token: local.code, role: local.role, status: 'active', created_at: local.createdAt!, expires_at: local.expiresAt!, accepted_count: 0 }
        } else result = await familyApi.createInvitation(space.id, role, key.current)
        if (run !== generation.current) return
        setInvite(result)
      }
      if (mockEnabled || !result.token || result.status !== 'active') return
      const code = await familyApi.miniCode(space.id, result.id)
      if (run !== generation.current) return
      let source = `data:image/png;base64,${code.image_base64}`
      if (process.env.TARO_ENV === 'weapp') {
        const filePath = `${Taro.env.USER_DATA_PATH}/invitation-${uid()}.png`
        await new Promise<void>((resolve, reject) => Taro.getFileSystemManager().writeFile({ filePath, data: code.image_base64, encoding: 'base64', success: () => resolve(), fail: reject }))
        if (run !== generation.current) { Taro.getFileSystemManager().unlink({ filePath, fail: () => {} }); return }
        cleanImage(); imagePath.current = filePath; source = filePath
      }
      setImage(source)
    } catch (e) {
      if (run === generation.current) setError(e instanceof Error ? e.message : '小程序码暂时无法生成，请重试')
      if (!mockEnabled) void refresh()
    } finally { locked.current = false; if (run === generation.current) setBusy(false) }
  }
  return <View className='invitation-panel'>
    {!invite ? <>
      <Text className='form-intro'>邀请家人，一起记录物品的日常。</Text>
      <View className='invitation-roles'>{(['editor', 'viewer'] as const).map(value => <Action key={value} className={`invitation-role ${role === value ? 'selected' : ''}`} disabled={busy} onClick={() => { setRole(value); key.current = uid() }}>
        <View><Text className='invitation-role-title'>{roleLabels[value]}</Text><Text className='invitation-role-description'>{value === 'editor' ? '可添加、编辑家庭物品' : '仅查看家庭物品'}</Text></View><Text className='invitation-role-check'>{role === value ? '✓' : '○'}</Text>
      </Action>)}</View>
      <Text className='invite-selection-note'>邀请 7 天有效，可供多位家人使用。</Text>
      <Action className='primary submit-button' loading={busy} onClick={() => void generate()}>生成邀请</Action>
    </> : <View className='invite-code-card'>
      <View className='invite-emblem'>家</View>
      <Text className='invite-family-name'>{space.name}</Text>
      <Text className='invite-subtitle'>邀请你以{roleLabels[invite.role]}身份加入</Text>
      <View className='invite-code-frame'>
        {image && !expired ? <Image className='invite-code-image' src={image} mode='aspectFit' ariaLabel='家庭邀请小程序码' /> : <View className='invite-code-placeholder'><Text className='invite-placeholder-symbol'>{mockEnabled ? '用本' : expired ? '◷' : '⌂'}</Text><Text>{mockEnabled ? '本机演示 · 无真实小程序码' : expired ? '邀请已过期' : busy ? '正在生成小程序码…' : '小程序码暂不可用'}</Text></View>}
      </View>
      <Text className='invite-scan-hint'>{mockEnabled ? '正式模式支持微信扫码加入' : '微信扫一扫，加入我们的家庭'}</Text>
      <Text className='invite-expiry'>{formatInvitationExpiry(invite.expires_at, now)}</Text>
      {!image && !mockEnabled && !expired && !busy && <Action className='text-button green-text' onClick={() => void generate()}>重新加载小程序码</Action>}
      {!mockEnabled && process.env.TARO_ENV === 'weapp' && <Button id={`share-invitation-${invite.id}`} className={`action primary submit-button ${expired ? 'is-disabled' : ''}`} disabled={expired || !invite.token} openType='share' data-token={invite.token} data-family={space.name}>分享给好友</Button>}
      {mockEnabled && <Action className='primary submit-button' onClick={() => void Taro.navigateTo({ url: `/pages/invitation/index?token=${encodeURIComponent(invite.token!)}` })}>预览受邀页面</Action>}
      {!mockEnabled && process.env.TARO_ENV !== 'weapp' && <Text className='invite-selection-note'>请在微信小程序中分享给好友</Text>}
      <Action className='text-button invite-return' disabled={busy} onClick={() => { generation.current++; setInvite(null); setImage(''); setError(''); cleanImage(); key.current = uid() }}>返回选择角色</Action>
    </View>}
    <ErrorNote message={error} />
  </View>
}
