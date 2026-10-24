import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { RecognitionMotion, RecognitionVariant } from '../src/pages/import/recognition-motion'
import { DuplicateNotice } from '../src/pages/import/duplicate-notice'
import './preview.scss'

type Stage = 'uploading' | 'processing' | 'complete'
const variants: { id: RecognitionVariant; number: string; name: string; note: string; detail: string }[] = [
  { id: 'scan', number: '01', name: '扫描成卡', note: '从截图，到物品。', detail: '扫描光带掠过纸面，信息逐行浮现。' },
  { id: 'orbit', number: '02', name: '流光核心', note: '让信息，有自己的引力。', detail: '玉色核心舒展，双轨光点持续环绕。' },
  { id: 'objects', number: '03', name: '灵动小物', note: '生活里的小物，各就各位。', detail: '三个小物轮换、聚拢，再整理成卡片。' },
]
const candidate = { id: 'iphone', name: 'iPhone 18 Pro Max 512GB 银色', reason: '商品名相同' }
function Preview() {
  const [stage, setStage] = useState<Stage>('processing')
  const [paused, setPaused] = useState(false)
  const [hidden, setHidden] = useState(document.hidden)
  const [replay, setReplay] = useState(0)
  const [expanded, setExpanded] = useState<RecognitionVariant | null>(null)
  const [percent, setPercent] = useState(8)
  const uploadElapsed = useRef(0)
  const [selected, setSelected] = useState([false, true, false])
  const [skipped, setSkipped] = useState<number[]>([])
  const [disabled, setDisabled] = useState(false)
  const [largeText, setLargeText] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const opener = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    const change = () => setHidden(document.hidden)
    document.addEventListener('visibilitychange', change)
    return () => document.removeEventListener('visibilitychange', change)
  }, [])
  useEffect(() => {
    uploadElapsed.current = 0; setPercent(8)
  }, [stage, replay])
  useEffect(() => {
    if (stage !== 'uploading' || paused || hidden) return
    // The local mock preserves elapsed time when paused; no upload is performed.
    const timer = setInterval(() => {
      uploadElapsed.current += 120
      if (uploadElapsed.current >= 1800) { setPercent(100); clearInterval(timer) }
      else setPercent(value => Math.min(90, value + (90 - value) * .08))
    }, 120)
    return () => clearInterval(timer)
  }, [stage, paused, hidden, replay])
  useEffect(() => {
    if (expanded) dialog.current?.showModal()
    else { dialog.current?.close(); opener.current?.focus() }
  }, [expanded])
  const label = stage === 'uploading' ? (percent === 100 ? '上传完成' : '正在上传') : stage === 'complete' ? '识别完成' : '正在识别'
  const scene = (variant: RecognitionVariant) => <div className='preview-scene'>
    <div className='preview-scene-header'><span>AI 识别</span><span>个人空间</span></div>
    <div className='preview-scene-center'>
      <RecognitionMotion key={`${variant}-${replay}-${stage}`} variant={variant} paused={paused || hidden} complete={stage === 'complete'} />
      <div className='preview-status' role='status'>{label}</div>
      <div className='preview-progress-slot'>{stage === 'uploading' && <div className='preview-progress' role='progressbar' aria-label='模拟上传进度' aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)}><div style={{ width: `${percent}%` }} /></div>}</div>
    </div>
  </div>
  return <main>
    <header className='lab-header'><a href='#top' className='wordmark'>物序 <span>ITEMS</span></a><span className='lab-badge'>交互设计预览</span></header>
    <section className='lab-intro' id='top'><p className='eyebrow'>MOTION STUDIES / 01—03</p><h1>等待，也可以有生命力。</h1><p className='intro-copy'>三种识别动效，同一份墨绿与留白。播放看看，找到物序的节奏。</p></section>
    <div className='lab-controls'><div className='stage-controls' role='group' aria-label='预览场景'>{([['uploading', '上传'], ['processing', '识别中'], ['complete', '完成']] as const).map(([value, title]) => <button key={value} aria-pressed={stage === value} onClick={() => setStage(value)}>{title}</button>)}</div><div className='play-controls'><button onClick={() => setPaused(!paused)} aria-pressed={paused}>{paused ? '▶ 继续播放' : 'Ⅱ 暂停'}</button><button onClick={() => { setReplay(replay + 1); setPaused(false) }}>↻ 重播</button></div></div>
    <section className='motion-grid' aria-label='三种动效对比'>{variants.map(v => <article className='motion-study' key={v.id}><div className='study-heading'><span>{v.number}</span><h2>{v.name}</h2><button aria-label={`放大${v.name}`} onClick={event => { opener.current = event.currentTarget; setExpanded(v.id) }}>放大 ↗</button></div>{scene(v.id)}<div className='study-description'><h3>{v.note}</h3><p>{v.detail}</p></div></article>)}</section>
    <section className='duplicate-section'><div className='section-title'><div><p className='eyebrow'>A MOMENT TO CONFIRM</p><h2>相似，但不替你决定。</h2><p>将重复提醒变成一次清晰的确认。</p></div><div className='preview-toggles'><label><input type='checkbox' checked={disabled} onChange={e => setDisabled(e.target.checked)} /> 禁用态</label><label><input type='checkbox' checked={largeText} onChange={e => setLargeText(e.target.checked)} /> 大字号</label><button onClick={() => { setSelected([false, true, false]); setSkipped([]) }}>重置示例</button></div></div>
      <div className={`duplicate-grid${largeText ? ' preview-large-text' : ''}`}>{['等待确认', '已选择新增', '多个相似物品'].map((title, i) => <article key={title}><p className='sample-label'>0{i + 1} / {title}</p>{skipped.includes(i) ? <div className='skip-result' role='status'><span>已跳过这件物品</span><button onClick={() => setSkipped(skipped.filter(n => n !== i))}>重新体验</button></div> : <DuplicateNotice candidates={i === 2 ? [candidate, { id: 'long', name: 'iPhone 18 Pro Max 512GB 银色 · 另一笔订单附赠保护壳与充电配件套装', reason: '商品名相似' }] : [candidate]} selected={selected[i]} disabled={disabled} onSkip={() => setSkipped([...skipped, i])} onSelect={() => setSelected(selected.map((value, n) => n === i ? true : value))} />}</article>)}</div>
    </section>
    <footer className='lab-footer'><span>物序 · 识别体验研究</span><span>仅模拟展示，不上传图片或保存物品。</span></footer>
    <dialog ref={dialog} className='preview-dialog' onCancel={e => { e.preventDefault(); setExpanded(null) }} aria-label='动画放大预览'><div className='dialog-heading'><h2>{variants.find(v => v.id === expanded)?.name}</h2><button onClick={() => setExpanded(null)}>关闭 ×</button></div>{expanded && scene(expanded)}<div className='dialog-controls'><button onClick={() => setPaused(!paused)}>{paused ? '继续播放' : '暂停'}</button><button onClick={() => { setReplay(replay + 1); setPaused(false) }}>重播</button></div></dialog>
  </main>
}
createRoot(document.getElementById('root')!).render(<Preview />)
