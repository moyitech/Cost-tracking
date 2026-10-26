import { useCallback, useEffect, useRef, useState } from 'react'
import { Image, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { Action, choosePictures, ErrorNote, Field, Sheet, SymbolIcon, useSubmit } from './components'
import { Space, roleLabels, uid } from './domain'
import { fileUrl, mockEnabled, readMediaEpoch, subscribeMedia } from './services'
import { scannedInvitationPath } from './invitation-share'
import { useLedger } from './store'
import { cropAvatarImage, persistSquarePreview } from './local-image'
import { imageActionCancelled } from './avatar-crop'
import { BrowserAvatarCropper } from './avatar-cropper'
import { NativeAvatarCropper } from './native-avatar-cropper'
import { hasAvatarChanges } from './avatar-draft'
import './spaces.scss'

export function LedgerAvatar({ kind = 'personal', src = '', fileId, size = '', fallback = '我' }: { kind?: Space['kind']; src?: string; fileId?: string; size?: 'small' | 'medium' | 'large' | ''; fallback?: string }) {
  const [mediaEpoch, setMediaEpoch] = useState(readMediaEpoch)
  useEffect(() => subscribeMedia(() => setMediaEpoch(readMediaEpoch())), [])
  const resource = `${src}:${fileId || ''}`
  const [image, setImage] = useState({ resource, url: src })
  const retried = useRef(false)
  useEffect(() => {
    let active = true; retried.current = false
    setImage({ resource, url: src })
    if (fileId && !mockEnabled) void fileUrl(fileId).then(url => { if (active) setImage({ resource, url }) }).catch(() => {})
    return () => { active = false }
  }, [resource, mediaEpoch])
  const recover = () => {
    if (fileId && !mockEnabled && !retried.current) {
      retried.current = true
      void fileUrl(fileId, true).then(url => setImage(current => current.resource === resource ? { resource, url } : current)).catch(() => setImage(current => current.resource === resource ? { resource, url: '' } : current))
    } else setImage(current => current.resource === resource ? { resource, url: '' } : current)
  }
  const url = image.resource === resource ? image.url : src
  return <View className={`ledger-avatar ledger-avatar-${kind} ${size ? `ledger-avatar-${size}` : ''}`}>{url ? <Image className='ledger-avatar-image' src={url} mode='aspectFill' onError={recover} /> : kind === 'family' ? <SymbolIcon name='home' /> : <Text>{fallback}</Text>}</View>
}

export function SpaceMenuRow({ icon, title, caption, trailing, onClick, disabled = false }: { icon: Parameters<typeof SymbolIcon>[0]['name']; title: string; caption?: string; trailing?: string; onClick: () => void; disabled?: boolean }) {
  return <Action className='space-management-row' disabled={disabled} onClick={onClick}><View className='space-management-icon'><SymbolIcon name={icon} /></View><View className='space-management-copy'><Text className='space-management-title'>{title}</Text>{caption && <Text className='space-management-caption'>{caption}</Text>}</View><View className='space-management-end'>{trailing && <Text>{trailing}</Text>}<SymbolIcon name='chevron' /></View></Action>
}

export function AvatarEditor({ scope, spaceId, onClose }: { scope: Space['kind']; spaceId: string; onClose: () => void }) {
  const { data, execute } = useLedger()
  const target = data.spaces.find(s => s.id === spaceId)
  const source = scope === 'personal' ? { image: data.profile?.avatar || '', fileId: data.profile?.avatarFileId } : { image: target?.avatar || '', fileId: target?.avatarFileId }
  const savedAvatar = useRef(source)
  const [pending, setPending] = useState({ ...source, cropped: false })
  const [confirmClose, setConfirmClose] = useState(false)
  const [cropSource, setCropSource] = useState<string | null>(null)
  const [croppingBusy, setCroppingBusy] = useState(false)
  const [, setCropLayout] = useState(0)
  const cropLayoutChanged = useCallback(() => setCropLayout(value => value + 1), [])
  const [picking, setPicking] = useState(false); const [pickError, setPickError] = useState('')
  const active = useRef(true); const lock = useRef(false)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  const { error, busy, submit } = useSubmit(onClose)
  const writable = !!target && target.kind === scope && target.role === 'admin'
  const save = () => {
    if (!writable || picking || croppingBusy) return
    void submit(async () => {
      let image = pending.image
      if (mockEnabled && pending.cropped) {
        image = await persistSquarePreview(image)
        if (!active.current) throw new Error('头像编辑已关闭，请重新打开')
        setPending({ image, fileId: undefined, cropped: false })
      }
      await execute({ type: 'avatar', scope, spaceId, image, fileId: pending.fileId })
    }, '头像已更新')
  }
  const requestClose = () => {
    if (busy || picking || croppingBusy) return
    if (cropSource) setCropSource(null)
    else if (confirmClose) setConfirmClose(false)
    else if (hasAvatarChanges(savedAvatar.current, pending)) setConfirmClose(true)
    else onClose()
  }
  const choose = async () => {
    if (lock.current || busy) return
    lock.current = true; setPicking(true); setPickError('')
    try {
      const [image] = await choosePictures(1, false, ['album'])
      if (!active.current || !image) return
      if (process.env.TARO_ENV === 'weapp') {
        const result = await cropAvatarImage(image)
        if (!active.current) return
        if (result.kind === 'cropped') setPending({ image: result.path, fileId: undefined, cropped: true })
        else if (result.kind === 'fallback') setCropSource(image)
      } else setCropSource(image)
    }
    catch (e) { if (active.current && !imageActionCancelled(e)) setPickError(e instanceof Error ? e.message : '无法读取或裁剪照片，请检查相册权限后重试') }
    finally { lock.current = false; if (active.current) setPicking(false) }
  }
  return <Sheet title={cropSource ? '裁剪头像' : confirmClose ? '头像尚未保存' : scope === 'personal' ? '更换个人头像' : '更换家庭头像'} className='avatar-editor-sheet' onClose={requestClose} footer={cropSource ? undefined : <><ErrorNote message={pickError || error || (!writable ? '头像修改权限已变化，请关闭后刷新空间' : '')} /><Action className='primary avatar-save' disabled={!writable || picking} loading={busy} onClick={save}>{confirmClose ? '保存并退出' : '保存头像'}</Action>{confirmClose ? <><Action className='secondary avatar-discard' disabled={busy} onClick={onClose}>不保存并退出</Action><Action className='avatar-cancel' disabled={busy} onClick={() => setConfirmClose(false)}>继续编辑</Action></> : <Action className='avatar-cancel' disabled={busy || picking} onClick={requestClose}>取消</Action>}</>}>
    {cropSource ? process.env.TARO_ENV === 'weapp' ? <NativeAvatarCropper key={cropSource} src={cropSource} onProcessingChange={setCroppingBusy} onLayoutChange={cropLayoutChanged} onCancel={() => setCropSource(null)} onConfirm={image => { setPending({ image, fileId: undefined, cropped: true }); setCropSource(null); setPickError(''); setCroppingBusy(false) }} /> : <BrowserAvatarCropper key={cropSource} src={cropSource} onCancel={() => setCropSource(null)} onConfirm={image => { setPending({ image, fileId: undefined, cropped: true }); setCropSource(null); setPickError('') }} /> : confirmClose ? <><View className='avatar-editor-preview'><LedgerAvatar kind={scope} src={pending.image} fileId={pending.fileId} size='large' /></View><Text className='avatar-editor-caption'>头像修改尚未保存，离开前要保存吗？</Text></> : <>
    <View className='avatar-editor-preview'><LedgerAvatar kind={scope} src={pending.image} fileId={pending.fileId} size='large' /></View>
    <View className='space-management-card'><SpaceMenuRow icon='photo' title={picking ? '正在选择或裁剪照片…' : '从相册选择'} disabled={busy || picking} onClick={() => void choose()} /><SpaceMenuRow icon='refresh' title='恢复默认头像' disabled={busy || picking} onClick={() => { if (!busy && !picking) { setPending({ image: '', fileId: undefined, cropped: false }); setPickError('') } }} /></View></>}
  </Sheet>
}

export function SpaceSwitcher({ current, onSelect, onClose }: { current?: Space; onSelect: (id: string) => void; onClose: () => void }) {
  const { data, execute } = useLedger()
  const [view, setView] = useState<'list' | 'create' | 'join'>('list')
  const [name, setName] = useState(''); const [nickname, setNickname] = useState(''); const [key, setKey] = useState(uid)
  const [scanError, setScanError] = useState(''); const [scanning, setScanning] = useState(false)
  const { busy, error, submit } = useSubmit(onClose)
  const scan = async () => {
    if (scanning) return
    setScanning(true); setScanError('')
    try {
      const result = await Taro.scanCode({ scanType: ['qrCode'] })
      const path = scannedInvitationPath(result.path || '')
      if (!path) throw new Error('请扫描用本的家庭邀请小程序码，或打开家人分享的邀请卡片')
      onClose(); await Taro.navigateTo({ url: path })
    } catch (e) {
      const message = e instanceof Error ? e.message : String((e as { errMsg?: string })?.errMsg || e)
      if (!/cancel/i.test(message)) setScanError(message.includes('scanCode:fail') ? '无法打开扫一扫，请检查相机权限后重试' : message)
    } finally { setScanning(false) }
  }
  const title = { list: '全部空间', create: '创建家庭空间', join: '加入家庭' }[view]
  return <Sheet title={title} className='space-switcher-sheet' heading={view === 'list' ? undefined : <View className='space-sheet-subheading'><Action className='space-sheet-back' label='返回全部空间' disabled={busy || scanning} onClick={() => setView('list')}><SymbolIcon name='back' /></Action><Text>{title}</Text></View>} onClose={() => { if (!busy && !scanning) onClose() }} footer={view === 'create' ? <><ErrorNote message={error} /><Action className='primary space-sheet-primary' loading={busy} onClick={() => void submit(async () => { if (!name.trim() || !nickname.trim()) throw new Error('请填写家庭名称和家庭昵称'); if (name.trim().length > 100 || nickname.trim().length > 100) throw new Error('名称和昵称不能超过100个字符'); const result = await execute({ type: 'createSpace', name: name.trim(), nickname: nickname.trim(), key }); if (result.resultSpaceId) onSelect(result.resultSpaceId) }, '家庭已创建')}>创建并进入</Action></> : view === 'join' ? <><ErrorNote message={scanError} />{process.env.TARO_ENV === 'weapp' && <Action className='primary space-sheet-primary' loading={scanning} onClick={() => void scan()}><SymbolIcon name='scan' />微信扫一扫</Action>}{mockEnabled && <Action className='secondary space-sheet-primary' onClick={() => { onClose(); void Taro.navigateTo({ url: '/pages/invitation/index?token=DEMO-FAMILY' }) }}>体验演示邀请</Action>}</> : undefined}>
    {view === 'list' && <><View className='all-space-list'>{data.spaces.map(s => <Action key={s.id} className={`all-space-option ${current?.id === s.id ? 'selected' : ''}`} label={`${s.name}，${s.kind === 'personal' ? '个人空间' : roleLabels[s.role]}${current?.id === s.id ? '，当前空间' : ''}`} onClick={() => { onSelect(s.id); onClose() }}><LedgerAvatar kind={s.kind} src={s.kind === 'personal' ? data.profile?.avatar : s.avatar} fileId={s.kind === 'personal' ? data.profile?.avatarFileId : s.avatarFileId} size='medium' /><View className='all-space-copy'><Text className='all-space-name'>{s.name}</Text><Text className='all-space-description'>{s.kind === 'personal' ? '个人 · 仅自己可见' : `家庭 · ${roleLabels[s.role]}`}{(mockEnabled || s.itemCount !== undefined) && ` · ${mockEnabled ? data.items.filter(i => i.spaceId === s.id && !i.deleted).length : s.itemCount} 件物品`}</Text></View>{current?.id === s.id && <Text className='all-space-check'>✓</Text>}</Action>)}</View><View className='space-management-card all-space-actions'><SpaceMenuRow icon='plus' title='创建家庭空间' onClick={() => setView('create')} /><SpaceMenuRow icon='scan' title='加入家庭' onClick={() => setView('join')} /></View></>}
    {view === 'create' && <><Text className='space-sheet-intro'>创建后，你将成为这个家庭的管理者。</Text><Field label='家庭名称' value={name} disabled={busy} onChange={value => { setName(value); setKey(uid()) }} placeholder='例如：温暖的家' required /><Field label='我的家庭昵称' value={nickname} disabled={busy} onChange={value => { setNickname(value); setKey(uid()) }} placeholder='家人会怎么称呼你' required /></>}
    {view === 'join' && <><View className='join-family-symbol'><SymbolIcon name='scan' /></View><Text className='join-family-title'>从一份家人的邀请开始</Text><Text className='join-family-caption'>打开家人分享的邀请卡片，或扫描邀请小程序码。</Text><View className='space-privacy-box'><SymbolIcon name='shield' /><Text>确认后才会加入，个人物品仍仅自己可见。</Text></View></>}
  </Sheet>
}
