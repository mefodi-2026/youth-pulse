import type { PackRuleConfig } from '../../types'
import type { GameModule } from '../contracts'
import { wheelGameTypeId, wheelProductId } from './contract'

const defaultRuleConfig: PackRuleConfig = {
  allowSkip: false,
  answerMode: 'none',
  questionOrder: 'fixed',
  scoringMode: 'none',
}

export const wheelGameModule: GameModule = {
  productId: wheelProductId,
  gameTypeId: wheelGameTypeId,
  contentSchemaVersion: 1,
  defaultRuleConfig,
  normalizeRuleConfig: () => defaultRuleConfig,
  getQuestions: () => [],
  score: () => ({
    total: 0,
    categories: { communication: 0, forgiveness: 0, service: 0, care: 0, honesty: 0 },
    points: 0,
    maximumPoints: 0,
    minimumPoints: 0,
  }),
}
