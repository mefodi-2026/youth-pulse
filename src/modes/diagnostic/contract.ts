import type { ContentPack, RoomMode, TemplateSelection } from '../../types'

/**
 * Contract owned by the diagnostic module. The published diagnostic material
 * is never a prerequisite workspace copy, which keeps it independent from
 * quiz libraries.
 */
export const diagnosticMode: RoomMode = 'diagnostic'

export const diagnosticSelection = (packId: string): TemplateSelection => ({
  selectedPackId: packId,
  templateSource: 'system',
})

export const isDiagnosticPack = (pack: ContentPack | null | undefined) =>
  Boolean(pack && pack.mode !== 'quiz' && pack.gameTypeId !== 'quiz')
