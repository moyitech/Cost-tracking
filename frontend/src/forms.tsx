import { useEffect, useState } from 'react'
import { Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { Action, choosePictures, DateField, ErrorNote, Field, Photo, SelectField, Sheet, useSubmit } from './components'
import { canEdit, categories, Expense, Item, ItemInput, moneyInput, parseMoney, today, uid } from './domain'
import { clearDraft, getDraft, saveDraft } from './services'
import { useLedger } from './store'

export function ItemForm({ item, onClose, prefill, draftKey, initialSpaceId, requestKey, onSaved, lockSpace = false }: { item?: Item; onClose: () => void; prefill?: Partial<ItemInput>; draftKey?: string; initialSpaceId?: string; requestKey?: string; onSaved?: (item: Item) => void; lockSpace?: boolean }) {
  const { data, spaceId, execute } = useLedger()
  const key = draftKey || `item-${item?.id || spaceId}`
  const [form, setForm] = useState(() => getDraft<{ input: ItemInput; amount: string; date: string; space: string; requestKey: string }>(key) || {
    input: { name: item?.name || '', category: item?.category || '未分类', brand: item?.brand || '', model: item?.model || '', image: item?.image || '', purchaseAmount: item?.purchaseAmount ?? null, purchaseDate: item?.purchaseDate ?? null, location: item?.location || '', channel: item?.channel || '', serial: item?.serial || '', warranty: item?.warranty || '', note: item?.note || '', attachments: item?.attachments || [], ...prefill },
    amount: moneyInput(item?.purchaseAmount ?? prefill?.purchaseAmount ?? null), date: item?.purchaseDate || prefill?.purchaseDate || '', space: item?.spaceId || initialSpaceId || spaceId, requestKey: requestKey || uid(),
  })
  const [mediaError, setMediaError] = useState('')
  useEffect(() => { try { saveDraft(key, form) } catch { setMediaError('草稿存储失败，请勿关闭页面，移除大图后重试') } }, [form, key])
  const update = (field: keyof ItemInput, value: string) => setForm(f => ({ ...f, input: { ...f.input, [field]: value } }))
  const { error, busy, submit } = useSubmit(() => { clearDraft(key); onClose() })
  const spaces = data.spaces.filter(canEdit)
  const addPhoto = async (attachment = false) => {
    try { const [path] = await choosePictures(); setForm(f => ({ ...f, input: attachment ? { ...f.input, attachments: [...(f.input.attachments || []), { name: `凭证 ${(f.input.attachments?.length || 0) + 1}`, path }] } : { ...f.input, image: path } })); setMediaError('') }
    catch (e) { if (!String(e).includes('cancel')) setMediaError('图片未能读取，请重试') }
  }
  return <Sheet title={item ? '编辑物品档案' : '记录一件新物品'} onClose={onClose}>
    <Text className='form-intro'>先留下名字，其余慢慢补齐。金额和日期留空时显示「待补充」。</Text>
    <Action className='upload-photo' onClick={() => void addPhoto()}><Photo src={form.input.image} /><Text>{form.input.image ? '更换物品图片' : '添加物品图片'}</Text></Action>
    <Field label='物品名称' value={form.input.name} onChange={v => update('name', v)} placeholder='例如：陪我创作的相机' required />
    {!item && !lockSpace && <SelectField label='保存到' value={data.spaces.find(s => s.id === form.space)?.name || '请选择空间'} options={spaces.map(s => s.name)} onChange={(_, i) => setForm(f => ({ ...f, space: spaces[i].id }))} />}
    <View className='form-grid'><Field label='购入实付（元）' value={form.amount} onChange={amount => setForm(f => ({ ...f, amount }))} type='digit' placeholder='未知请留空' /><DateField label='购买日期' value={form.date} onChange={date => setForm(f => ({ ...f, date }))} /></View>
    <SelectField label='物品分类' value={form.input.category} options={categories} onChange={v => update('category', v)} />
    <View className='form-grid'><Field label='品牌' value={form.input.brand} onChange={v => update('brand', v)} /><Field label='型号' value={form.input.model} onChange={v => update('model', v)} /></View>
    {(['location', 'channel', 'serial', 'warranty', 'note'] as const).map((field, index) => <Field key={field} label={['存放位置', '购买渠道', '设备序列号', '保修信息', '备注'][index]} value={form.input[field]} onChange={v => update(field, v)} />)}
    <View className='field'><Text className='field-label'>购买凭证 · 与物品图片分别保存</Text><View className='attachment-list'>{form.input.attachments?.map((a, index) => <View key={index}><Action onClick={() => Taro.previewImage({ urls: [a.path] })}><Photo src={a.path} /></Action><Action className='text-button danger' onClick={() => setForm(f => ({ ...f, input: { ...f.input, attachments: f.input.attachments?.filter((_, i) => i !== index) } }))}>移除</Action></View>)}</View><Action className='secondary' onClick={() => void addPhoto(true)}>＋ 添加凭证图片</Action></View>
    <ErrorNote message={error || mediaError} />
    <Action className='primary submit-button' loading={busy} onClick={() => void submit(async () => {
      const input = { ...form.input, purchaseAmount: parseMoney(form.amount), purchaseDate: form.date || null }
      const next = await execute(item ? { type: 'edit', id: item.id, revision: item.revision, input } : { type: 'create', spaceId: form.space, input, key: form.requestKey })
      const saved = next.items.find(i => item ? i.id === item.id : i.importKey === form.requestKey)
      if (saved) onSaved?.(saved)
    })}>保存到{data.spaces.find(s => s.id === (item?.spaceId || form.space))?.name}</Action>
    <Action className='text-button muted' onClick={() => { clearDraft(key); onClose() }}>放弃这份草稿</Action>
  </Sheet>
}

export function ExpenseForm({ item, expense, onClose }: { item: Item; expense?: Expense; onClose: () => void }) {
  const { execute } = useLedger(); const key = `expense-${item.id}-${expense?.id || 'new'}`
  const [form, setForm] = useState(() => getDraft<{ category: string; amount: string; date: string; note: string; id: string }>(key) || { category: expense?.category || '维修', amount: moneyInput(expense?.amount ?? null), date: expense?.date || today(), note: expense?.note || '', id: expense?.id || uid() })
  const [draftError, setDraftError] = useState('')
  useEffect(() => { try { saveDraft(key, form); setDraftError('') } catch { setDraftError('草稿存储失败，请勿关闭页面，当前填写内容仍保留') } }, [key, form])
  const { error, busy, submit } = useSubmit(() => { clearDraft(key); onClose() })
  return <Sheet title={expense ? '更正支出记录' : '追加真实支出'} onClose={onClose}>
    <Text className='form-intro'>{item.name} · 支出仅计入这件物品</Text>
    <SelectField label='支出类别' value={form.category} options={['维修', '保养', '配件', '其他']} onChange={category => setForm(f => ({ ...f, category }))} />
    <Field label='实付金额（元）' value={form.amount} onChange={amount => setForm(f => ({ ...f, amount }))} type='digit' required />
    <DateField label='实际发生日期' value={form.date} onChange={date => setForm(f => ({ ...f, date }))} required />
    <Field label='备注' value={form.note} onChange={note => setForm(f => ({ ...f, note }))} placeholder='例如：更换电池' />
    <ErrorNote message={error || draftError} />
    <Action className='primary submit-button' loading={busy} onClick={() => void submit(async () => { await execute({ type: 'expense', id: item.id, revision: item.revision, expense: { ...form, amount: parseMoney(form.amount, true)! } }) })}>保存支出</Action>
    <Action className='text-button muted' onClick={() => { clearDraft(key); onClose() }}>放弃草稿</Action>
  </Sheet>
}

export function DisposalForm({ item, onClose }: { item: Item; onClose: () => void }) {
  const { execute } = useLedger(); const key = `disposal-${item.id}`
  const [form, setForm] = useState(() => getDraft<{ status: 'sold' | 'retired'; date: string; amount: string; zero: boolean }>(key) || { status: item.status === 'retired' ? 'retired' as const : 'sold' as const, date: item.disposalDate || today(), amount: moneyInput(item.recoveryAmount), zero: false })
  const [draftError, setDraftError] = useState('')
  useEffect(() => { try { saveDraft(key, form); setDraftError('') } catch { setDraftError('草稿存储失败，请勿关闭页面，当前填写内容仍保留') } }, [key, form])
  const { error, busy, submit } = useSubmit(() => { clearDraft(key); onClose() })
  return <Sheet title={item.disposalDate ? '更正处置信息' : '为这段陪伴结算'} onClose={onClose}>
    <Text className='form-intro'>处置后会保留全部历史，持有天数截止于处置日期。</Text>
    <View className='segmented'>{(['sold', 'retired'] as const).map(status => <Action key={status} className={form.status === status ? 'selected' : ''} onClick={() => setForm(f => ({ ...f, status }))}>{status === 'sold' ? '已出售' : '已淘汰'}</Action>)}</View>
    <DateField label='实际处置日期' value={form.date} onChange={date => setForm(f => ({ ...f, date }))} required />
    <Field label='实际回收金额（元）' value={form.amount} onChange={amount => setForm(f => ({ ...f, amount, zero: false }))} type='digit' placeholder='未知请保留草稿，不要填 0' required />
    <Action className={`check-row ${form.zero ? 'checked' : ''}`} onClick={() => setForm(f => ({ ...f, zero: !f.zero, amount: !f.zero ? '0.00' : f.amount }))}><Text>{form.zero ? '☑' : '□'}</Text>我确认本次没有收到回收款（0 元）</Action>
    <ErrorNote message={error || draftError} />
    <Action className='primary submit-button' loading={busy} onClick={() => void submit(async () => { await execute({ type: 'dispose', id: item.id, revision: item.revision, status: form.status, date: form.date, recovery: parseMoney(form.amount, true), confirmedZero: form.zero }) })}>确认并更新实际成本</Action>
    <Action className='text-button muted' onClick={onClose}>保留草稿，稍后补充</Action>
  </Sheet>
}
