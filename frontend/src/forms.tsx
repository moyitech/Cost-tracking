import { useEffect, useState } from 'react'
import { Text, View } from '@tarojs/components'
import { Action, DateField, ErrorNote, Field, SelectField, Sheet, useSubmit } from './components'
import { canEdit, Expense, Item, ItemInput, moneyInput, parseMoney, today, uid } from './domain'
import { ItemFields } from './item-fields'
import { clearDraft, getDraft, saveDraft } from './services'
import { purchaseAmount, purchaseDefaults } from './item-form-defaults'
import { useLedger } from './store'

function FormFooter({ error, busy, onSave, onSecondary, saveLabel, disabled = false, secondaryLabel = '放弃草稿' }: { error: string; busy: boolean; onSave: () => void; onSecondary: () => void; saveLabel: string; disabled?: boolean; secondaryLabel?: string }) {
  return <><ErrorNote message={error} /><View className='form-footer-actions'><Action className='text-button' disabled={busy} onClick={onSecondary}>{secondaryLabel}</Action><Action className='primary' loading={busy} disabled={disabled} onClick={onSave}>{saveLabel}</Action></View></>
}

export function ItemForm({ item, onClose, prefill, draftKey, initialSpaceId, requestKey, onSaved, lockSpace = false }: { item?: Item; onClose: () => void; prefill?: Partial<ItemInput>; draftKey?: string; initialSpaceId?: string; requestKey?: string; onSaved?: (item: Item) => void; lockSpace?: boolean }) {
  const { data, spaceId, execute } = useLedger()
  const key = draftKey || `item-${item?.id || spaceId}`
  const [form, setForm] = useState(() => getDraft<{ input: ItemInput; amount: string; date: string; space: string; requestKey: string; revision?: number; blankPriceAsZero?: boolean }>(key) || {
    input: { name: item?.name || '', image: item?.image || '', imageFileId: item?.imageFileId, imagePresetId: item?.imagePresetId, purchaseAmount: item?.purchaseAmount ?? null, purchaseDate: item?.purchaseDate ?? null, note: item?.note || '', attachments: item?.attachments || [], ...prefill },
    ...purchaseDefaults(item, prefill), space: item?.spaceId || initialSpaceId || spaceId, requestKey: requestKey || uid(), revision: item?.revision,
  })
  const [mediaError, setMediaError] = useState('')
  useEffect(() => { try { saveDraft(key, form) } catch { setMediaError('草稿存储失败，请勿关闭页面，移除大图后重试') } }, [form, key])
  const { error, busy, submit } = useSubmit(() => { clearDraft(key); onClose() })
  const spaces = data.spaces.filter(canEdit)
  const writable = canEdit(data.spaces.find(s => s.id === (item?.spaceId || form.space)))
  const save = () => void submit(async () => {
    const input = { ...form.input, purchaseAmount: purchaseAmount(form.amount, form.blankPriceAsZero), purchaseDate: form.date || null }
    const next = await execute(item ? { type: 'edit', id: item.id, revision: form.revision ?? item.revision, input } : { type: 'create', spaceId: form.space, input, key: form.requestKey })
    const saved = next.items.find(i => item ? i.id === item.id : i.importKey === form.requestKey)
    if (saved) onSaved?.(saved)
  })
  return <Sheet title={item ? '编辑物品' : '记录新物品'} onClose={onClose} closeLabel='关闭并保留草稿' footer={<FormFooter error={error || mediaError || (!writable ? '当前空间已无写入权限，输入已保留' : '')} busy={busy} disabled={!writable} onSave={save} onSecondary={() => { clearDraft(key); onClose() }} saveLabel={item ? '保存修改' : '保存物品'} />}>
    <ItemFields amountPlaceholder={form.blankPriceAsZero ? '0.00' : '未填写'} input={form.input} amount={form.amount} date={form.date} disabled={busy} onError={setMediaError}
      onInput={patch => setForm(f => ({ ...f, input: { ...f.input, ...patch } }))}
      onAmount={amount => setForm(f => ({ ...f, amount }))} onDate={date => setForm(f => ({ ...f, date }))}
      spaceControl={!item && !lockSpace && <SelectField label='保存到' value={data.spaces.find(s => s.id === form.space)?.name || '请选择空间'} options={spaces.map(s => s.name)} disabled={busy} onChange={(_, i) => setForm(f => ({ ...f, space: spaces[i].id }))} />} />
  </Sheet>
}

