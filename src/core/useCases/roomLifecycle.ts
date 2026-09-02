import {
  archiveSession,
  createSession,
  createSessionRecord,
  ensureAuth,
  firebaseReady,
  updatePhase,
  type RoomPilotDetails,
} from '../../repositories/firebaseRepository'
import type {
  ContentPack,
  Question,
  ScoringTemplateId,
  Session,
  SessionArchive,
  SessionPhase,
  TemplateSelection,
} from '../../types'

export interface CreateRoomInput {
  roomId: string
  leaderUid: string
  workspaceId: string
  pack: ContentPack | null
  legacyQuestions: Question[]
  selection: TemplateSelection
  title: string
  details: RoomPilotDetails
  scoringTemplateId: ScoringTemplateId
}

export interface CreateRoomResult {
  roomId: string
  demoSession?: Session
}

/** Shared orchestration only. Pack selection rules remain inside each mode. */
export async function createRoom(input: CreateRoomInput): Promise<CreateRoomResult> {
  const questions = input.pack?.questions || input.legacyQuestions
  if (!questions.length) throw new Error('В выбранном наборе нет вопросов. Создание комнаты невозможно.')

  if (!firebaseReady) {
    return {
      roomId: input.roomId,
      demoSession: createSessionRecord(
        input.roomId,
        'demo-host',
        questions,
        input.workspaceId,
        undefined,
        input.selection,
        input.title,
        input.details,
        input.scoringTemplateId,
      ),
    }
  }

  if (!input.pack) throw new Error('Опубликованный набор пока недоступен. Обновите страницу и попробуйте снова.')
  const user = await ensureAuth()
  if (!user || user.uid !== input.leaderUid) {
    throw new Error('Не удалось подтвердить аккаунт ведущего. Войдите ещё раз и повторите создание комнаты.')
  }
  await createSession(
    input.roomId,
    user.uid,
    questions,
    input.workspaceId,
    input.selection,
    input.title,
    input.details,
    input.scoringTemplateId,
  )
  return { roomId: input.roomId }
}

export async function changeRoomPhase(session: Session, next: SessionPhase) {
  await updatePhase(session.roomId, next, session.hostUid)
}

/** Closing is authoritative; archiving is deliberately a separate best effort. */
export async function closeRoomAndArchive(session: Session): Promise<{ closed: Session; archive?: SessionArchive; archiveError?: Error }> {
  await changeRoomPhase(session, 'closed')
  const endedAt = session.closedAt || Date.now()
  const closed: Session = { ...session, phase: 'closed', status: 'closed', closedAt: endedAt, endedAt, lastActivityAt: endedAt }
  try {
    return { closed, archive: await archiveSession(closed) }
  } catch (error) {
    return { closed, archiveError: error instanceof Error ? error : new Error('Не удалось сохранить архив комнаты.') }
  }
}
