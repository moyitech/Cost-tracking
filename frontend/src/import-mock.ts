export type MockSource = { id: string; path: string; name: string; status: 'pending' | 'ready' | 'failed'; attempts: number }
// Fixed fixtures exercise workflow states; this function never recognizes image content.
export function recognizeMockSources(sources: MockSource[], failLast: boolean, retryId?: string): MockSource[] {
  return sources.map((source, index) => {
    if (retryId && source.id !== retryId) return source
    return { ...source, attempts: source.attempts + 1, status: !retryId && failLast && index === sources.length - 1 ? 'failed' : 'ready' }
  })
}
export function entrySource(sources: MockSource[], index: number) { return sources.length ? sources[index % sources.length] : undefined }
