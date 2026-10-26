import { useState } from 'react'
import { Text, View } from '@tarojs/components'
import Taro, { useDidShow, useRouter } from '@tarojs/taro'
import { assets } from '../../assets'
import { Action, Empty, ErrorNote, FooterNote, goBack, Header, Icon, Photo, Pill, Sheet, SymbolIcon, useSubmit } from '../../components'
import { canEdit, Expense, isDisposed, metrics, money, statusLabels } from '../../domain'
import { DisposalForm, ExpenseForm, ItemForm } from '../../forms'
import { useAdaptiveLayout } from '../../layout'
import { useLedger } from '../../store'
import { mockEnabled, previewItemPictures } from '../../services'
import { lifecycleEvents } from '../../lifecycle'

export default function Detail() {
  const layout = useAdaptiveLayout()
  const { params } = useRouter(); const { data, execute, loading, loadDetail, detailLoading, detailError, refresh } = useLedger()
  useDidShow(() => { if (params.id) void loadDetail(params.id) })
  const item = data.items.find(i => i.id === params.id && !i.deleted)
  const [panel, setPanel] = useState<'edit' | 'expense' | 'dispose' | 'move' | null>(null)
  const [editingExpense, setEditingExpense] = useState<Expense | undefined>()
  const [expanded, setExpanded] = useState(true)
  const { error, busy, submit } = useSubmit(() => setPanel(null))
  if (!item) return <View className='page' style={layout.style}><Header back detail title='物品详情' /><Empty title={loading || detailLoading ? '正在读取档案…' : '档案已移除或暂不可访问'} text={detailError || '可返回物品列表，或在所属空间回收站恢复。'}><Action className='primary' onClick={goBack}>返回列表</Action>{!mockEnabled && <Action className='secondary' onClick={() => void loadDetail(params.id || '')}>重新加载</Action>}</Empty></View>
  const space = data.spaces.find(s => s.id === item.spaceId)
  if (!space) return <View className='page' style={layout.style}><Header back title='物品详情' /><Empty title='没有此空间的访问权限' text='请联系空间管理者。' /></View>
  const writable = canEdit(space); const m = metrics(item); const disposed = isDisposed(item)
  const image = item.id === 'sony' && item.image === assets['home-photo1'].src ? assets['detail-photo0'].src : item.image
  const history = lifecycleEvents(item)
  return <View className='page detail-page' style={layout.style}>
    <Header title='物品详情' detail back actions={writable && <Action className='header-tool' label='编辑物品' onClick={() => setPanel('edit')}><SymbolIcon name='edit' /></Action>} />
    <View className='detail-content'><ErrorNote message={detailError} />
      <View className='card item-identity'><Action className='identity-photo-wrap' label='查看物品图片' disabled={!(image || item.imageFileId || item.imagePresetId || item.attachments?.length)} onClick={() => { void previewItemPictures(item).catch(() => Taro.showToast({ title: '图片暂不可用，请重试', icon: 'none' })) }}><Photo src={image} fileId={item.imageFileId} presetId={item.imagePresetId} className='identity-photo' />{(image || item.imageFileId || item.imagePresetId) && !!item.attachments?.length && <View className='photo-count'><Icon name='detail-container' />1/{1 + (item.attachments?.length || 0)}</View>}</Action><View className='identity-text'><Text className='identity-name'>{item.name}</Text><View className='identity-badges'><Pill tone={disposed ? 'gray' : 'green'} dot>{statusLabels[item.status]}</Pill></View></View></View>
      <View className='detail-metrics'><View className='row spread'><Text className='hero-label'><Text className='mint'>●</Text> {disposed ? '实际日均成本' : '日均持有成本'}</Text></View><View className={`hero-daily ${money(m.daily).length > 11 ? 'compact-amount' : ''}`}>{m.daily === null ? '待补充' : `¥${money(m.daily)}`}<Text className='day-unit'>{m.daily !== null ? ' /天' : ''}</Text></View><View className='metric-boxes'><View><Text>{disposed ? '实际持有成本' : '累计总支出'}</Text><View className='row spread'><Text className='metric-number'>{(disposed ? m.net : m.total) === null ? '待补充' : `¥${money(disposed ? m.net : m.total)}`}</Text><Pill>{item.expenses.length + (item.purchaseAmount === null ? 0 : 1)} 笔</Pill></View></View><View><Text>{disposed ? '实际持有' : '累计已持有'}</Text><View className='row spread'><Text className='metric-number'>{m.days ?? '待补充'}<Text className='small'>{m.days ? ' 天' : ''}</Text></Text></View></View></View>{m.net !== null && m.net < 0 && <Text className='small'>实际回收高于累计投入，差额为收益。</Text>}</View>
      <View className='card facts-card'><Action className='card-heading row spread' expanded={expanded} onClick={() => setExpanded(!expanded)}><View className='row'><Icon name='detail-container8' /><Text>购买与记账信息</Text></View><Text className={`disclosure-chevron ${expanded ? 'expanded' : ''}`}>⌄</Text></Action>{expanded && <View className='facts'>{[['价格', item.purchaseAmount === null ? '待补充' : `¥${money(item.purchaseAmount)}`], ['购买日期', item.purchaseDate || '待补充']].map(([label, value]) => <View className='info-row' key={label}><Text>{label}</Text><Text>{value}</Text></View>)}{disposed && <><View className='info-row'><Text>处置日期</Text><Text>{item.disposalDate || '待补充'}</Text></View><View className='info-row'><Text>实际回收</Text><Text>¥{money(item.recoveryAmount)}</Text></View></>}{item.note && <View className='note-copy'>{item.note}</View>}{!!item.attachments?.length && <View className='attachment-list'>{item.attachments.map((a, i) => <Action key={i} onClick={() => { void previewItemPictures(item, true).catch(() => Taro.showToast({ title: '凭证暂不可用，请重试', icon: 'none' })) }}><Photo src={a.path} fileId={a.fileId} /></Action>)}</View>}</View>}</View>
      <View className='card timeline-card'><View className='row spread card-heading'><View className='row'><Icon name='detail-container10' /><Text>生命周期记事</Text></View><Pill>{history.length} 条</Pill></View><View className='timeline'>{history.map((event, i) => <View className={`timeline-entry event-${i}`} key={event.id}><View className='timeline-dot' /><View className='row spread'><Text className='event-title'>{event.title}</Text></View><View className='row spread event-meta'><Text>{event.occurredOn || '发生日期待补充'}</Text><Pill tone={event.kind === 'expense' ? 'amber' : 'green'}>{event.amount}</Pill></View>{event.detail && <View className='audit-detail'><Text>{event.detail}</Text></View>}</View>)}</View></View>
      {item.expenses.length > 0 && <View className='card expense-list'><Text className='card-heading'>支出明细</Text>{item.expenses.map(expense => <Action className='info-row' key={expense.id} disabled={!writable} onClick={() => { setEditingExpense(expense); setPanel('expense') }}><View><Text>{expense.note || expense.category}</Text><Text className='expense-date'>{expense.date} · {expense.category}</Text></View><Text>¥{money(expense.amount)} {writable ? '›' : ''}</Text></Action>)}</View>}
      {writable && <View className='detail-bottom-actions'>{space.kind === 'personal' && <Action className='text-button' onClick={() => setPanel('move')}>迁入家庭空间</Action>}<Action className='delete-item-button danger' loading={busy} onClick={() => { void (async () => { const result = await Taro.showModal({ title: '移入回收站？', content: '档案将暂停计入统计，资料与历史保留。可在空间的回收站恢复。', confirmText: '确认删除' }); if (result.confirm) await submit(async () => { await execute({ type: 'delete', id: item.id, revision: item.revision }); goBack() }) })() }}>删除物品</Action><ErrorNote message={error} /></View>}
      <FooterNote><Icon name='detail-container13' />{space.kind === 'personal' ? '个人空间' : `共享于 ${space.name} · ${writable ? '可编辑' : '仅查看'}`}</FooterNote>
    </View>
    <View className='bottom-dock detail-dock'><View className='detail-dock-inner'><Action className='secondary' disabled={!writable} onClick={() => setPanel('dispose')}><Icon name='detail-container14' />{disposed ? '更正处置' : '登记处置'}</Action><Action className='primary' disabled={!writable} onClick={() => { setEditingExpense(undefined); setPanel('expense') }}><Icon name='detail-container15' />追加支出</Action></View></View>
    {panel === 'edit' && <ItemForm item={item} onClose={() => setPanel(null)} />}
    {panel === 'expense' && <ExpenseForm item={item} expense={editingExpense} onClose={() => setPanel(null)} />}
    {panel === 'dispose' && <DisposalForm item={item} onClose={() => setPanel(null)} />}
    {panel === 'move' && <Sheet title='迁入家庭空间' onClose={() => setPanel(null)}><Text className='form-intro'>迁移后，该家庭的成员可以查看全部历史和凭证，编辑者可以维护档案。个人空间不再统计此物品。</Text>{!data.spaces.some(s => s.kind === 'family' && canEdit(s)) && <Empty title='还没有可迁入的家庭' text='请先在空间页创建家庭，或加入可编辑的家庭后再来迁移。' />}{data.spaces.filter(s => s.kind === 'family' && canEdit(s)).map(target => <Action key={target.id} className='space-option' loading={busy} onClick={() => { void (async () => { const result = await Taro.showModal({ title: `迁入${target.name}？`, content: `从${space.name}迁入${target.name}，共享完整档案与历史；不会创建副本。`, confirmText: '确认迁移' }); if (result.confirm) await submit(() => execute({ type: 'move', id: item.id, revision: item.revision, spaceId: target.id })) })() }}>{target.name} ›</Action>)}<ErrorNote message={error} /></Sheet>}
  </View>
}
