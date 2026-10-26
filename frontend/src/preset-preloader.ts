type Ports = { list(): Promise<{ id: string }[]>; preview(id: string): Promise<unknown> }

/** Optional work after the main sync: bounded, coalesced, and silent on failure. */
export class PresetPreloader {
  private completed: string | undefined
  private generation = 0
  private running: { key: string; valid: () => boolean; task: Promise<void> } | undefined
  constructor(private ports: Ports) {}
  reset() { this.generation++; this.completed = undefined }
  run(key: string, valid: () => boolean): Promise<void> {
    if (!valid() || this.completed === key) return Promise.resolve()
    if (this.running) {
      if (this.running.key === key && this.running.valid()) return this.running.task
      // Drain the old account/version's workers before starting another batch.
      return this.running.task.then(() => this.run(key, valid))
    }
    const generation = this.generation
    const current = () => generation === this.generation && valid()
    const task = this.load(current).then(complete => {
      if (complete && current()) this.completed = key
    }).finally(() => { if (this.running?.task === task) this.running = undefined })
    this.running = { key, valid: current, task }
    return task
  }
  private async load(valid: () => boolean): Promise<boolean> {
    try {
      const items = await this.ports.list()
      let index = 0; let failed = false
      await Promise.all(Array.from({ length: Math.min(2, items.length) }, async () => {
        while (!failed && valid() && index < items.length) {
          const item = items[index++]
          try { await this.ports.preview(item.id) } catch { failed = true }
        }
      }))
      // A failed/interrupted batch remains eligible for the next sync or foreground entry.
      return !failed && valid() && index === items.length
    } catch { return false }
  }
}
