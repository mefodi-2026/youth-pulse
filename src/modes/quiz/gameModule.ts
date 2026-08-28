import { getSessionQuestions, type PackRuleConfig } from '../../types'
import type { GameModule } from '../contracts'
import { pendingQuizScore } from './scoring'

const defaults: PackRuleConfig = { allowSkip: false, answerMode: 'single-choice', questionOrder: 'fixed', scoringMode: 'quiz-correct-1-0' }

export const bibleQuizGameModule: GameModule = {
  productId: 'bible-quiz',
  gameTypeId: 'quiz',
  contentSchemaVersion: 1,
  defaultRuleConfig: defaults,
  normalizeRuleConfig: value => ({ ...defaults, questionOrder: value?.questionOrder === 'shuffled' ? 'shuffled' : 'fixed' }),
  getQuestions: (session, fallback) => getSessionQuestions(session, fallback),
  score: pendingQuizScore,
}
