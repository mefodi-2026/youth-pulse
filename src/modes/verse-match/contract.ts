import type { ModeDataContract } from '../contracts'

export const verseMatchMode = 'verse-match' as const
export const verseMatchProductId = 'verse-match'
export const verseMatchGameTypeId = verseMatchMode
export const verseMatchDataContract: ModeDataContract = {
  packSchema: 'verse-match-pack-v1', participantQuestionSchema: 'verse-match-private-cards-v1',
  resultSchema: 'verse-match-results-v1', roomStateSchema: 'verse-match-server-room-v1', legacySessionFallback: false,
}
