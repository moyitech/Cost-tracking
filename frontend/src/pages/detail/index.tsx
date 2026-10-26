import { ReactNode, useState } from 'react'
import { Text, View } from '@tarojs/components'
import Taro, { useDidShow, useRouter } from '@tarojs/taro'
import { assets } from '../../assets'
import { Action, Amount, destructiveColor, Empty, ErrorNote, goBack, Header, Icon, Photo, Sheet, SymbolIcon, useSubmit } from '../../components'
import { canEdit, completionHint, isDisposed, metrics, missingFields, money, moneyShort, statusLabels } from '../../domain'
import { DisposalForm, ExpenseForm, ItemForm } from '../../forms'
import { useAdaptiveLayout } from '../../layout'
import { useLedger } from '../../store'
import { mockEnabled, previewItemPictures } from '../../services'
import { dateLabel, LifecycleEvent, lifecycleEvents } from '../../lifecycle'

export default function Detail() {
  const layout = useAdaptiveLayout()
  const { params } = useRouter(); const { data, execute, loading, loadDetail, detailLoading, detailError } = useLedger()
  useDidShow(() => { if (params.id) void loadDetail(params.id) })
  const item = data.items.find(i => i.id === params.id && !i.deleted)
  const [panel, setPanel] = useState<'edit' | 'expense' | 'dispose' | 'move' | null>(null)
  // Keep the id, not the object, so a correction form always reads the latest expense.
  const [expenseId, setExpenseId] = useState<string>()
  const { error, busy, submit } = useSubmit(() => setPanel(null))
  if (!item) return <View className='page' style={layout.style}><Header back detail title='物品详情' /><Empty title={loading || detailLoading ? '正在读取档案…' : '档案已移除或暂不可访问'} text={detailError || '可返回物品列表，或在所属空间回收站恢复。'}><Action className='primary' onClick={goBack}>返回列表</Action>{!mockEnabled && <Action className='secondary' onClick={() => void loadDetail(params.id || '')}>重新加载</Action>}</Empty></View>
  const space = data.spaces.find(s => s.id === item.spaceId)
  if (!space) return <View className='page' style={layout.style}><Header back title='物品详情' /><Empty title='没有此空间的访问权限' text='请联系空间管理者。' /></View>
  const writable = canEdit(space); const m = metrics(item); const disposed = isDisposed(item)
  const image = item.id === 'sony' && item.image === assets['home-photo1'].src ? assets['detail-photo0'].src : item.image
  const hasImage = !!(image || item.imageFileId || item.imagePresetId)
  const attachments = item.attachments || []
  const history = lifecycleEvents(item)
  const cost = disposed ? m.net : m.total
  // Show known facts only; one action names what is still missing.
  const stats = [cost === null ? '' : `${disposed ? '实际持有成本' : '累计'} ¥${moneyShort(cost)}`, m.days === null ? '' : `${disposed ? '持有' : '已持有'} ${m.days} 天`].filter(Boolean)
  const missing = missingFields(item)
  const completeWith = missing.some(field => field === '价格' || field === '购买日期') ? 'edit' : 'dispose'
  const open = (event: LifecycleEvent) => {
    if (event.kind === 'purchase') setPanel('edit')
    else if (event.kind === 'expense') { setExpenseId(event.expenseId); setPanel('expense') }
    else setPanel('dispose')
  }
  const remove = async () => {
    const result = await Taro.showModal({ title: '移入回收站？', content: '档案将暂停计入统计，资料与历史保留，可在回收站恢复。', confirmText: '删除', confirmColor: destructiveColor })
    if (result.confirm) await submit(async () => { await execute({ type: 'delete', id: item.id, revision: item.revision }); goBack() }, '已移入回收站')
  }
  const more = async () => {
    const options = space.kind === 'personal' ? ['迁入家庭空间', '删除物品'] : ['删除物品']
    let choice: string
    try { choice = options[(await Taro.showActionSheet({ itemList: options })).tapIndex] } catch { return }
    if (choice === '迁入家庭空间') setPanel('move'); else await remove()
  }
  const eventValue = (event: LifecycleEvent): ReactNode => {
    if (event.cents === null) return <Text className='event-missing'>{event.kind === 'purchase' ? writable ? '补充价格' : '价格待补充' : writable ? '补充回收金额' : '回收待补充'}</Text>
    return <View className='event-value'>{event.kind === 'sold' || event.kind === 'retired' ? <Text className='event-value-label'>回收</Text> : null}<Amount className='event-amount' cents={event.cents} /></View>
  }
  return <View className='page detail-page' style={layout.style}>
    <Header detail back actions={writable && <><Action className='header-tool' label='编辑物品' onClick={() => setPanel('edit')}><SymbolIcon name='edit' /></Action><Action className='header-tool' label='更多操作' loading={busy} onClick={() => void more()}>{!busy && <SymbolIcon name='more' />}</Action></>} />
    <View className='detail-content'><ErrorNote message={detailError || error} />
      <View className='detail-hero'>
        <View className='detail-hero-head'>
          <Action className='identity-photo-wrap' label='查看物品图片' disabled={!(hasImage || attachments.length)} onClick={() => { void previewItemPictures(item).catch(() => Taro.showToast({ title: '图片暂不可用，请重试', icon: 'none' })) }}><Photo src={image} fileId={item.imageFileId} presetId={item.imagePresetId} className='identity-photo' />{hasImage && !!attachments.length && <View className='photo-count'><Icon name='detail-container' />1/{1 + attachments.length}</View>}</Action>
          <View className='identity-text'><Text className='identity-name'>{item.name}</Text><Text className='identity-context'>{statusLabels[item.status]} · {space.kind === 'personal' ? '个人空间' : space.name}{writable ? '' : ' · 仅查看'}</Text></View>
        </View>
        <Text className='hero-label'>{disposed ? '实际日均成本' : '日均持有成本'}</Text>
        {m.daily === null ? <Text className='hero-pending'>待补充</Text> : <Amount className={`hero-daily ${money(m.daily).length > 9 ? 'compact-amount' : ''}`} cents={m.daily} unit='/天' />}
        {!!stats.length && <View className='hero-stats'>{stats.flatMap((text, i) => [...(i ? [<Text key={`dot-${i}`} className='hero-dot'>·</Text>] : []), <Text key={text}>{text}</Text>])}</View>}
        {!!missing.length && (writable ? <Action className='hero-complete' onClick={() => setPanel(completeWith)}>{completionHint(missing)} ›</Action> : <Text className='hero-complete'>{missing.join('、')}待补充</Text>)}
        {m.net !== null && m.net < 0 && <Text className='hero-note'>回收高于累计投入，差额为收益</Text>}
      </View>
      <View className='card timeline-card'>
        <Text className='card-heading'>生命周期</Text>
        <View className='timeline'>{history.map(event => {
          const content = <><View className='timeline-dot' /><View className='timeline-body'><View className='timeline-line'><Text className='event-title'>{event.title}</Text>{eventValue(event)}</View><Text className={`event-meta ${event.occurredOn ? '' : 'is-missing'}`}>{dateLabel(event.occurredOn)}{event.detail ? ` · ${event.detail}` : ''}</Text></View></>
          return writable
            ? <Action key={event.id} className={`timeline-entry event-${event.kind}`} label={`${event.title}，${dateLabel(event.occurredOn)}，${event.amount}，点按更正`} onClick={() => open(event)}>{content}<Text className='timeline-chevron'>›</Text></Action>
            : <View key={event.id} className={`timeline-entry event-${event.kind}`}>{content}</View>
        })}</View>
      </View>
      {(!!item.note || !!attachments.length) && <View className='card note-card'>
        {!!item.note && <Text className='note-copy'>{item.note}</Text>}
        {!!attachments.length && <><Text className='note-label'>凭证</Text><View className='attachment-list'>{attachments.map((a, i) => <Action key={i} label={`查看凭证 ${i + 1}`} onClick={() => { void previewItemPictures(item, true).catch(() => Taro.showToast({ title: '凭证暂不可用，请重试', icon: 'none' })) }}><Photo src={a.path} fileId={a.fileId} /></Action>)}</View></>}
      </View>}
    </View>
    {writable && <View className='bottom-dock detail-dock'><View className='detail-dock-inner'><Action className='secondary' onClick={() => setPanel('dispose')}><Icon name='detail-container14' />{disposed ? '更正处置' : '登记处置'}</Action><Action className='primary' onClick={() => { setExpenseId(undefined); setPanel('expense') }}><Icon name='detail-container15' />追加支出</Action></View></View>}
    {panel === 'edit' && <ItemForm item={item} onClose={() => setPanel(null)} />}
    {panel === 'expense' && <ExpenseForm item={item} expense={item.expenses.find(e => e.id === expenseId)} onClose={() => setPanel(null)} />}
    {panel === 'dispose' && <DisposalForm item={item} onClose={() => setPanel(null)} />}
    {panel === 'move' && <Sheet title='迁入家庭空间' onClose={() => setPanel(null)}><Text className='form-intro'>迁入后，家庭成员可查看完整历史与凭证；个人空间不再统计此物品。</Text>{!data.spaces.some(s => s.kind === 'family' && canEdit(s)) && <Empty title='还没有可迁入的家庭' text='请先在空间页创建家庭，或加入可编辑的家庭后再来迁移。' />}{data.spaces.filter(s => s.kind === 'family' && canEdit(s)).map(target => <Action key={target.id} className='space-option' loading={busy} onClick={() => { void (async () => { const result = await Taro.showModal({ title: `迁入${target.name}？`, content: '共享完整档案与历史，不会创建副本。', confirmText: '确认迁移' }); if (result.confirm) await submit(() => execute({ type: 'move', id: item.id, revision: item.revision, spaceId: target.id }), '已迁入家庭') })() }}>{target.name} ›</Action>)}<ErrorNote message={error} /></Sheet>}
  </View>
}
