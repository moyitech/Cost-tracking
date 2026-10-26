import { useEffect, useRef, useState } from 'react'
import { accountId, cachedImagePreview, fileUrl, imagePresetUrl, imagePreviewKey, mockEnabled, PreviewSource, subscribeMedia } from './services'

/** Shared by item photos and avatars: reuse a resolved URL while refreshing it. */
export function useImagePreview({ src = '', fileId, presetId }: PreviewSource & { src?: string }) {
  const scope = mockEnabled ? 'mock' : accountId()
  const identity = JSON.stringify([scope, src, fileId, presetId])
  const fallback = () => ({ identity, url: cachedImagePreview({ fileId, presetId })?.url || (presetId ? '' : src), revision: cachedImagePreview({ fileId, presetId })?.revision || 0 })
  const [image, setImage] = useState(fallback)
  const [refresh, setRefresh] = useState(0)
  const retried = useRef(false)
  const current = useRef(identity); current.current = identity
  const mounted = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => subscribeMedia(key => {
    if (key === null || key === imagePreviewKey({ fileId, presetId })) setRefresh(value => value + 1)
  }), [fileId, presetId])
  useEffect(() => { retried.current = false }, [identity])
  const resolve = (force = false) => presetId ? imagePresetUrl(presetId, force) : !mockEnabled && fileId ? fileUrl(fileId, force) : undefined
  const accept = (url: string) => {
    const revision = cachedImagePreview({ fileId, presetId })?.revision || 0
    setImage(previous => previous.identity === identity && previous.url === url && previous.revision === revision ? previous : { identity, url, revision })
  }
  useEffect(() => {
    let active = true
    setImage(previous => previous.identity === identity ? previous : fallback())
    const request = resolve()
    if (request) void request.then(url => { if (active) accept(url) }).catch(() => {})
    return () => { active = false }
  }, [identity, refresh])
  const recover = () => {
    const resource = imagePreviewKey({ fileId, presetId })
    const valid = () => mounted.current && current.current === identity && resource === imagePreviewKey({ fileId, presetId })
    if (mockEnabled || retried.current || (!presetId && !fileId)) { if (valid()) accept(''); return }
    retried.current = true
    void resolve(true)?.then(url => { if (valid()) accept(url) }).catch(() => { if (valid()) accept('') })
  }
  // Do not render the previous item's image for the frame before its effect runs.
  const shown = image.identity === identity ? image : fallback()
  return { url: shown.url, imageKey: `${identity}:${shown.revision}`, recover }
}
