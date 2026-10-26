// Record forms keep a local draft only after the user changes something, and
// never submit a stale base revision silently over another correction (AC18).

// Identity and version fields are bookkeeping, not user input.
const bookkeeping = ['requestKey', 'revision', 'id']

function stableJson(value: unknown) {
  return JSON.stringify(value, (key, nested) => {
    if (bookkeeping.includes(key)) return undefined
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) return Object.fromEntries(Object.entries(nested).sort(([a], [b]) => a.localeCompare(b)))
    return nested
  })
}

export const sameFormValues = <T extends object>(a: T, b: T) => stableJson(a) === stableJson(b)

export type RevisionAction = 'none' | 'reset' | 'rebase' | 'confirm'

// reset: nothing typed, show the latest record instead of an old base.
// rebase: only adds a new record (new expense or first disposal), nothing to overwrite.
// confirm: a correction of saved values; the user must choose before saving.
export function revisionAction({ draftRevision, currentRevision, edited, correction }: { draftRevision?: number; currentRevision?: number; edited: boolean; correction: boolean }): RevisionAction {
  if (draftRevision === undefined || currentRevision === undefined || draftRevision === currentRevision) return 'none'
  if (!edited) return 'reset'
  return correction ? 'confirm' : 'rebase'
}
