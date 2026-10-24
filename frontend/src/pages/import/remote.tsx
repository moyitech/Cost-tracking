import { useEffect, useRef, useState } from 'react'
import { Swiper, SwiperItem, Text, View } from '@tarojs/components'
import Taro, { useDidHide, useDidShow, useUnload } from '@tarojs/taro'
import { Action, choosePictures, Empty, ErrorNote, goBack, Header } from '../../components'
import { canEdit, uid } from '../../domain'
import { ItemForm } from '../../forms'
import { imports, ImportClient, ImportTask } from '../../import-api'
import { reviewCards, reviewDraft, ReviewDraft } from '../../import-review'
import { carouselIndex, ImportLifetime, ImportPhase, importReviewComplete, mergeReviewDrafts, shouldPoll, uploadSources } from '../../import-flow'
import { clearImportDrafts, inputBody, UploadCache, uploadImage } from '../../services'
import { useAdaptiveLayout } from '../../layout'
import { useLedger } from '../../store'
import { ImportItemCard } from './item-card'
import { takeImportPictures } from '../../import-selection'
import { createUploadProgress } from '../../upload-progress'
import { RecognitionMotion } from './recognition-motion'
import './remote.scss'

export default function RemoteImport({ client = imports, upload = uploadImage, prepare = inputBody, demo = false }: {
  client?: ImportClient; upload?: typeof uploadImage; prepare?: typeof inputBody; demo?: boolean
}) {
  const layout = useAdaptiveLayout(); const { data, spaceId, importSaved } = useLedger()
  const [initial] = useState(() => takeImportPictures())
  const started = useRef(false); const picking = useRef(false)
  const returningHome = useRef(false)
  const [target, setTarget] = useState(initial?.spaceId || spaceId); const [task, setTask] = useState<ImportTask | null>(null)
  const [paths, setPaths] = useState<string[]>(initial?.paths || []); const [drafts, setDrafts] = useState<Record<string, ReviewDraft>>({})
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [working, setWorking] = useState(false)
  const [phase, setPhase] = useState<ImportPhase>('select'); const [uploaded, setUploaded] = useState(0)
  const [uploadPercent, setUploadPercent] = useState(0)
  const uploadProgress = useRef<ReturnType<typeof createUploadProgress> | null>(null)
  const [manual, setManual] = useState(false); const [index, setIndex] = useState(0)
  const [visible, setVisible] = useState(true); const [pollEpoch, setPollEpoch] = useState(0)
  const life = useRef(new ImportLifetime()); const taskRef = useRef<ImportTask | null>(null)
  const uploads = useRef<UploadCache[]>([]); const lock = useRef(false); const createKey = useRef(uid()); const retryKey = useRef('')
  const dispose = () => {
    uploadProgress.current?.stop(); uploadProgress.current = null
    life.current.dispose(); uploads.current = []
    const current = taskRef.current; taskRef.current = null
    if (current && current.status !== 'canceled') void client.cancel(current.id).catch(() => {})
  }
  useUnload(dispose)
  useEffect(() => { clearImportDrafts(); return dispose }, [])
  useDidShow(() => { setVisible(true); setError(e => taskRef.current?.poll_after_ms ? '' : e); setPollEpoch(e => e + 1) })
  useDidHide(() => setVisible(false))
  useEffect(() => {
    if (process.env.TARO_ENV !== 'h5') return
    const onVisibility = () => {
      setVisible(!document.hidden)
      if (!document.hidden && taskRef.current?.poll_after_ms) { setError(''); setPollEpoch(e => e + 1) }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])
  useEffect(() => { if (!target && spaceId) setTarget(spaceId) }, [spaceId, target])
  const receive = (next: ImportTask, recognition = false) => {
    taskRef.current = next; setTask(next)
    setDrafts(d => mergeReviewDrafts(d, next))
    setIndex(i => Math.min(i, Math.max(0, reviewCards(next).length - 1)))
    if (!recognition) return
    if (next.status === 'ready') { setPhase('complete'); setPaths([]); setError('') }
    else if (next.status === 'queued' || next.status === 'processing') { setPhase(next.status); setError('') }
    else { setPhase('failed'); setError(next.sources.find(s => s.error)?.error?.message || '本批截图未能识别，请重试或重新选图') }
  }
  useEffect(() => {
    if (!shouldPoll(task, visible) || error) return
    let active = true; let timer: ReturnType<typeof setTimeout>
    const token = life.current.token(); const id = task!.id
    const poll = async () => {
      try {
        const next = await client.get(id)
        if (!active || !life.current.accepts(token)) return
        receive(next, true)
        if (shouldPoll(next, true)) timer = setTimeout(() => void poll(), next.poll_after_ms!)
      } catch (e) { if (active && life.current.accepts(token)) setError(e instanceof Error ? e.message : '暂时无法查询识别进度') }
    }
    timer = setTimeout(() => void poll(), task!.poll_after_ms!)
    return () => { active = false; clearTimeout(timer) }
  }, [task?.id, task?.status, task?.poll_after_ms, visible, pollEpoch, error, client])
  useEffect(() => {
    if (phase !== 'complete' || !visible) return
    const timer = setTimeout(() => setPhase('review'), 350)
    return () => clearTimeout(timer)
  }, [phase, visible])
  useEffect(() => {
    if (phase !== 'review' || !visible || working || !importReviewComplete(task) || returningHome.current) return
    returningHome.current = true
    void Taro.reLaunch({ url: '/pages/index/index' }).catch(() => {
      returningHome.current = false
      setError('返回主页失败，请点击返回物品列表重试')
    })
  }, [phase, visible, working, task])
  const reset = () => {
    returningHome.current = false
    uploadProgress.current?.stop(); uploadProgress.current = null; setUploadPercent(0)
    const current = taskRef.current
    life.current.reset(); taskRef.current = null; uploads.current = []; createKey.current = uid(); retryKey.current = ''
    lock.current = false; setTask(null); setPaths([]); setDrafts({}); setIndex(0); setUploaded(0); setError(''); setBusy(false); setWorking(false); setPhase('select')
    if (current && current.status !== 'canceled') void client.cancel(current.id).catch(() => {})
  }
  const select = async () => {
    if (lock.current || picking.current) return
    picking.current = true
    const token = life.current.token()
    try {
      const selected = await choosePictures(9, false, ['album'])
      if (!life.current.accepts(token)) return
      if (!selected.length) { leave(); return }
      createKey.current = uid(); setPaths(selected); setError('')
      await start(selected)
    } catch (e) {
      if (!life.current.accepts(token)) return
      const message = typeof e === 'object' && e && 'errMsg' in e ? String(e.errMsg) : String(e)
      if (/cancel/i.test(message)) leave()
      else setError('无法打开相册，请检查权限后重试')
    } finally { picking.current = false }
  }
  const start = async (sources = paths) => {
    if (lock.current || !sources.length && !taskRef.current) return
    const token = life.current.token(); const cache = uploads.current
    let progress: ReturnType<typeof createUploadProgress> | undefined
    lock.current = true; setBusy(true); setError('')
    try {
      let next: ImportTask
      if (taskRef.current) {
        setPhase('queued')
        const current = taskRef.current
        retryKey.current ||= uid()
        next = await client.retry(current.id, retryKey.current)
      } else {
        setPhase('uploading'); setUploaded(0)
        progress = createUploadProgress(setUploadPercent); uploadProgress.current = progress
        const ids = await uploadSources(sources, path => upload(path, target, 'import_source', cache), count => {
          setUploaded(count)
        }, () => life.current.accepts(token))
        if (!ids) return
        if (!await progress.finish() || !life.current.accepts(token)) return
        setPhase('queued')
        next = await client.create(target, ids, createKey.current)
      }
      if (!life.current.accepts(token)) { void client.cancel(next.id).catch(() => {}); return }
      retryKey.current = ''; receive(next, true)
    } catch (e) {
      if (life.current.accepts(token)) { setPhase('failed'); setError(e instanceof Error ? e.message : '本批截图处理失败，请重试') }
    } finally {
      progress?.stop()
      if (uploadProgress.current === progress) uploadProgress.current = null
      if (life.current.accepts(token)) { lock.current = false; setBusy(false) }
    }
  }
  useEffect(() => {
    if (!target || started.current || !initial?.paths.length) return
    started.current = true
    const sources = initial.paths; initial.paths = []
    void start(sources)
  }, [target])
  const leave = () => { if (!working) { dispose(); goBack() } }
  const writable = canEdit(data.spaces.find(s => s.id === target))
  const cards = phase === 'review' && task ? reviewCards(task) : []
  const current = Math.min(index, Math.max(0, cards.length - 1))
  const savedCount = task?.entries.filter(e => e.saved_item_id).length || 0
  const showingProgress = ['uploading', 'queued', 'processing', 'complete'].includes(phase)
  const stageLabel = phase === 'uploading' ? `已上传 ${uploaded} / ${paths.length} 张` : phase === 'queued' ? '等待识别' : phase === 'processing' ? '正在识别' : '识别完成'
  return <View className='page ai-add-page' style={{ ...layout.style, height: `${layout.window.windowHeight}px` }}>
    <Header back title='记录新物品' onBack={leave} />
    <View className='ai-add-shell'>
      <View className='ai-add-toolbar'><View><Text className='ai-add-title'>{cards.length ? `${cards.length} 件待保存` : 'AI 识别'}</Text><Text className='small muted'>{demo ? '示例模式 · ' : ''}{savedCount ? `已保存 ${savedCount} 件 · ` : ''}{data.spaces.find(s => s.id === target)?.name || '正在读取空间'}</Text></View></View>
      {cards.length > 0 && task ? <>
        {cards.length > 1 && <View className='ai-card-navigation'><Action label='上一件物品' disabled={working || current === 0} onClick={() => setIndex(current - 1)}>‹</Action><View><Text>{current + 1} / {cards.length}</Text></View><Action label='下一件物品' disabled={working || current === cards.length - 1} onClick={() => setIndex(current + 1)}>›</Action></View>}
        <Swiper className='ai-item-swiper' current={current} circular={false} disableTouch={working} duration={240} onChange={e => { const next = carouselIndex(e.detail?.current, cards.length); if (!working && next !== null) setIndex(next) }}>
          {cards.map((entry, i) => <SwiperItem key={entry.id} aria-hidden={i !== current}>{Math.abs(i - current) <= 1 && <ImportItemCard task={task} entry={entry} draft={drafts[entry.id] || reviewDraft(entry)} onDraft={draft => setDrafts(d => ({ ...d, [entry.id]: draft }))} uploads={uploads.current} client={client} prepare={prepare} disabled={!writable || i !== current} onWorking={setWorking} onTask={next => receive(next)} onSaved={id => void importSaved(id)} />}</SwiperItem>)}
        </Swiper>
      </> : <View className={`ai-add-empty${showingProgress ? ' ai-add-empty--progress' : ''}`}>
        {showingProgress ? <>
          <RecognitionMotion variant='scan' paused={!visible || !!error} complete={phase === 'complete'} /><Text className='empty-title'>{stageLabel}</Text>
          {phase === 'uploading' && <Text className='small muted'>较长的账单建议分段截图，文字更清晰</Text>}
          {phase === 'uploading' && <View className='ai-progress' role='progressbar' aria-label='上传进度' aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(uploadPercent)} aria-valuetext={stageLabel}><View className='ai-progress-fill' style={{ width: `${uploadPercent}%` }} /></View>}
          <ErrorNote message={error} />{error && <Action className='primary' onClick={() => { setError(''); setPollEpoch(e => e + 1) }}>继续查询进度</Action>}
        </> : phase === 'failed' ? <>
          <Text className='empty-title'>这次未能完成识别</Text><ErrorNote message={error} />
          <Action className='primary submit-button' disabled={!writable || busy} onClick={() => void start()}>{task ? '重试整批识别' : '重试上传与识别'}</Action>
          <Action className='secondary' onClick={() => { reset(); void select() }}>重新选择截图</Action><Action className='text-button' onClick={() => { reset(); setManual(true) }}>手动添加物品</Action>
        </> : phase === 'review' ? <Empty title={savedCount ? '这次的物品已处理完' : '没有可添加的物品'} text={savedCount ? `已保存 ${savedCount} 件物品。` : '没有识别到有效商品，已取消、已全额退款的商品会自动忽略。'}>
          <ErrorNote message={error} />
          <Action className='primary submit-button' onClick={() => { reset(); void select() }}>选择新截图</Action><Action className='text-button' onClick={leave}>返回物品列表</Action><Action className='text-button' onClick={() => setManual(true)}>手动添加物品</Action>
        </Empty> : <>
          <ErrorNote message={error} />
          <Action className='primary' disabled={!writable} onClick={() => void select()}>选择截图</Action>
        </>}
      </View>}
    </View>
    {manual && <ItemForm initialSpaceId={target} onClose={() => setManual(false)} />}
  </View>
}
