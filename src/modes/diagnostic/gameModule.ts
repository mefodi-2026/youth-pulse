import { getSessionQuestions, type DiagnosticQuestion, type PackRuleConfig } from '../../types'
import type { GameModule } from '../contracts'
import { resolveSessionScoring, scoreDiagnosticAnswers } from './scoring'

const defaults: PackRuleConfig = { allowSkip: true, answerMode: 'single-choice', questionOrder: 'fixed', scoringMode: 'diagnostic-3-2-1-0' }

export const diagnosticGameModule: GameModule = {
  productId: 'youth-atmosphere',
  gameTypeId: 'diagnostic',
  contentSchemaVersion: 1,
  defaultRuleConfig: defaults,
  normalizeRuleConfig: value => ({
    allowSkip: typeof value?.allowSkip === 'boolean' ? value.allowSkip : defaults.allowSkip,
    answerMode: 'single-choice',
    questionOrder: value?.questionOrder === 'shuffled' ? 'shuffled' : 'fixed',
    scoringMode: value?.scoringMode === 'diagnostic-2-1-0-minus-1' ? value.scoringMode : 'diagnostic-3-2-1-0',
  }),
  getQuestions: (session, fallback) => getSessionQuestions(session, fallback),
  score: (answers, questionSet, session) => scoreDiagnosticAnswers(
    answers,
    questionSet.filter((question): question is DiagnosticQuestion => Boolean(question.category)),
    resolveSessionScoring(session),
  ),
}
