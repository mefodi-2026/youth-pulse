import { getModeManifest } from '../modes/modeRegistry'

export type { GameModule } from '../modes/contracts'
export { diagnosticGameModule } from '../modes/diagnostic/gameModule'
export { bibleQuizGameModule } from '../modes/quiz/gameModule'

/** Legacy rooms without a gameTypeId are diagnostics; explicit unknown types are data errors. */
export const getGameModule = (gameTypeId?: string) => getModeManifest(gameTypeId).runtime
