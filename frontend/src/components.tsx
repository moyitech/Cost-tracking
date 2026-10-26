import { createContext, PropsWithChildren, ReactNode, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Button, Canvas, Image, Input, Picker, RootPortal, ScrollView, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import Popup from '@nutui/nutui-react-taro/dist/es/packages/popup'
import '@nutui/nutui-react-taro/dist/es/packages/popup/style/css'
import { AssetName, assets } from './assets'
import { useAdaptiveLayout } from './layout'
import { money, moneyShort, today } from './domain'
import { useImagePreview } from './use-image-preview'
import { stablePixels } from './sheet-scroll'
import { useSheetScroll } from './use-sheet-scroll'
import { traceKeyboard } from './keyboard-trace'
import { IMAGE_CANVAS_ID } from './local-image'

export function Icon({ name }: { name: AssetName }) {
  const asset = assets[name]
  return <Image className='icon' src={asset.src} mode='aspectFit' style={{ width: process.env.TARO_ENV === 'weapp' ? `${asset.width}px` : Taro.pxTransform(asset.width), height: process.env.TARO_ENV === 'weapp' ? `${asset.height}px` : Taro.pxTransform(asset.height) }} />
}
const symbolPaths = {
  home: '<path d="m3 10 9-7 9 7M5 9v11h14V9M9 20v-7h6v7"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  back: '<path d="m15 5-7 7 7 7"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 15v2"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/><path d="m8 12 3 3 5-6"/>',
  people: '<circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 4v3"/>',
  invite: '<circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 10-4m5-3v10m-5-5h10"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  plus: '<path d="M12 4v16M4 12h16"/>',
  photo: '<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8" cy="8" r="1.5"/><path d="m4 17 5-5 4 4 3-3 5 5"/>',
  scan: '<path d="M3 8V3h5m8 0h5v5m0 8v5h-5M8 21H3v-5h5M7 12h10"/>',
  edit: '<path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z"/>',
  camera: '<path d="M8 6l2-3h4l2 3h4v14H4V6z"/><circle cx="12" cy="13" r="4"/>',
  refresh: '<path stroke-width="1.7" d="M19.5 9A7.9 7.9 0 0 0 6.2 6.1L3.8 8.5M3.8 4.5v4h4M4.5 15a7.9 7.9 0 0 0 13.3 2.9l2.4-2.4M20.2 19.5v-4h-4"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
  // Vertical: a horizontal ··· beside the WeChat capsule reads as its menu.
  more: '<circle cx="12" cy="5" r="1.7" fill="#1e3530"/><circle cx="12" cy="12" r="1.7" fill="#1e3530"/><circle cx="12" cy="19" r="1.7" fill="#1e3530"/>',
}
export function SymbolIcon({ name, color = '#1e3530' }: { name: keyof typeof symbolPaths; color?: string }) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${symbolPaths[name]}</svg>`
  return <Image className='symbol-icon' src={`data:image/svg+xml,${encodeURIComponent(svg)}`} mode='aspectFit' />
}
export function Action({ children, onClick, className = '', disabled = false, label, loading = false, expanded, pressable = true }: PropsWithChildren<{ onClick?: () => void; className?: string; disabled?: boolean; label?: string; loading?: boolean; expanded?: boolean; pressable?: boolean }>) {
  // H5 Button's internal loading renderer competes with React's changing children.
  // Keep loading feedback owned by React to avoid insertBefore failures on retries.
  // `.action` resets the platform button-hover look, so press feedback uses its own class.
  return <Button className={`action ${className} ${pressable ? '' : 'no-press'} ${disabled || loading ? 'is-disabled' : ''}`} hoverClass={pressable ? 'is-pressed' : 'none'} hoverStayTime={70} onClick={onClick} disabled={disabled || loading ? true : undefined} ariaLabel={label} aria-expanded={expanded}>{loading && <View className='action-spinner' />}{children}</Button>
}
// Currency sign and fraction stay quieter than the integer part.
export function Amount({ cents, unit, short = false, className = '', empty = '待补充' }: { cents: number | null; unit?: string; short?: boolean; className?: string; empty?: string }) {
  if (cents === null) return <View className={`amount amount-empty ${className}`}><Text>{empty}</Text></View>
  const text = short ? moneyShort(Math.abs(cents)) : money(Math.abs(cents))
  const [integer, fraction] = text.split('.')
  const sign = cents < 0 ? '-' : ''
  return <View className={`amount ${className}`} ariaLabel={`${sign}${text}元${unit === '/天' ? '每天' : ''}`}><Text className='amount-currency'>{sign}¥</Text><Text className='amount-integer'>{integer}</Text>{fraction && <Text className='amount-fraction'>.{fraction}</Text>}{unit && <Text className='amount-unit'>{unit}</Text>}</View>
}
export function Header({ title, back = false, detail = false, onBack, onProfile, actions, hideProfile = false, profile, profileLabel }: { title?: string; back?: boolean; detail?: boolean; onBack?: () => void; onProfile?: () => void; actions?: ReactNode; hideProfile?: boolean; profile?: ReactNode; profileLabel?: string }) {
  const native = process.env.TARO_ENV === 'weapp'
  const layout = useAdaptiveLayout()
  return <><View className={`header ${detail ? 'detail-header' : ''}`} style={{ paddingTop: native ? `${layout.statusTop}px` : 'env(safe-area-inset-top, 0px)' }}>
    <View className='header-inner' style={native ? { height: `${layout.navHeight}px`, paddingRight: `${layout.capsuleRight}px` } : undefined}><View className='row header-leading'>
      {back && <Action className='back-button' label='返回' onClick={onBack || goBack}><Icon name={detail ? 'detail-container16' : 'import-container21'} /></Action>}
      {title ? <Text className='header-title'>{title}</Text> : !detail && <View className='brand' ariaLabel='用本'><Text>用</Text><View className='brand-last'><Text>本</Text></View></View>}
    </View>
    {actions && <View className='header-actions'>{actions}</View>}
    {!detail && <View className={`row header-controls ${native ? 'native-controls' : ''}`}>
      {!hideProfile && <Action className='profile-button' label={profileLabel || '空间与成员'} onClick={onProfile || (() => Taro.reLaunch({ url: '/pages/index/index?tab=spaces' }))}>{profile || <Icon name='home-container3' />}</Action>}
      {!native && <View className='wechat-capsule'><Icon name={back ? 'import-container23' : 'home-container4'} /><View className='capsule-line' /><Icon name={back ? 'import-container24' : 'home-container5'} /></View>}
    </View>}
    </View></View>{native && <Canvas id={IMAGE_CANVAS_ID} type='2d' style={{ position: 'fixed', left: '-10px', top: '-10px', width: '1px', height: '1px', opacity: 0, pointerEvents: 'none' }} aria-hidden />}</>
}
export function goBack() { if (Taro.getCurrentPages().length > 1) void Taro.navigateBack(); else void Taro.reLaunch({ url: '/pages/index/index' }) }
export function Pill({ children, tone = '', dot = false }: PropsWithChildren<{ tone?: string; dot?: boolean }>) { return <View className={`pill ${tone}`}>{dot && <View className='dot' />}{children}</View> }
export function Empty({ title = '还没有物品', text = '从一件珍惜的物品开始，记录它与你的时间。', children }: PropsWithChildren<{ title?: string; text?: string }>) { return <View className='empty'><Text className='empty-symbol'>◇</Text><Text className='empty-title'>{title}</Text>{text && <Text className='muted'>{text}</Text>}{children}</View> }
export function Photo({ src, fileId, presetId, className = '' }: { src: string; fileId?: string; presetId?: string; className?: string }) {
  const { url, imageKey, recover } = useImagePreview({ src, fileId, presetId })
  return url ? <Image key={imageKey} className={`photo ${presetId ? 'photo-preset ' : ''}${className}`} src={url} mode={presetId ? 'aspectFit' : 'aspectFill'} ariaLabel={presetId ? '物品预设图片' : undefined} onError={recover} /> : <View className={`photo photo-empty ${className}`}><Text>物</Text></View>
}
const SheetFocusContext = createContext<{
  owner: string
  focus: (field: string) => void
  blur: (field: string) => void
} | null>(null)
export function Sheet({ title, heading, renderHeader, onClose, children, footer, closeLabel = '关闭', className = '', nested = false }: PropsWithChildren<{ title: string; heading?: ReactNode; renderHeader?: (close: () => void) => ReactNode; onClose: () => void; footer?: ReactNode; closeLabel?: string; className?: string; nested?: boolean }>) {
  const layout = useAdaptiveLayout()
  const native = process.env.TARO_ENV === 'weapp'
  const id = `sheet-${useId().replace(/:/g, '')}`
  const [contentHeight, setContentHeight] = useState<number>()
  const { focus, blur, cancelReveal, reset } = useSheetScroll(id, layout.keyboardOpen, layout.keyboardField, layout.sheetHeight)
  const { focusKeyboard, blurKeyboard, clearKeyboard } = layout
  const focusHandlers = useMemo(() => ({
    owner: id,
    focus: (field: string) => { focusKeyboard(id, field); focus(field) },
    blur: (field: string) => { blurKeyboard(field); blur(field) },
  }), [id, focusKeyboard, blurKeyboard, focus, blur])
  useEffect(() => () => clearKeyboard(id, 'unmount'), [id, clearKeyboard])
  const hideKeyboard = useCallback((reason: 'dismiss' | 'close') => {
    reset()
    clearKeyboard(id, reason)
    traceKeyboard({ event: 'hide-request', owner: id, reason })
    if (native) void Taro.hideKeyboard().catch(() => {})
    else (document.activeElement as HTMLElement | null)?.blur()
  }, [id, native, reset, clearKeyboard])
  // Native scroll-view needs a definite viewport height. Measure the natural
  // content so short sheets still fit their contents, while long forms scroll.
  useEffect(() => {
    if (!native) return
    let active = true
    Taro.nextTick(() => {
      if (!active) return
      const query = Taro.createSelectorQuery()
      query.select(`#${id} .sheet-heading`).boundingClientRect()
      query.select(`#${id} .sheet-content`).boundingClientRect()
      query.select(`#${id} .sheet-footer`).boundingClientRect()
      query.exec(rects => {
        if (!active || !rects[0] || !rects[1]) return
        const available = layout.sheetHeight - rects[0].height - (rects[2]?.height || 0) - layout.safeBottom
        setContentHeight(previous => stablePixels(previous, Math.max(0, Math.min(rects[1].height, available))))
      })
    })
    return () => { active = false }
  }, [native, id, children, heading, renderHeader, footer, layout.sheetHeight, layout.safeBottom, layout.compactHeight])
  const close = () => { hideKeyboard('close'); onClose() }
  const content = <View id={native ? undefined : `${id}-scroll`} className='sheet-content' onTouchMove={native ? undefined : cancelReveal}>{children}</View>
  // Catch wheel intent too, without relying on H5-only event props in WXML.
  useEffect(() => {
    if (native) return
    const viewport = document.getElementById(`${id}-scroll`)
    viewport?.addEventListener('wheel', cancelReveal, { passive: true })
    return () => viewport?.removeEventListener('wheel', cancelReveal)
  }, [id, native, cancelReveal])
  const popup = <Popup visible position='bottom' round minHeight='0' style={{ bottom: `${layout.sheetBottom}px` }} onClose={close} closeOnOverlayClick={false} lockScroll zIndex={nested ? 1300 : undefined} portal={nested && process.env.TARO_ENV === 'h5' ? () => document.body : undefined}>
    <SheetFocusContext.Provider value={focusHandlers}>
      <View id={id} className={`sheet ${className} ${layout.compactHeight ? 'sheet-compact' : ''}`} style={layout.style} onTouchMove={event => event.stopPropagation()}>
        <View className='sheet-heading' catchMove={native}>{renderHeader ? renderHeader(close) : <>{heading || <Text className='sheet-title'>{title}</Text>}<View className='sheet-heading-actions'>
          {layout.keyboardOpen && <Action className='sheet-keyboard-dismiss' onClick={() => hideKeyboard('dismiss')}>收起键盘</Action>}
          <Action className='sheet-close' label={closeLabel} onClick={close}>×</Action>
        </View></>}</View>
        {native ? <ScrollView className='sheet-scroll' scrollY style={contentHeight === undefined ? undefined : { height: `${contentHeight}px` }}>{content}</ScrollView> : content}
        {footer && <View className='sheet-footer' catchMove={native}>{footer}</View>}
      </View>
    </SheetFocusContext.Provider>
  </Popup>
  return nested && process.env.TARO_ENV === 'weapp' ? <RootPortal>{popup}</RootPortal> : popup
}
function useSheetField(nativeInput = true) {
  const context = useContext(SheetFocusContext)
  const focusSheet = !nativeInput && process.env.TARO_ENV === 'weapp' ? null : context
  const id = `field-${useId().replace(/:/g, '')}`
  useEffect(() => {
    if (!focusSheet) return
    traceKeyboard({ event: 'mount', owner: focusSheet.owner, field: id })
    return () => {
      traceKeyboard({ event: 'unmount', owner: focusSheet.owner, field: id })
      focusSheet.blur(id)
    }
  }, [id, focusSheet])
  return { id, focusSheet, nativeSheet: process.env.TARO_ENV === 'weapp' && !!focusSheet }
}
export function Field({ label, value, onChange, placeholder, type = 'text', required = false, disabled = false }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: 'text' | 'digit'; required?: boolean; disabled?: boolean }) {
  const { id, focusSheet, nativeSheet } = useSheetField()
  // iOS otherwise lifts a focused input out of the ScrollView's rendering layer.
  // Keep this mode constant from mount through blur so scrolling moves the
  // text/caret with its field, without replacing or refocusing the input.
  // An embedded input loses its keyboard when the sheet around it moves or
  // resizes, so WeChat lifts the page instead (adjust-position default).
  return <View id={id} className='field'><Text className='field-label'>{label}{required && <Text className='required'> *</Text>}</Text><Input className='field-input' type={type} value={value} disabled={disabled} alwaysEmbed={nativeSheet || undefined} cursorSpacing={nativeSheet ? 24 : undefined} onFocus={() => focusSheet?.focus(id)} onBlur={() => focusSheet?.blur(id)} onInput={e => onChange(e.detail.value)} placeholder={placeholder ?? ''} ariaLabel={label} maxlength={type === 'digit' ? 14 : 160} /></View>
}
export function DateField({ label, value, onChange, required = false, disabled = false }: { label: string; value: string; onChange: (value: string) => void; required?: boolean; disabled?: boolean }) {
  const { id, focusSheet } = useSheetField(false)
  return <View id={id} className='field'><Text className='field-label'>{label}{required && <Text className='required'> *</Text>}</Text><View className='row spread date-control'>
    {process.env.TARO_ENV === 'h5'
      ? <input className='web-picker' aria-label={label} type='date' value={value} max={today()} disabled={disabled} onFocus={() => focusSheet?.focus(id)} onBlur={() => focusSheet?.blur(id)} onInput={e => onChange(e.currentTarget.value)} onChange={e => onChange(e.target.value)} />
      : <Picker mode='date' value={value || today()} end={today()} disabled={disabled} onChange={e => onChange(String(e.detail.value))}><View className='picker-value'>{value || '待补充'} <Text className='muted'>⌄</Text></View></Picker>}
    {value !== today() && <Action className='text-button green-text' disabled={disabled} onClick={() => onChange(today())}>今天</Action>}</View></View>
}
export function SelectField({ label, value, options, onChange, disabled = false }: { label: string; value: string; options: string[]; onChange: (value: string, index: number) => void; disabled?: boolean }) {
  return <View className='field'><Text className='field-label'>{label}</Text>{process.env.TARO_ENV === 'h5'
    ? <select className='web-picker' aria-label={label} value={Math.max(0, options.indexOf(value))} disabled={disabled || !options.length} onChange={e => { const i = Number(e.target.value); onChange(options[i], i) }}>{options.map((option, i) => <option value={i} key={i}>{option}</option>)}</select>
    : <Picker mode='selector' range={options} value={Math.max(0, options.indexOf(value))} disabled={disabled || !options.length} onChange={e => { const i = Number(e.detail.value); onChange(options[i], i) }}><View className='picker-value'>{value} <Text className='muted'>⌄</Text></View></Picker>}</View>
}
// Confirm buttons for destructive actions share the danger text color.
export const destructiveColor = '#c04b42'
export function ErrorNote({ message }: { message: string }) { return message ? <View className='error-note' role='alert'>{message}</View> : null }
// Success copy names the result, at most 7 characters for WeChat's success toast.
export function useSubmit(onSuccess: () => void) {
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const lock = useRef(false)
  const submit = async (task: () => Promise<unknown>, message = '已保存') => {
    if (lock.current) return
    lock.current = true; setBusy(true); setError('')
    try { await task(); void Taro.showToast({ title: message, icon: 'success' }); onSuccess() }
    catch (e) { setError(e instanceof Error ? e.message : '保存失败，输入已保留，请重试') }
    finally { lock.current = false; setBusy(false) }
  }
  return { error, busy, submit }
}
export async function choosePictures(count = 1, persist = true, sourceType: ('album' | 'camera')[] = ['album', 'camera']): Promise<string[]> {
  // Our local encoder controls dimensions/quality; avoid lossy compression twice.
  const result = await Taro.chooseImage({ count, sizeType: ['original'], sourceType })
  if (!persist && process.env.TARO_ENV === 'weapp') return result.tempFilePaths
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