export function ExpenseForm({ item, expense, onClose }: { item: Item; expense?: Expense; onClose: () => void }) {
  const { execute, data } = useLedger(); const writable = canEdit(data.spaces.find(s => s.id === item.spaceId)); const key = `expense-${item.id}-${expense?.id || 'new'}`
  const [form, setForm] = useState(() => getDraft<{ category: string; amount: string; date: string; note: string; id: string; revision?: number }>(key) || { category: expense?.category || '维修', amount: moneyInput(expense?.amount ?? null), date: expense?.date || today(), note: expense?.note || '', id: expense?.id || uid(), revision: item.revision })
  const [draftError, setDraftError] = useState('')
  useEffect(() => { try { saveDraft(key, form); setDraftError('') } catch { setDraftError('草稿存储失败，请勿关闭页面，当前填写内容仍保留') } }, [key, form])
  const { error, busy, submit } = useSubmit(() => { clearDraft(key); onClose() })
  const save = () => void submit(async () => { await execute({ type: 'expense', id: item.id, revision: form.revision ?? item.revision, expense: { ...form, amount: parseMoney(form.amount, true)! } }) })
  return <Sheet title={expense ? '更正支出记录' : '追加支出'} onClose={onClose} closeLabel='关闭并保留草稿' footer={<FormFooter error={error || draftError || (!writable ? '当前空间已无写入权限，输入已保留' : '')} busy={busy} disabled={!writable} onSave={save} onSecondary={() => { clearDraft(key); onClose() }} saveLabel='保存支出' />}>
    <Text className='form-intro'>{item.name}</Text>
    <View className='form-section'>
    <SelectField label='支出类别' value={form.category} options={['维修', '保养', '配件', '其他']} onChange={category => setForm(f => ({ ...f, category }))} />
    <Field label='实付金额（元）' value={form.amount} onChange={amount => setForm(f => ({ ...f, amount }))} type='digit' required />
    <DateField label='实际发生日期' value={form.date} onChange={date => setForm(f => ({ ...f, date }))} required />
    <Field label='备注' value={form.note} onChange={note => setForm(f => ({ ...f, note }))} placeholder='例如：更换电池' />
    </View>
  </Sheet>
}

export function DisposalForm({ item, onClose }: { item: Item; onClose: () => void }) {
  const { execute, data } = useLedger(); const writable = canEdit(data.spaces.find(s => s.id === item.spaceId)); const key = `disposal-${item.id}`
  const [form, setForm] = useState(() => getDraft<{ status: 'sold' | 'retired'; date: string; amount: string; zero: boolean; revision?: number }>(key) || { status: item.status === 'retired' ? 'retired' as const : 'sold' as const, date: item.disposalDate || today(), amount: moneyInput(item.recoveryAmount), zero: false, revision: item.revision })
  const [draftError, setDraftError] = useState('')
  useEffect(() => { try { saveDraft(key, form); setDraftError('') } catch { setDraftError('草稿存储失败，请勿关闭页面，当前填写内容仍保留') } }, [key, form])
  const { error, busy, submit } = useSubmit(() => { clearDraft(key); onClose() })
  const save = () => void submit(async () => { await execute({ type: 'dispose', id: item.id, revision: form.revision ?? item.revision, status: form.status, date: form.date, recovery: parseMoney(form.amount, true), confirmedZero: form.zero }) })
  return <Sheet title={item.disposalDate ? '更正处置信息' : '登记处置'} onClose={onClose} closeLabel='关闭并保留草稿' footer={<FormFooter error={error || draftError || (!writable ? '当前空间已无写入权限，输入已保留' : '')} busy={busy} disabled={!writable} onSave={save} onSecondary={onClose} secondaryLabel='稍后补充' saveLabel={item.disposalDate ? '保存更正' : '确认处置'} />}>
    <View className='segmented'>{(['sold', 'retired'] as const).map(status => <Action key={status} className={form.status === status ? 'selected' : ''} onClick={() => setForm(f => ({ ...f, status }))}>{status === 'sold' ? '已出售' : '已淘汰'}</Action>)}</View>
    <View className='form-section'>
    <DateField label='实际处置日期' value={form.date} onChange={date => setForm(f => ({ ...f, date }))} required />
    <Field label='实际回收金额（元）' value={form.amount} onChange={amount => setForm(f => ({ ...f, amount, zero: false }))} type='digit' placeholder='0.00' required />
    <Action className={`check-row ${form.zero ? 'checked' : ''}`} onClick={() => setForm(f => ({ ...f, zero: !f.zero, amount: !f.zero ? '0.00' : f.amount }))}><Text>{form.zero ? '☑' : '□'}</Text>我确认本次没有收到回收款（0 元）</Action>
    </View>
  </Sheet>
}
