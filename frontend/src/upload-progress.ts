// Presentation progress: only finish() may show 100%, after the upload succeeds.
export function createUploadProgress(render: (percent: number) => void) {
  const started = Date.now()
  let active = true
  let percent = 8
  let timeout: ReturnType<typeof setTimeout> | undefined
  let resume: ((active: boolean) => void) | undefined
  render(percent)
  const interval = setInterval(() => {
    percent = Math.min(90, percent + (90 - percent) * .08)
    render(percent)
  }, 120)
  const wait = (ms: number) => new Promise<boolean>(resolve => {
    if (!active) { resolve(false); return }
    resume = resolve
    timeout = setTimeout(() => { resume = undefined; resolve(active) }, ms)
  })
  return {
    async finish() {
      // Let even cached/single-image uploads paint before filling the bar.
      if (!await wait(Math.max(0, 600 - (Date.now() - started)))) return false
      clearInterval(interval)
      render(100)
      // Match the CSS transition and leave a short moment at full width.
      return wait(360)
    },
    stop() {
      active = false
      clearInterval(interval)
      clearTimeout(timeout)
      resume?.(false)
      resume = undefined
    },
  }
}
