import test from 'node:test'
import assert from 'node:assert/strict'
import { createUploadProgress } from '../src/upload-progress'

test('instant single-image uploads paint progress, fill, then wait before advancing', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'] })
  const frames: number[] = []
  const progress = createUploadProgress(value => frames.push(value))
  t.after(() => progress.stop())
  let completed = false
  const finishing = progress.finish().then(result => { completed = result })
  t.mock.timers.tick(480)
  assert.ok(frames.at(-1)! > 0 && frames.at(-1)! < 100)
  assert.equal(completed, false)
  t.mock.timers.tick(120)
  await Promise.resolve()
  assert.equal(frames.at(-1), 100)
  t.mock.timers.tick(359)
  await Promise.resolve()
  assert.equal(completed, false)
  t.mock.timers.tick(1)
  await finishing
  assert.equal(completed, true)
})

test('slow uploads move forward without reaching full before success', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'] })
  const frames: number[] = []
  const progress = createUploadProgress(value => frames.push(value))
  t.after(() => progress.stop())
  for (let i = 0; i < 500; i++) t.mock.timers.tick(120)
  assert.ok(frames.at(-1)! <= 90)
  assert.ok(frames.at(-1)! > frames[0])
  assert.ok(frames.every((value, i) => i === 0 || value >= frames[i - 1]))
  const finishing = progress.finish()
  t.mock.timers.tick(0)
  await Promise.resolve()
  assert.equal(frames.at(-1), 100)
  t.mock.timers.tick(360)
  assert.equal(await finishing, true)
})

test('failure or exit stops updates and cancels either completion delay', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'] })
  for (const finishStage of ['uploading', 'minimum', 'full']) {
    const frames: number[] = []
    const progress = createUploadProgress(value => frames.push(value))
    const finishing = finishStage === 'uploading' ? null : progress.finish()
    if (finishStage === 'full') {
      t.mock.timers.tick(600)
      await Promise.resolve()
      assert.equal(frames.at(-1), 100)
    }
    progress.stop()
    const count = frames.length
    t.mock.timers.tick(5000)
    assert.equal(frames.length, count)
    if (finishing) assert.equal(await finishing, false)
    assert.equal(await progress.finish(), false)
  }
})
