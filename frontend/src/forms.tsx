import { useEffect, useRef, useState } from 'react'
import { Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { Action, DateField, destructiveColor, ErrorNote, Field, SelectField, Sheet, useSubmit } from './components'
import { canEdit, Expense, Item, ItemInput, moneyInput, parseMoney, today, uid } from './domain'
import { ItemFields } from './item-fields'
import { clearDraft, getDraft, saveDraft } from './services'
import { purchaseAmount, purchaseDefaults } from './item-form-defaults'
import { revisionAction, sameFormValues } from './form-draft'
import { useLedger } from './store'

// Stores a draft only once it differs from the record, and reconciles a draft
// whose base revision is older than the record. `initial` reads current props.
function useRecordDraft<T extends { revision?: number }>(key: string, initial: () => T, currentRevision: number | undefined, correction: boolean, saving: boolean) {
  const base = useRef<T | null>(null)
  if (!base.current) base.current = initial()
  const [form, setForm] = useState<T>(() => getDraft<T>(key) || base.current!)
  const [restored, setRestored] = useState(() => !sameFormValues(form, base.current!))
  const [storageFailed, setStorageFailed] = useState(false)
  const edited = !sameFormValues(form, base.current)
  useEffect(() => {
    try { if (edited) saveDraft(key, form); else clearDraft(key); setStorageFailed(false) }
    catch { setStorageFailed(true) }
  }, [key, form, edited])
  // A successful save also bumps the revision; leave that to the closing form.
  const action = saving ? 'none' : revisionAction({ draftRevision: form.revision, currentRevision, edited, correction })
  const takeLatest = () => { const next = initial(); base.current = next; setForm(next); setRestored(false) }
  useEffect(() => {
    if (action === 'reset') takeLatest()
    else if (action === 'rebase') setForm(f => ({ ...f, revision: currentRevision }))
  }, [action, currentRevision])
  const keepMine = () => { base.current = initial(); setForm(f => ({ ...f, revision: currentRevision })); setRestored(false) }
  return { form, setForm, edited, restored: restored && edited, conflict: action === 'confirm', keepMine, takeLatest, storageFailed }
}

async function confirmDiscard() {
  const result = await Taro.showModal({ title: '放弃这次修改？', content: '未保存的填写将被清除。', confirmText: '放弃', confirmColor: destructiveColor })
  return result.confirm
}

function DraftNotice({ conflict, restored, disabled, onKeep, onLatest }: { conflict: boolean; restored: boolean; disabled: boolean; onKeep: () => void; onLatest: () => void }) {
  if (conflict) return <View className='form-notice form-notice-conflict' role='alert'><Text>档案已在别处更新，你的填写已保留。</Text><View className='form-notice-actions'><Action className='text-button' disabled={disabled} onClick={onKeep}>保留我的填写</Action><Action className='text-button' disabled={disabled} onClick={onLatest}>采用最新资料</Action></View></View>
  return restored ? <View className='form-notice' role='status'><Text>已恢复上次未保存的填写</Text></View> : null
}

function FormFooter({ error, busy, onSave, onSecondary, saveLabel, secondaryLabel, disabled = false }: { error: string; busy: boolean; onSave: () => void; onSecondary: () => void; saveLabel: string; secondaryLabel: string; disabled?: boolean }) {
  return <><ErrorNote message={error} /><View className='form-footer-actions'><Action className='text-button' disabled={busy} onClick={onSecondary}>{secondaryLabel}</Action><Action className='primary' loading={busy} disabled={disabled} onClick={onSave}>{saveLabel}</Action></View></>
}

type ItemFormState = { input: ItemInput; amount: string; date: string; space: string; requestKey: string; revision?: number; blankPriceAsZero?: boolean }

export function ItemForm({ item, onClose, prefill, draftKey, initialSpaceId, requestKey, onSaved, lockSpace = false }: { item?: Item; onClose: () => void; prefill?: Partial<ItemInput>; draftKey?: string; initialSpaceId?: string; requestKey?: string; onSaved?: (item: Item) => void; lockSpace?: boolean }) {
  const { data, spaceId, execute } = useLedger()
  const key = draftKey || `item-${item?.id || spaceId}`
  const { error, busy, submit } = useSubmit(() => { clearDraft(key); onClose() })
  const draft = useRecordDraft<ItemFormState>(key, () => ({
    input: { name: item?.name || '', image: item?.image || '', imageFileId: item?.imageFileId, imagePresetId: item?.imagePresetId, purchaseAmount: item?.purchaseAmount ?? null, purchaseDate: item?.purchaseDate ?? null, note: item?.note || '', attachments: item?.attachments || [], ...prefill },
    ...purchaseDefaults(item, prefill), space: item?.spaceId || initialSpaceId || spaceId, requestKey: requestKey || uid(), revision: item?.revision,
  }), item?.revision, !!item, busy)
  const { form, setForm } = draft
  const [mediaError, setMediaError] = useState('')
  const spaces = data.spaces.filter(canEdit)
  const writable = canEdit(data.spaces.find(s => s.id === (item?.spaceId || form.space)))
  const save = () => void submit(async () => {
    const input = { ...form.input, purchaseAmount: purchaseAmount(form.amount, form.blankPriceAsZero), purchaseDate: form.date || null }
    const next = await execute(item ? { type: 'edit', id: item.id, revision: form.revision ?? item.revision, input } : { type: 'create', spaceId: form.space, input, key: form.requestKey })
    const saved = next.items.find(i => item ? i.id === item.id : i.importKey === form.requestKey)
    if (saved) onSaved?.(saved)
  })
  const leave = async () => { if (draft.edited && !await confirmDiscard()) return; clearDraft(key); onClose() }
  return <Sheet title={item ? '编辑物品' : '记录新物品'} onClose={onClose} closeLabel='关闭并保留草稿' footer={<FormFooter error={error || mediaError || (draft.storageFailed ? '草稿存储失败，请勿关闭页面，移除大图后重试' : '') || (!writable ? '当前空间已无写入权限，输入已保留' : '')} busy={busy} disabled={!writable || draft.conflict} onSave={save} onSecondary={() => void leave()} secondaryLabel={draft.edited ? '放弃修改' : '取消'} saveLabel={item ? '保存修改' : '保存物品'} />}>
    <DraftNotice conflict={draft.conflict} restored={draft.restored} disabled={busy} onKeep={draft.keepMine} onLatest={draft.takeLatest} />
    <ItemFields amountPlaceholder={form.blankPriceAsZero ? '0.00' : '未填写'} input={form.input} amount={form.amount} date={form.date} disabled={busy} onError={setMediaError}
      onInput={patch => setForm(f => ({ ...f, input: { ...f.input, ...patch } }))}
      onAmount={amount => setForm(f => ({ ...f, amount }))} onDate={date => setForm(f => ({ ...f, date }))}
      spaceControl={!item && !lockSpace && <SelectField label='保存到' value={data.spaces.find(s => s.id === form.space)?.name || '请选择空间'} options={spaces.map(s => s.name)} disabled={busy} onChange={(_, i) => setForm(f => ({ ...f, space: spaces[i].id }))} />} />
  </Sheet>
}

export function ExpenseForm({ item, expense, onClose }: { item: Item; expense?: Expense; onClose: () => void }) {
  const { execute, data } = useLedger(); const writable = canEdit(data.spaces.find(s => s.id === item.spaceId)); const key = `expense-${item.id}-${expense?.id || 'new'}`
  const { error, busy, submit } = useSubmit(() => { clearDraft(key); onClose() })
  // Correcting a saved expense can overwrite another edit; adding one cannot.
  const draft = useRecordDraft(key, () => ({ category: expense?.category || '维修', amount: moneyInput(expense?.amount ?? null), date: expense?.date || today(), note: expense?.note || '', id: expense?.id || uid(), revision: item.revision }), item.revision, !!expense, busy)
  const { form, setForm } = draft
  const save = () => void submit(async () => { await execute({ type: 'expense', id: item.id, revision: form.revision ?? item.revision, expense: { ...form, amount: parseMoney(form.amount, true)! } }) })
  const leave = async () => { if (draft.edited && !await confirmDiscard()) return; clearDraft(key); onClose() }
  return <Sheet title={expense ? '更正支出记录' : '追加支出'} onClose={onClose} closeLabel='关闭并保留草稿' footer={<FormFooter error={error || (draft.storageFailed ? '草稿存储失败，请勿关闭页面，当前填写内容仍保留' : '') || (!writable ? '当前空间已无写入权限，输入已保留' : '')} busy={busy} disabled={!writable || draft.conflict} onSave={save} onSecondary={() => void leave()} secondaryLabel={draft.edited ? '放弃修改' : '取消'} saveLabel='保存支出' />}>
    <DraftNotice conflict={draft.conflict} restored={draft.restored} disabled={busy} onKeep={draft.keepMine} onLatest={draft.takeLatest} />
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
  const { error, busy, submit } = useSubmit(() => { clearDraft(key); onClose() })
  // A first disposal only adds a record; a recorded disposal is a correction.
  const draft = useRecordDraft(key, () => ({ status: item.status === 'retired' ? 'retired' as const : 'sold' as const, date: item.disposalDate || today(), amount: moneyInput(item.recoveryAmount), zero: false, revision: item.revision }), item.revision, !!item.disposalDate, busy)
  const { form, setForm } = draft
  const save = () => void submit(async () => { await execute({ type: 'dispose', id: item.id, revision: form.revision ?? item.revision, status: form.status, date: form.date, recovery: parseMoney(form.amount, true), confirmedZero: form.zero }) })
  return <Sheet title={item.disposalDate ? '更正处置信息' : '登记处置'} onClose={onClose} closeLabel='关闭并保留草稿' footer={<FormFooter error={error || (draft.storageFailed ? '草稿存储失败，请勿关闭页面，当前填写内容仍保留' : '') || (!writable ? '当前空间已无写入权限，输入已保留' : '')} busy={busy} disabled={!writable || draft.conflict} onSave={save} onSecondary={onClose} secondaryLabel='稍后补充' saveLabel={item.disposalDate ? '保存更正' : '确认处置'} />}>
    <DraftNotice conflict={draft.conflict} restored={draft.restored} disabled={busy} onKeep={draft.keepMine} onLatest={draft.takeLatest} />
    <View className='segmented'>{(['sold', 'retired'] as const).map(status => <Action key={status} className={form.status === status ? 'selected' : ''} onClick={() => setForm(f => ({ ...f, status }))}>{status === 'sold' ? '已出售' : '已淘汰'}</Action>)}</View>
    <View className='form-section'>
    <DateField label='实际处置日期' value={form.date} onChange={date => setForm(f => ({ ...f, date }))} required />
    <Field label='实际回收金额（元）' value={form.amount} onChange={amount => setForm(f => ({ ...f, amount, zero: false }))} type='digit' placeholder='0.00' required />
    <Action className={`check-row ${form.zero ? 'checked' : ''}`} label={`${form.zero ? '已确认' : '确认'}本次没有收到回收款（0 元）`} onClick={() => setForm(f => ({ ...f, zero: !f.zero, amount: !f.zero ? '0.00' : f.amount }))}><View className='check-box'>{form.zero && <Text>✓</Text>}</View><Text>我确认本次没有收到回收款（0 元）</Text></Action>
    </View>
  </Sheet>
}
