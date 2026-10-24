type ScrollRequest = { field: string; revision: number }

// Only a new focus or a newly opened keyboard can request a reveal. Layout
// measurements may finish later, but must never take scrolling back from a drag.
export class SheetScrollSession {
  private field = ''
  private open = false
  private revision = 0
  private pending = false
  private userScrolling = false

  focus(field: string) {
    if (field === this.field) return false
    this.field = field
    this.revision++
    this.pending = !!field
    this.userScrolling = false
    return true
  }
  blur(field: string) {
    if (field !== this.field) return false
    return this.focus('')
  }
  reset() {
    this.field = ''; this.open = false; this.pending = false
    this.userScrolling = false; this.revision++
  }
  keyboard(open: boolean) {
    if (open === this.open) return
    this.open = open
    this.revision++
    this.pending = open && !!this.field && !this.userScrolling
    if (!open) this.userScrolling = false
  }
  cancel() { this.revision++; this.pending = false; this.userScrolling = true }
  request(): ScrollRequest | null {
    return this.open && this.pending && this.field ? { field: this.field, revision: this.revision } : null
  }
  consume(request: ScrollRequest) {
    if (!this.pending || !this.open || request.revision !== this.revision || request.field !== this.field) return false
    this.pending = false
    return true
  }
}

export function revealScrollTop(field: { top: number; bottom: number }, viewport: { top: number; bottom: number }, current: number) {
  const top = viewport.top + 8; const bottom = viewport.bottom - 8
  // If the field is taller than the viewport, favor its input at the bottom.
  const delta = field.bottom > bottom ? field.bottom - bottom : field.top < top ? field.top - top : 0
  return Math.max(0, current + delta)
}

export function stablePixels(previous: number | undefined, next: number) {
  return previous !== undefined && Math.abs(previous - next) < 1 ? previous : next
}
