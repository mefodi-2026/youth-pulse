import { copyQuizPackToWorkspace, saveWorkspacePack } from '../../repositories/firebaseRepository'
import type { ContentPack, DiagnosticQuestion } from '../../types'

export const saveDiagnosticWorkspacePack = (workspaceId: string, questions: DiagnosticQuestion[], title?: string) =>
  saveWorkspacePack(workspaceId, questions, title)

export const copyQuizWorkspacePack = (workspaceId: string, pack: ContentPack) =>
  copyQuizPackToWorkspace(workspaceId, pack.packId)
