type Focus = { owner: string; field: string; generation: number }

// Input-scoped events are authoritative. A blur settles only if no other
// input claimed focus in the meantime, so a handoff never reads as dismissal.
export class KeyboardSession {
  private active: Focus | null = null
  private generation = 0
  private pendingBlur: number | null = null

  get focus() { return this.active }
  focusInput(owner: string, field: string) {
    this.active = { owner, field, generation: ++this.generation }
    this.pendingBlur = null
    return this.active
  }
  blurInput(field: string) {
    if (this.active?.field !== field) return null
    this.pendingBlur = this.active.generation
    return this.pendingBlur
  }
  finishBlur(generation: number) {
    if (this.pendingBlur !== generation || this.active?.generation !== generation) return false
    this.clear(this.active.owner)
    return true
  }
  clear(owner: string) {
    if (this.active?.owner !== owner) return false
    this.active = null
    this.pendingBlur = null
    this.generation++
    return true
  }
}
