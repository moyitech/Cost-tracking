// One-use, memory-only handoff: never persist private source screenshots.
let pending: { paths: string[]; spaceId: string } | null = null
export function stageImportPictures(paths: string[], spaceId: string) { pending = { paths: paths.slice(0, 9), spaceId } }
export function takeImportPictures() { const selected = pending; pending = null; return selected }
