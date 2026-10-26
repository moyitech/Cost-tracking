import { useEffect, useRef, useState } from 'react'
import { Input, Text, View } from '@tarojs/components'
import Taro, { useDidShow, useRouter } from '@tarojs/taro'
import { Action, ErrorNote, Header, useSubmit } from '../../components'
import { familyApi, InvitationPreview, mockEnabled } from '../../services'
import { roleLabels, uid } from '../../domain'
import { useLedger } from '../../store'
import { invitationMessages } from '../../family-state'
import { useAdaptiveLayout } from '../../layout'
import { formatInvitationExpiry, invitationExpired, invitationToken } from '../../invitation-share'
import { useInvitationClock } from '../../invitation-clock'

export default function InvitationPage() {
  const params = useRouter().params
  const { data, execute, setSpaceId } = useLedger()
  const layout = useAdaptiveLayout()
  const token = invitationToken(params)
  const [nickname, setNickname] = useState('')
  const [nicknameError, setNicknameError] = useState(false)
  const [nicknameFocus, setNicknameFocus] = useState(false)
  const [privacyOpen, setPrivacyOpen] = useState(false)
  const [preview, setPreview] = useState<InvitationPreview | null>(null)
  const [loading, setLoading] = useState(!!token); const [loadError, setLoadError] = useState('')
  const generation = useRef(0); const [key, setKey] = useState(uid)
  const { busy, error, submit } = useSubmit(() => {})
  const now = useInvitationClock()
  const inspect = async () => {
    if (!token) return
    const run = ++generation.current; setLoading(true); setLoadError('')
    try {
      const local = data.invitations?.find(i => i.code === token.toUpperCase())
      const localSpace = data.spaces.find(s => s.id === local?.spaceId)
      const result = mockEnabled
        ? token === 'DEMO-FAMILY' ? { family_name: '周末小家', inviter_name: '家庭管理者', role: 'editor' as const, status: 'active' as const, expires_at: new Date(Date.now() + 7 * 86400000).toISOString(), already_member: data.spaces.some(s => s.id === 'joined-demo') }
          : local && localSpace ? { family_name: localSpace.name, inviter_name: '家庭管理者', role: local.role, status: local.status === 'revoked' ? 'revoked' as const : invitationExpired(local.expiresAt || '') ? 'expired' as const : 'active' as const, expires_at: local.expiresAt || '', already_member: true } : null
        : await familyApi.preview(token)
      if (!result) throw new Error('邀请不存在，请家人重新分享邀请')
      if (run === generation.current) setPreview(result)
    } catch (e) { if (run === generation.current) { setPreview(null); setLoadError(e instanceof Error ? e.message : '邀请读取失败') } }
    finally { if (run === generation.current) setLoading(false) }
  }
  useEffect(() => { setPreview(null); void inspect(); return () => { generation.current++ } }, [token])
  useDidShow(() => { if (preview && !busy) void inspect() })
  const expired = preview ? invitationExpired(preview.expires_at, now) : false
  const active = preview?.status === 'active' && !expired
  return <View className='page invitation-page' style={layout.style} onClick={() => setPrivacyOpen(false)}><Header back hideProfile title='家庭邀请' /><View className='invitation-page-content'>
    <View className='invitation-landing-card'>
      <View className='invite-hero'><Text className='invite-eyebrow'>用本 · 家庭共享</Text>
      <View className='invite-emblem'>家</View>
      {preview ? <>
        <Text className='invite-family-name'>{preview.family_name}</Text>
        <Text className='invite-subtitle'>{preview.inviter_name} 邀请你加入</Text>
        <View className='invite-access'><View className='invite-role-line'><Text className='invite-access-role'>以{roleLabels[preview.role]}加入</Text><View className='invite-info-anchor' onClick={e => e.stopPropagation()}><Action className='invite-info' label='查看个人物品隐私说明' expanded={privacyOpen} onClick={() => setPrivacyOpen(!privacyOpen)}>!</Action>{privacyOpen && <View className='invite-privacy-popover'><Text>共享家里的物品，保留自己的空间。</Text><Text>你的个人物品仍仅自己可见，不会自动迁入家庭。</Text></View>}</View></View><Text>{preview.role === 'editor' ? '一起添加、整理和编辑家庭物品' : '随时查看家庭物品与记录'}</Text></View>
      </> : <><Text className='invite-family-name'>{loading ? '正在打开邀请' : token ? '暂时无法打开邀请' : '等待家人的邀请'}</Text><Text className='invite-privacy'>{loading ? '正在确认家庭信息，请稍候…' : token ? '请重试，或请家人重新分享邀请。' : '打开家人分享的小程序卡片，或使用微信扫一扫。'}</Text></>}
      </View><View className='invite-body'>
      {preview ? <>
        {active ? <View className='invite-join-form'>
          {!preview.already_member && <View className={`invite-nickname${nicknameError ? ' invite-nickname-invalid' : ''}`}><View className='invite-nickname-label'><Text>我的家庭昵称</Text><Text className='invite-required'>必填</Text></View><Input className='invite-nickname-input' value={nickname} maxlength={30} disabled={busy} focus={nicknameFocus} onBlur={() => setNicknameFocus(false)} onInput={e => { setNickname(e.detail.value); setNicknameError(false); setKey(uid()) }} placeholder='填写昵称，让家人认出你' placeholderStyle='color: #88998e' /><Text className='invite-nickname-error'>{nicknameError ? '请填写家庭昵称，让家人知道你是谁' : ''}</Text></View>}
          {preview.already_member && <Text className='invite-member-note'>你已经是这个家庭的一员</Text>}
          <Action className='primary submit-button' loading={busy} disabled={loading} onClick={() => {
            if (!preview.already_member && !nickname.trim()) { setNicknameError(true); setNicknameFocus(true); return }
            void submit(async () => {
            if (invitationExpired(preview.expires_at)) { await inspect(); throw new Error('邀请已过期，请家人重新分享邀请') }
            try {
              const result = await execute(mockEnabled && token === 'DEMO-FAMILY' ? { type: 'joinDemo', nickname: nickname || '家庭成员' } : { type: 'acceptInvite', token, nickname: nickname || '家庭成员', key })
              if (result.resultSpaceId) setSpaceId(result.resultSpaceId)
              await Taro.reLaunch({ url: '/pages/index/index?tab=spaces' })
            } catch (e) { await inspect(); throw e }
          }, preview.already_member ? '已进入家庭' : '已加入家庭') }}>{preview.already_member ? '进入家庭' : '确认加入家庭'}</Action>
        </View> : <View className='invite-unavailable'><Text>{invitationMessages[expired ? 'expired' : preview.status]}</Text><Text>请联系家人重新分享邀请。</Text></View>}
        <Text className='invite-expiry'>{formatInvitationExpiry(preview.expires_at, now)}</Text>
      </> : <>{!!loadError && <Action className='secondary submit-button' loading={loading} onClick={() => void inspect()}>重新加载</Action>}</>}
      <ErrorNote message={loadError || error} /></View>
    </View>
    <Text className='invite-page-signature'>一起记录，让每件物品都有迹可循。</Text>
  </View></View>
}
