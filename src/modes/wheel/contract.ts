import type { ModeDataContract } from '../contracts'
import { wheelMode } from './types'

export { wheelMode }
export const wheelProductId = 'wheel-of-fortune'
export const wheelGameTypeId = wheelMode

export const wheelDataContract: ModeDataContract = {
  packSchema: 'wheel-config-v1',
  participantQuestionSchema: 'wheel-participant-entry-v1',
  resultSchema: 'wheel-round-summary-v1',
  roomStateSchema: 'wheel-room-state-v1',
  legacySessionFallback: false,
}
