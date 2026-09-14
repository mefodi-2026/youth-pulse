import type { PackRuleConfig } from '../../types'
import type { GameModule } from '../contracts'
import { verseMatchGameTypeId, verseMatchProductId } from './contract'

const defaultRuleConfig: PackRuleConfig = { allowSkip: false, answerMode: 'none', questionOrder: 'shuffled', scoringMode: 'none' }
export const verseMatchGameModule: GameModule = {
  productId: verseMatchProductId, gameTypeId: verseMatchGameTypeId, contentSchemaVersion: 1, defaultRuleConfig,
  normalizeRuleConfig: () => defaultRuleConfig, getQuestions: () => [],
  score: () => ({ total: 0, categories: { communication: 0, forgiveness: 0, service: 0, care: 0, honesty: 0 }, points: 0, maximumPoints: 0, minimumPoints: 0 }),
}
