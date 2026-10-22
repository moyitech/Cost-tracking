import { useEffect, useRef, useState } from 'react'
import { Input, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { assets } from '../../assets'
import { Action, choosePictures, DateField, SelectField, ErrorNote, goBack, Header, Icon, Photo, Pill, Sheet } from '../../components'
import { canEdit, categories, ItemInput, money, moneyInput, parseMoney, uid } from '../../domain'
import { entrySource, MockSource, recognizeMockSources } from '../../import-mock'
import { ItemForm } from '../../forms'
import { clearDraft, getDraft, mockEnabled, saveDraft } from '../../services'
import { useAdaptiveLayout } from '../../layout'
import { useLedger } from '../../store'

type Entry = { key: string; name: string; amount: string; date: string; category: string; model: string; brand: string; image: string; included: boolean; confirmed: boolean; independent: boolean; savedId?: string; error?: string }
type Draft = { spaceId: string; entries: Entry[]; sources: MockSource[] }
function demoEntries(): Entry[] {
  return [
    { key: uid(), name: 'Sony Alpha 7 IV 全画幅微单机身', amount: '14600.00', date: '2023-09-01', category: '数码摄影', model: 'ILCE-7M4', brand: 'Sony', image: assets['import-photo1'].src, included: true, confirmed: false, independent: false },
    { key: uid(), name: 'SanDisk 闪迪 128GB V90 SDXC 存储卡', amount: '499.00', date: '', category: '存储耗材与配件', model: 'SDXC UHS-II', brand: 'SanDisk', image: assets['import-photo2'].src, included: true, confirmed: false, independent: false },
  ]
}
export default function ImportReview() {
  const layout = useAdaptiveLayout()
  const { data, spaceId, execute } = useLedger()
  const [draft, setDraft] = useState<Draft>(() => {
    const saved = getDraft<Draft & { sourceNames?: string[] }>('import')
    if (saved) return { ...saved, sources: saved.sources.map((source, i) => typeof source === 'string' ? { id: uid(), path: source, name: saved.sourceNames?.[i] || `订单截图 ${i + 1}`, status: 'ready' as const, attempts: 1 } : source) }
    return { spaceId, entries: demoEntries(), sources: [{ id: uid(), path: assets['import-photo0'].src, name: 'Screenshot_JD_20230901.jpg', status: 'ready', attempts: 1 }] }
  })
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const lock = useRef(false)
  const [manual, setManual] = useState<Entry | null>(null); const [sourceSheet, setSourceSheet] = useState(false)
  const [scenario, setScenario] = useState('全部成功')
  const [stage, setStage] = useState(''); const [justSaved, setJustSaved] = useState(false)
  const spaces = data.spaces.filter(canEdit); const space = data.spaces.find(s => s.id === draft.spaceId)
  useEffect(() => { if (!justSaved) { try { saveDraft('import', draft) } catch { setError('草稿存储空间不足，请移除部分截图；当前输入仍保留在页面内') } } }, [draft, justSaved])
  const update = (index: number, patch: Partial<Entry>) => { setJustSaved(false); setDraft(d => ({ ...d, entries: d.entries.map((entry, i) => i === index ? { ...entry, error: '', ...patch } : entry) })) }
  const startNew = () => { setJustSaved(false); setError(''); setDraft({ spaceId, entries: demoEntries(), sources: [{ id: uid(), path: assets['import-photo0'].src, name: '示例订单截图', status: 'ready', attempts: 1 }] }) }
  const openManual = () => { const entry = selected[0]; if (!entry) { setError('没有待录入条目，请先开始新一批导入'); return } setManual(entry) }

  const duplicates = (entry: Entry) => data.items.filter(i => !i.deleted && i.spaceId === draft.spaceId && i.importKey !== entry.key && (i.model && i.model.toLowerCase() === entry.model.toLowerCase() || i.name === entry.name))
  const selected = draft.entries.filter(e => e.included && !e.savedId)
  const total = selected.reduce((sum, entry) => { try { return sum + (parseMoney(entry.amount) ?? 0) } catch { return sum } }, 0)
  const unknown = selected.some(e => !e.amount.trim())
  const savedTotal = draft.entries.filter(e => e.savedId).reduce((sum, e) => sum + (parseMoney(e.amount) ?? 0), 0)
  const exit = async () => { try { const result = await Taro.showActionSheet({ itemList: ['保留草稿并返回', '放弃本次导入'] }); if (result.tapIndex === 1) clearDraft('import'); goBack() } catch { /* dismissed */ } }
  const pick = async () => {
    setError('')
    try { const paths = await choosePictures(9); setJustSaved(false); setDraft(d => ({ ...d, sources: [...d.sources.filter(p => p.path !== assets['import-photo0'].src), ...paths.map((path, i) => ({ id: uid(), path, name: `订单截图 ${d.sources.length + i + 1}`, status: 'pending' as const, attempts: 0 }))] })); setSourceSheet(true) }
    catch (e) { if (!String(e).includes('cancel')) setError('图片读取失败，已保留校对内容，请重新选图') }
  }
  const simulate = async (retryId?: string) => {
    if (lock.current || !draft.sources.length) return
    lock.current = true; setBusy(true); setError('')
    try {
      setStage('正在模拟上传…'); await new Promise(resolve => setTimeout(resolve, 250))
      setStage('正在模拟识别…'); await new Promise(resolve => setTimeout(resolve, 350))
      const sources = recognizeMockSources(draft.sources, scenario === '部分识别失败', retryId)
      setDraft(d => ({ ...d, sources, entries: d.entries.map(entry => entry.error?.includes('来源图片') ? { ...entry, error: '' } : entry) })); setJustSaved(false)
      void Taro.showToast({ title: sources.some(s => s.status === 'failed') ? '部分图片模拟失败，可逐图重试' : '示例结果已就绪，人工修改已保留', icon: 'none' })
    } finally { setStage(''); setBusy(false); lock.current = false }
  }
  const save = async () => {
    if (lock.current || !selected.length) return
    if (!mockEnabled) { setError('真实截图识别服务尚未接入，请使用手动建档'); return }
    lock.current = true; setBusy(true); setError('')
    let failures = 0
    for (const entry of selected) {
      const index = draft.entries.findIndex(e => e.key === entry.key)
      try {
        const source = entrySource(draft.sources, index)
        if (!source || source.status !== 'ready') throw new Error('来源图片尚未就绪，请在原图管理中模拟识别或重试，也可转为手动录入')
        if (!entry.confirmed) throw new Error('请先核对并确认本件，或将未知金额留空后确认')
        if (duplicates(entry).length && !entry.independent) throw new Error('请先判断是否为另一件实物，或跳过已有实物')
        const input: ItemInput = { name: entry.name, purchaseAmount: parseMoney(entry.amount), purchaseDate: entry.date || null, category: entry.category, brand: entry.brand, model: entry.model, image: entry.image, channel: '', location: '', warranty: '', serial: '', note: '从示例识别校对建立（mock）', attachments: draft.sources.map(source => ({ name: source.name, path: source.path })) }
        const next = await execute({ type: 'create', spaceId: draft.spaceId, input, key: entry.key })
        const saved = next.items.find(i => i.importKey === entry.key)!
        update(index, { savedId: saved.id, error: '' })
      } catch (e) { failures++; update(index, { error: e instanceof Error ? e.message : '保存失败，请重试' }) }
    }
    if (failures) setError(`${failures} 件尚未保存，请处理卡片中的提示。已保存的物品不会重复创建。`)
    else { setJustSaved(true); clearDraft('import'); void Taro.showToast({ title: '已保存到目标空间', icon: 'success' }) }
    lock.current = false; setBusy(false)
  }
  return <View className='page import-page' style={layout.style}>
    <Header title='AI 智能识别校对' back onBack={() => void exit()} />
    <View className='import-content'>
      <View className='import-context'><Action onClick={() => void exit()}>取消本次</Action><Pill tone='green' dot>{stage || 'AI 识别复核中'}</Pill><Action disabled={busy || !selected.length || !canEdit(space)} onClick={() => void save()}>直接保存</Action></View>
      <View className='card import-overview'><View className='overview-icon'><Icon name='import-container' /></View><View><View className='row spread'><Text className='overview-heading'>待校对 {draft.entries.length} 件物品</Text><Pill tone='green'>示例数据</Pill></View><Text className='small muted'>这是本地模拟结果，未调用 AI。金额、日期及优惠归属需逐件核对后确认。</Text></View></View>
      <Action className='card source-card' onClick={() => setSourceSheet(true)}><Photo src={draft.sources[0]?.path || ''} /><View className='source-info'><View className='row'><Text>{draft.sources[0]?.name || '尚未选择截图'}</Text><Icon name='import-container1' /></View><Text className='small muted'>{draft.sources.length} 张图片 · 点击对照与管理来源</Text></View><Text className='small'>对照原图</Text><Icon name='import-container3' /></Action>
      <View className='mock-inline'><Icon name='import-container2' /><Text>示例结果不代表对你所选图片的真实识别。图片仅保存在本机。</Text></View>
      {draft.entries.map((entry, index) => {
        const similar = duplicates(entry); const saved = !!entry.savedId
        return <View key={entry.key} className={`card review-card ${!entry.included ? 'excluded' : ''}`}>
          {index === 1 && <View className='duplicate-banner'><Icon name='import-margin' /><View><Text>组合优惠价需要人工核对</Text><Text>商品标价不等于单件实付。无法确定分摊时，请将金额留空，不自动平均分摊。</Text></View></View>}
          <View className='review-card-heading'><View className='row'><View className='number-circle'>{index + 1}</View><Text>{index === 0 ? '主设备 · 核心资产' : '配附件 · 待复核项'}</Text></View><Pill tone={entry.confirmed || saved ? 'green' : 'amber'}>{index === 0 ? <Icon name='import-container4' /> : <Icon name='import-container13' />}{saved ? '已保存' : entry.confirmed ? '已核对' : '待人工确认'}</Pill></View>
          <View className='review-identity'><Action className='review-photo' disabled={saved || busy} onClick={() => { void (async () => { try { const [image] = await choosePictures(); update(index, { image }) } catch { /* cancelled */ } })() }}><Photo src={entry.image} /><Text>换图</Text></Action><View className='review-fields'><View className='row spread'><Text className='small muted'>识别名称</Text><Text className='confidence'>{index === 0 ? '示例提取' : '建议核对'}</Text></View><Input ariaLabel={`物品 ${index + 1} 名称`} value={entry.name} disabled={saved || busy} onInput={e => update(index, { name: e.detail.value, confirmed: false })} /><View className='row'><Input className='model-input' ariaLabel={`物品 ${index + 1} 型号`} value={entry.model} disabled={saved || busy} onInput={e => update(index, { model: e.detail.value, independent: false, confirmed: false })} /><Pill>{entry.brand}</Pill></View></View></View>
          <View className='price-card'><View className='row spread'><View className='row'><Text>{index === 0 ? '实付入账金额' : '组合优惠价识别提示'}</Text><Icon name={index === 0 ? 'import-container5' : 'import-container14'} /></View><Text className='small muted'>{index === 0 ? '订单票面 ¥15,899' : '原标价 ¥799'}</Text></View><View className='price-input'><Text>¥</Text><Input type='digit' ariaLabel={`物品 ${index + 1} 实付金额`} placeholder='未知，待补充' value={entry.amount} disabled={saved || busy} onInput={e => update(index, { amount: e.detail.value, confirmed: false })} /></View><View className='price-hint'><Icon name={index === 0 ? 'import-container6' : 'import-container15'} /><Text>{index === 0 ? '优惠 ¥1,299 仅为示例；请核对实际单件支付金额。' : '无法确认可留空，赠品需明确为 0 元。'}</Text>{index === 1 && <Action disabled={saved || busy} onClick={() => update(index, { amount: '0.00', confirmed: false })}>设为赠品 (¥0)</Action>}</View><Action disabled={saved || busy} className='text-button small muted' onClick={() => update(index, { amount: '', confirmed: false })}>金额未知，先留空</Action></View>
          <View className='review-details'>
            <DateField label={`物品 ${index + 1} 购入日期`} value={entry.date} disabled={saved || busy} onChange={date => update(index, { date, confirmed: false })} />
            <SelectField label={`物品 ${index + 1} 分类`} value={entry.category} options={categories} disabled={saved || busy} onChange={category => update(index, { category, confirmed: false })} />
            <SelectField label='归入空间' value={space?.name || ''} options={spaces.map(s => s.name)} disabled={busy || draft.entries.some(e => e.savedId)} onChange={(_, i) => setDraft(d => ({ ...d, spaceId: spaces[i].id, entries: d.entries.map(e => ({ ...e, independent: false, confirmed: false })) }))} />
          </View>
          {!saved && entrySource(draft.sources, index)?.status !== 'ready' && <ErrorNote message='本件来源图片尚未识别成功，可管理原图并重试，或点击「转手输」保留字段后手动录入。' />}

          {!!similar.length && !saved && <View className='duplicate-choice'><Text className='notice-title'>当前空间存在相同型号：{similar[0].name}</Text><View className='row'><Action className='secondary' onClick={() => update(index, { included: false, error: '' })}>同一件，跳过</Action><Action className={entry.independent ? 'primary' : 'secondary'} onClick={() => update(index, { independent: true, included: true })}>{entry.independent ? '✓ 已确认为另一件' : '另一件，独立建档'}</Action></View><Action className='text-button' onClick={() => Taro.navigateTo({ url: `/pages/detail/index?id=${similar[0].id}` })}>查看已有档案 ›</Action></View>}
          <View className='review-actions'>{saved ? <Action className='green-text' onClick={() => Taro.navigateTo({ url: `/pages/detail/index?id=${entry.savedId}` })}>已保存 · 查看物品档案 ›</Action> : <><Action className='danger' disabled={busy} onClick={() => update(index, { included: !entry.included, error: '' })}><Icon name='import-container16' />{entry.included ? '放弃此件' : '恢复此件'}</Action><Action className='confirm-item' disabled={!entry.included || busy} onClick={() => update(index, { confirmed: !entry.confirmed })}><Icon name='import-container17' />{entry.confirmed ? '已核对，取消确认' : '保留并确认'}</Action></>}</View><ErrorNote message={entry.error || ''} />
        </View>
      })}
      <View className='card import-guidance'><Icon name='import-margin1' /><View><Text>识别不理想或票面有遮挡？</Text><Text className='small muted'>直接修改字段，未知信息可以留空。关闭页面会保留校对草稿；未保存内容不参与统计。</Text></View></View>
      <ErrorNote message={error} />
      {justSaved && <Action className='primary submit-button' onClick={goBack}>保存完成，返回物品列表</Action>}{!selected.length && <Action className='secondary submit-button' onClick={startNew}>开始新一批导入</Action>}
    </View>
    <View className='bottom-dock import-dock'><Action className='dock-small' disabled={busy || draft.entries.some(e => e.savedId)} onClick={() => void pick()}><Icon name='import-container18' /><Text>选截图</Text></Action><Action className='dock-small' disabled={busy || !selected.length || !canEdit(space)} onClick={openManual}><Icon name='import-container19' /><Text>转手输</Text></Action><Action className='primary import-save' disabled={!selected.length || !canEdit(space)} loading={busy} onClick={() => void save()}><View><Text>{selected.length ? `保存 ${selected.length} 件至${space?.name || '目标空间'}` : '本次校对已完成'}</Text><Text className='save-total'>{selected.length ? unknown ? '已知金额' : '总计入账' : '已保存金额'} ¥{money(selected.length ? total : savedTotal)}</Text></View><View className='save-arrow'><Icon name='import-container20' /></View></Action></View>
    {manual && !sourceSheet && <ItemForm lockSpace draftKey={`import-manual-${manual.key}`} initialSpaceId={draft.spaceId} requestKey={manual.key} prefill={{ name: manual.name, brand: manual.brand, model: manual.model, category: manual.category, image: manual.image, purchaseAmount: (() => { try { return parseMoney(manual.amount) } catch { return null } })(), purchaseDate: manual.date || null, attachments: draft.sources.map(s => ({ name: s.name, path: s.path })) }} onSaved={item => update(draft.entries.findIndex(e => e.key === manual.key), { savedId: item.id, confirmed: true, error: '', name: item.name, amount: moneyInput(item.purchaseAmount), date: item.purchaseDate || '', category: item.category })} onClose={() => setManual(null)} />}
    {sourceSheet && <Sheet title='对照原图与管理截图' onClose={() => setSourceSheet(false)}>
      <Text className='form-intro'>本地 Mock，不上传也不读取图片文字。选择模拟场景可验证成功、失败和重试；单图场景会使该图失败。示例商品字段始终保留人工修改。</Text>
      <SelectField label='模拟识别结果' value={scenario} options={['全部成功', '部分识别失败']} disabled={busy} onChange={setScenario} />
      <View className='source-grid'>{draft.sources.map((source, index) => <View key={source.id}>
        <Action onClick={() => Taro.previewImage({ urls: draft.sources.map(s => s.path), current: source.path })}><Photo src={source.path} /></Action><Text className='small'>{source.name}</Text>
        <Text className={`source-state ${source.status}`}>{source.status === 'failed' ? '模拟识别失败' : source.status === 'pending' ? '等待模拟识别' : '示例识别完成'} · 已尝试 {source.attempts} 次</Text>
        {source.status === 'failed' && <Action className='secondary' loading={busy} onClick={() => void simulate(source.id)}>重试此图</Action>}
        <Action className='text-button danger' disabled={busy || draft.entries.some(e => e.savedId)} onClick={() => setDraft(d => ({ ...d, sources: d.sources.filter((_, i) => i !== index) }))}>移除此图</Action>
      </View>)}</View>
      <Action className='secondary' disabled={busy || draft.entries.some(e => e.savedId)} onClick={() => void pick()}>＋ 继续选择截图</Action>
      <Action className='primary submit-button' loading={busy} onClick={() => void simulate()} disabled={!draft.sources.length || draft.entries.some(e => e.savedId)}>{stage || '运行模拟识别'}</Action>
      <Action className='secondary submit-button' disabled={busy} onClick={() => setSourceSheet(false)}>返回校对结果</Action>
    </Sheet>}

  </View>
}
