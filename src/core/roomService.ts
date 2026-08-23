/**
 * Canonical RTDB paths for rooms created by this application.
 *
 * `sessions` remains the canonical root deliberately: it is the established
 * production path and lets old rooms remain readable without destructive data
 * migration. New rooms are never written to a parallel `/rooms` root.
 */
export const roomsRoot = 'sessions'

export const roomPath = (roomId: string) => `${roomsRoot}/${roomId}`
export const roomParticipantPath = (roomId: string, participantId: string) => `${roomPath(roomId)}/participants/${participantId}`
export const roomParticipantAnswerPath = (roomId: string, participantId: string, questionId: string) => `${roomParticipantPath(roomId, participantId)}/answers/${questionId}`

/** Participant-safe material; this root never contains answer keys or explanations. */
export const publicRoomPath = (roomId: string) => `publicRooms/${roomId}`
export const participantQuestionsPath = (roomId: string) => `roomParticipantQuestions/${roomId}`
export const participantResultPath = (roomId: string, participantId: string) => `roomParticipantResults/${roomId}/${participantId}`
export const roomParticipantResultsPath = (roomId: string) => `roomParticipantResults/${roomId}`

/** Private material is host/platform-owner only. */
export const privateQuestionsPath = (roomId: string) => `roomPrivateQuestions/${roomId}`
