import { useState } from 'react'
import { Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { Action, ErrorNote, Field, Pill, SelectField, useSubmit } from './components'
import { roleLabels, Space, uid } from './domain'
import { useLedger } from './store'

export function InvitationPanel({ space }: { space: Space }) {
  const { data, execute } = useLedger()
  const [role, setRole] = useState<'editor' | 'viewer'>('viewer')
  const [name, setName] = useState('演示家人')
  const [key, setKey] = useState(uid)
  const [copyError, setCopyError] = useState('')
  const { error, busy, submit } = useSubmit(() => setKey(uid()))
  const invitations = (data.invitations || []).filter(i => i.spaceId === space.id)
  return <>
    <Text className='form-intro'>本地 Mock：生成邀请码、复制、模拟受邀者加入或撤销，均会保存在当前设备。邀请码不能跨设备使用；正式邀请由后端接入。</Text>
    <SelectField label='受邀角色' value={roleLabels[role]} options={['查看者', '编辑者']} onChange={(_, i) => setRole(i === 0 ? 'viewer' : 'editor')} />
    <Action className='primary submit-button' loading={busy} onClick={() => void submit(() => execute({ type: 'invite', spaceId: space.id, role, key }))}>生成本地邀请码</Action>
    <Field label='模拟受邀者姓名' value={name} onChange={setName} placeholder='例如：演示家人' />
    {invitations.map(invite => <View className='mock-invitation' key={invite.id}>
      <View className='row spread'><Text>{roleLabels[invite.role]}</Text><Pill>{invite.status === 'pending' ? '待加入' : invite.status === 'accepted' ? '已加入' : '已撤销'}</Pill></View>
      <Text className='invite-code'>{invite.code}</Text>
      {invite.status === 'pending' && <><View className='row'>
        <Action className='secondary' onClick={() => { setCopyError(''); void Taro.setClipboardData({ data: invite.code }).catch(() => setCopyError('复制未成功，请手动选取上方邀请码')) }}>复制邀请码</Action>
        <Action className='text-button danger' loading={busy} onClick={() => void submit(() => execute({ type: 'revokeInvite', id: invite.id }))}>撤销邀请</Action>
      </View><Action className='secondary submit-button' loading={busy} onClick={() => void submit(() => execute({ type: 'acceptDemoInvite', id: invite.id, name }))}>模拟受邀者确认加入</Action></>}
      {invite.status === 'accepted' && <Text className='small muted'>已加入成员列表，可关闭后查看成员及调整权限。</Text>}
    </View>)}
    {!invitations.length && <Text className='small muted'>尚未生成邀请。选择角色后点击上方按钮即可开始。</Text>}
    <ErrorNote message={error || copyError} />
  </>
}
