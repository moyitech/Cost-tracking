import { PropsWithChildren, ReactNode, useRef, useState } from 'react'
import { Button, Image, Input, Picker, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import Popup from '@nutui/nutui-react-taro/dist/es/packages/popup'
import '@nutui/nutui-react-taro/dist/es/packages/popup/style/css'
import { AssetName, assets } from './assets'
import { useAdaptiveLayout } from './layout'
import { today } from './domain'

export function Icon({ name }: { name: AssetName }) {
  const asset = assets[name]
  return <Image className='icon' src={asset.src} mode='aspectFit' style={{ width: process.env.TARO_ENV === 'weapp' ? `${asset.width}px` : Taro.pxTransform(asset.width), height: process.env.TARO_ENV === 'weapp' ? `${asset.height}px` : Taro.pxTransform(asset.height) }} />
}
export function Action({ children, onClick, className = '', disabled = false, label, loading = false, expanded }: PropsWithChildren<{ onClick?: () => void; className?: string; disabled?: boolean; label?: string; loading?: boolean; expanded?: boolean }>) {
  // H5 Button's internal loading renderer competes with React's changing children.
  // Keep loading feedback owned by React to avoid insertBefore failures on retries.
  return <Button className={`action ${className} ${disabled || loading ? 'is-disabled' : ''}`} onClick={onClick} disabled={disabled || loading ? true : undefined} ariaLabel={label} aria-expanded={expanded}>{loading && <View className='action-spinner' />}{children}</Button>
}
export function Header({ title, back = false, detail = false, onBack, onProfile, actions }: { title?: string; back?: boolean; detail?: boolean; onBack?: () => void; onProfile?: () => void; actions?: ReactNode }) {
  const native = process.env.TARO_ENV === 'weapp'
  const layout = useAdaptiveLayout()
  return <><View className={`header ${detail ? 'detail-header' : ''}`} style={{ paddingTop: native ? `${layout.statusTop}px` : 'env(safe-area-inset-top, 0px)' }}>
    <View className='header-inner' style={native ? { height: `${layout.navHeight}px`, paddingRight: `${layout.capsuleRight}px` } : undefined}><View className='row header-leading'>
      {back && <Action className='back-button' label='返回' onClick={onBack || goBack}><Icon name={detail ? 'detail-container16' : 'import-container21'} /></Action>}
      {title ? <Text className='header-title'>{title}</Text> : <View className='row brand'><Text className='brand-en'>Items</Text><Text className='brand-cn'>物序</Text></View>}
    </View>
    {actions && <View className='header-actions'>{actions}</View>}
    {!detail && <View className={`row header-controls ${native ? 'native-controls' : ''}`}>
      <Action className='profile-button' label='空间与成员' onClick={onProfile || (() => Taro.reLaunch({ url: '/pages/index/index?tab=spaces' }))}><Icon name='home-container3' /></Action>
      {!native && <View className='wechat-capsule'><Icon name={back ? 'import-container23' : 'home-container4'} /><View className='capsule-line' /><Icon name={back ? 'import-container24' : 'home-container5'} /></View>}
    </View>}
    </View></View></>
}
export function goBack() { if (Taro.getCurrentPages().length > 1) void Taro.navigateBack(); else void Taro.reLaunch({ url: '/pages/index/index' }) }
export function Pill({ children, tone = '', dot = false }: PropsWithChildren<{ tone?: string; dot?: boolean }>) { return <View className={`pill ${tone}`}>{dot && <View className='dot' />}{children}</View> }
export function Empty({ title = '还没有物品', text = '从一件珍惜的物品开始，记录它与你的时间。', children }: PropsWithChildren<{ title?: string; text?: string }>) { return <View className='empty'><Text className='empty-symbol'>◇</Text><Text className='empty-title'>{title}</Text><Text className='muted'>{text}</Text>{children}</View> }
export function Photo({ src, className = '' }: { src: string; className?: string }) { return src ? <Image className={`photo ${className}`} src={src} mode='aspectFill' /> : <View className={`photo photo-empty ${className}`}><Text>物</Text></View> }
export function Sheet({ title, onClose, children, footer, closeLabel = '关闭' }: PropsWithChildren<{ title: string; onClose: () => void; footer?: ReactNode; closeLabel?: string }>) {
  const layout = useAdaptiveLayout()
  return <Popup visible position='bottom' round onClose={onClose} closeOnOverlayClick={false} lockScroll>
    <View className={`sheet ${layout.compactHeight ? 'sheet-compact' : ''}`} style={layout.style}><View className='sheet-heading'><Text>{title}</Text><Action label={closeLabel} onClick={onClose}>×</Action></View><View className='sheet-content'>{children}</View>{footer && <View className='sheet-footer'>{footer}</View>}</View>
  </Popup>
}
export function Field({ label, value, onChange, placeholder, type = 'text', required = false }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: 'text' | 'digit'; required?: boolean }) {
  return <View className='field'><Text className='field-label'>{label}{required && <Text className='required'> *</Text>}</Text><Input className='field-input' type={type} value={value} onInput={e => onChange(e.detail.value)} placeholder={placeholder ?? (required ? '请填写' : '选填')} ariaLabel={label} maxlength={type === 'digit' ? 14 : 160} /></View>
}
export function DateField({ label, value, onChange, required = false, disabled = false }: { label: string; value: string; onChange: (value: string) => void; required?: boolean; disabled?: boolean }) {
  return <View className='field'><Text className='field-label'>{label}{required && <Text className='required'> *</Text>}</Text><View className='row spread'>
    {process.env.TARO_ENV === 'h5'
      ? <input className='web-picker' aria-label={label} type='date' value={value} max={today()} disabled={disabled} onInput={e => onChange(e.currentTarget.value)} onChange={e => onChange(e.target.value)} />
      : <Picker mode='date' value={value || today()} end={today()} disabled={disabled} onChange={e => onChange(String(e.detail.value))}><View className='picker-value'>{value || '待补充'} <Text className='muted'>⌄</Text></View></Picker>}
    {value && !required && !disabled && <Action className='text-button muted' onClick={() => onChange('')}>清空</Action>}</View></View>
}
export function SelectField({ label, value, options, onChange, disabled = false }: { label: string; value: string; options: string[]; onChange: (value: string, index: number) => void; disabled?: boolean }) {
  return <View className='field'><Text className='field-label'>{label}</Text>{process.env.TARO_ENV === 'h5'
    ? <select className='web-picker' aria-label={label} value={Math.max(0, options.indexOf(value))} disabled={disabled || !options.length} onChange={e => { const i = Number(e.target.value); onChange(options[i], i) }}>{options.map((option, i) => <option value={i} key={i}>{option}</option>)}</select>
    : <Picker mode='selector' range={options} value={Math.max(0, options.indexOf(value))} disabled={disabled || !options.length} onChange={e => { const i = Number(e.detail.value); onChange(options[i], i) }}><View className='picker-value'>{value} <Text className='muted'>⌄</Text></View></Picker>}</View>
}
export function ErrorNote({ message }: { message: string }) { return message ? <View className='error-note' role='alert'>{message}</View> : null }
export function useSubmit(onSuccess: () => void) {
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const lock = useRef(false)
  const submit = async (task: () => Promise<unknown>) => {
    if (lock.current) return
    lock.current = true; setBusy(true); setError('')
    try { await task(); void Taro.showToast({ title: '已保存', icon: 'success' }); onSuccess() }
    catch (e) { setError(e instanceof Error ? e.message : '保存失败，输入已保留，请重试') }
    finally { lock.current = false; setBusy(false) }
  }
  return { error, busy, submit }
}
export async function choosePictures(count = 1): Promise<string[]> {
  const result = await Taro.chooseImage({ count, sizeType: ['compressed'], sourceType: ['album', 'camera'] })
  if (process.env.TARO_ENV === 'weapp') return Promise.all(result.tempFilePaths.map(async path => {
    const saved = await Taro.saveFile({ tempFilePath: path })
    if (!('savedFilePath' in saved)) throw new Error('图片保存失败')
    return saved.savedFilePath
  }))
  return Promise.all(result.tempFilePaths.map(async path => {
    const blob = await (await fetch(path)).blob()
    return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob) })
  }))
}
export function FooterNote({ children }: { children: ReactNode }) { return <View className='footer-note'>{children}</View> }
