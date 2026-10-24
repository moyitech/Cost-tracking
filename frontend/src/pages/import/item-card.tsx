import { useEffect, useRef, useState } from 'react'
import { ScrollView, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { Action, ErrorNote } from '../../components'
import { validateInput } from '../../domain'
import { ItemFields } from '../../item-fields'
import { imports, ImportClient, ImportEntry, ImportTask } from '../../import-api'
import { adoptRevision, reviewBody, reviewDraft, reviewInput, ReviewDraft } from '../../import-review'
import { inputBody, UploadCache } from '../../services'
import { DuplicateNotice } from './duplicate-notice'

export function ImportItemCard({ task, entry, draft, onDraft, disabled, onWorking, onTask, onSaved, uploads, client = imports, prepare = inputBody }: {
  task: ImportTask; entry: ImportEntry; draft: ReviewDraft; onDraft: (draft: ReviewDraft) => void; disabled: boolean
  onWorking: (working: boolean) => void; onTask: (task: ImportTask) => void; onSaved: (id: string) => void
  uploads: UploadCache[]; client?: ImportClient; prepare?: typeof inputBody
}) {
  const lock = useRef(false); const active = useRef(true)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const stale = draft.revision !== entry.revision
  const update = (patch: Partial<ReviewDraft>) => { if (active.current) { onDraft({ ...draft, ...patch }); setError('') } }
  const finish = (next: ImportTask) => { if (active.current) { onWorking(false); onTask(next); const savedId = next.entries.find(e => e.id === entry.id)?.saved_item_id; if (savedId) onSaved(savedId); void Taro.showToast({ title: '已保存物品', icon: 'success' }) } }
  const save = async () => {
    if (lock.current || disabled) return
    lock.current = true; setBusy(true); onWorking(true); setError('')
    try {
      const currentTask = await client.get(task.id)
      if (!active.current) return
      const current = currentTask.entries.find(e => e.id === entry.id)
      if (current?.saved_item_id) { finish(currentTask); return }
      if (!current || !current.included) { onTask(currentTask); throw new Error('此物品已移除，请查看其他物品') }
      if (current.revision !== draft.revision) { onTask(currentTask); throw new Error('识别结果已更新，请先选择保留填写或采用新结果') }
      const input = reviewInput(draft); validateInput(input)
      const values = await prepare(input, task.space_id, uploads)
      if (!active.current) return
      const saved = await client.patch(task.id, entry.id, draft.revision, {
        ...reviewBody(draft, true),
        values,
      })
      // Keep the new revision in page memory before commit or retry.
      const nextDraft = { ...draft, revision: saved.revision }
      if (!active.current) return
      onDraft(nextDraft)
      onTask({ ...currentTask, entries: currentTask.entries.map(e => e.id === saved.id ? saved : e) })
      if (saved.duplicate_candidates.length && saved.duplicate_decision !== 'create_independent') throw new Error('已有相似物品，请先选择是否为另一件')
      const result = await client.commit(task.id, [{ entry_id: saved.id, revision: saved.revision }], `save-${saved.id}-${saved.revision}`)
      const row = result.results[0]
      if (row?.status !== 'saved' && row?.status !== 'already_saved') throw new Error(row?.error?.message || '保存未完成，请核对后重试')
      finish({ ...currentTask, entries: currentTask.entries.map(e => e.id === saved.id ? { ...saved, saved_item_id: row.item_id || 'saved' } : e) })
    } catch (e) {
      if (!active.current) return
      setError(e instanceof Error ? e.message : '保存失败，输入已保留')
      // A timeout may follow a successful commit. Recover without creating a second item.
      try { const next = await client.get(task.id); if (next.entries.find(x => x.id === entry.id)?.saved_item_id) finish(next); else if (active.current) onTask(next) } catch { /* preserve local input */ }
    } finally { lock.current = false; if (active.current) { setBusy(false); onWorking(false) } }
  }
  const skip = async () => {
    if (lock.current || disabled) return
    lock.current = true; setBusy(true); onWorking(true); setError('')
    try { const saved = await client.patch(task.id, entry.id, entry.revision, { included: false, confirmed: false }); if (active.current) { onWorking(false); onTask({ ...task, entries: task.entries.map(e => e.id === saved.id ? saved : e) }) } }
    catch (e) { if (active.current) setError(e instanceof Error ? e.message : '暂时无法跳过，请重试') }
    finally { lock.current = false; if (active.current) { setBusy(false); onWorking(false) } }
  }
  // Rendering should not parse an unfinished monetary input such as "12.".
  const input = reviewInput({ ...draft, amount: '' })
  return <View className='import-item-card'>
    <ScrollView scrollY className='import-item-scroll'>
      <View className='import-item-fields'>
        {stale && <View className='import-version'><Text>识别结果有更新，你的填写已保留。</Text><View className='row'><Action className='text-button' disabled={busy || disabled} onClick={() => update(adoptRevision(draft, entry.revision))}>保留我的填写</Action><Action className='text-button' disabled={busy || disabled} onClick={() => { onDraft(reviewDraft(entry)); setError('') }}>采用新结果</Action></View></View>}
        <ItemFields amountPlaceholder='未识别' temporaryPictures input={input} amount={draft.amount} date={draft.date} disabled={busy || disabled} onError={setError}
          onInput={patch => update({ ...patch, ...('name' in patch ? { decision: null, existing: null } : {}) })}
          onAmount={amount => update({ amount })} onDate={date => update({ date })} />
        <DuplicateNotice candidates={entry.duplicate_candidates} selected={draft.decision === 'create_independent'} disabled={busy || disabled} onSkip={() => void skip()} onSelect={() => update({ decision: 'create_independent', existing: null })} />

      </View>
    </ScrollView>
    <View className='import-item-footer'><ErrorNote message={error} /><View className='form-footer-actions'><Action className='text-button' disabled={busy || disabled} onClick={() => void skip()}>跳过此件</Action><Action className='primary' loading={busy} disabled={disabled || stale} onClick={() => void save()}>保存物品</Action></View></View>
  </View>
}
