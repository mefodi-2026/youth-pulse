import type { ContentPack, RoomMode, TemplateSelection } from '../../types'

/** Quiz-only selection rules. A playable quiz always comes from a workspace copy. */
export const quizMode: RoomMode = 'quiz'

export const isQuizPack = (pack: ContentPack | null | undefined) =>
  Boolean(pack && (pack.mode === 'quiz' || pack.gameTypeId === 'quiz'))

export const workspaceQuizSelection = (packId: string): TemplateSelection => ({
  selectedPackId: packId,
  templateSource: 'workspace',
})

export const systemQuizSelection = (packId: string): TemplateSelection => ({
  selectedPackId: packId,
  templateSource: 'system',
})

/**
 * Quiz setup starts from a leader-owned copy when one exists. Otherwise it
 * presents a published system pack so the leader can deliberately copy it.
 * The diagnostic module never uses this selector.
 */
export const initialQuizSelection = (
  workspacePacks: Record<string, ContentPack>,
  systemPacks: Record<string, ContentPack>,
): TemplateSelection | null => {
  const workspacePack = Object.values(workspacePacks).find(isQuizPack)
  if (workspacePack) return workspaceQuizSelection(workspacePack.packId)

  const systemPack = Object.values(systemPacks).find(pack => isQuizPack(pack) && pack.status === 'published')
  return systemPack ? systemQuizSelection(systemPack.packId) : null
}
