export type AvatarDraft = { image: string; fileId?: string }

/** Signed URLs may change while editing; the saved file identity stays the same. */
export function hasAvatarChanges(saved: AvatarDraft, pending: AvatarDraft) {
  const identity = (avatar: AvatarDraft) => avatar.fileId ? `file:${avatar.fileId}` : avatar.image ? `image:${avatar.image}` : 'default'
  return identity(saved) !== identity(pending)
}
