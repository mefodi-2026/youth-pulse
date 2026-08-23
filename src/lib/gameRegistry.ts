import { resolveSessionScoring, scoreAnswers } from './scoring'
import { getSessionQuestions, type PackRuleConfig, type Question, type ResponseValue, type Scores, type Session } from '../types'

/**
 * Game modules keep executable mechanics in the application, never in RTDB.
 * Packs can only describe content and a small, whitelisted rule configuration.
 */
export interface GameModule {
  productId: string
  gameTypeId: string
  contentSchemaVersion: number
  defaultRuleConfig: PackRuleConfig
  normalizeRuleConfig: (value?: Partial<PackRuleConfig>) => PackRuleConfig
  getQuestions: (session: Pick<Session, 'templateSnapshot' | 'packSnapshot' | 'questions' | 'gameTypeId'> | null | undefined, legacyFallback: Question[]) => Question[]
  score: (answers: Record<string, ResponseValue>, questionSet: Question[], session?: Session | null) => Scores
}

const diagnosticRuleConfig: PackRuleConfig = {
  allowSkip: true,
  answerMode: 'single-choice',
  questionOrder: 'fixed',
  scoringMode: 'diagnostic-3-2-1-0',
}

const normalizeDiagnosticRuleConfig = (value?: Partial<PackRuleConfig>): PackRuleConfig => ({
  allowSkip: typeof value?.allowSkip === 'boolean' ? value.allowSkip : diagnosticRuleConfig.allowSkip,
  answerMode: value?.answerMode === 'single-choice' ? value.answerMode : diagnosticRuleConfig.answerMode,
  questionOrder: value?.questionOrder === 'shuffled' || value?.questionOrder === 'fixed' ? value.questionOrder : diagnosticRuleConfig.questionOrder,
  scoringMode: value?.scoringMode === 'diagnostic-2-1-0-minus-1' || value?.scoringMode === 'diagnostic-3-2-1-0' ? value.scoringMode : diagnosticRuleConfig.scoringMode,
})

const quizRuleConfig: PackRuleConfig = {
  allowSkip: false,
  answerMode: 'single-choice',
  questionOrder: 'fixed',
  scoringMode: 'quiz-correct-1-0',
}

const normalizeQuizRuleConfig = (value?: Partial<PackRuleConfig>): PackRuleConfig => ({
  allowSkip: false,
  answerMode: 'single-choice',
  questionOrder: value?.questionOrder === 'shuffled' ? 'shuffled' : 'fixed',
  scoringMode: 'quiz-correct-1-0',
})

export const diagnosticGameModule: GameModule = {
  productId: 'youth-atmosphere',
  gameTypeId: 'diagnostic',
  contentSchemaVersion: 1,
  defaultRuleConfig: diagnosticRuleConfig,
  normalizeRuleConfig: normalizeDiagnosticRuleConfig,
  getQuestions: (session, legacyFallback) => getSessionQuestions(session, legacyFallback),
  score: (answers, questionSet, session) => scoreAnswers(answers, questionSet, resolveSessionScoring(session)),
}

export const bibleQuizGameModule: GameModule = {
  productId: 'bible-quiz',
  gameTypeId: 'quiz',
  contentSchemaVersion: 1,
  defaultRuleConfig: quizRuleConfig,
  normalizeRuleConfig: normalizeQuizRuleConfig,
  getQuestions: (session, legacyFallback) => getSessionQuestions(session, legacyFallback),
  // Quiz grading is intentionally performed by the trusted Cloud Function.
  // Browser code never receives the answer-key data needed to calculate it.
  score: (_answers, questionSet) => {
    return {
      total: 0,
      categories: { communication: 0, forgiveness: 0, service: 0, care: 0, honesty: 0 },
      points: 0,
      maximumPoints: questionSet.length,
      minimumPoints: 0,
    }
  },
}

const modules: Record<string, GameModule> = {
  [diagnosticGameModule.gameTypeId]: diagnosticGameModule,
  [bibleQuizGameModule.gameTypeId]: bibleQuizGameModule,
}

/** Legacy rooms without a gameTypeId are diagnostics; explicit unknown types are data errors. */
export const getGameModule = (gameTypeId?: string) => {
  if (!gameTypeId) return diagnosticGameModule
  const module = modules[gameTypeId]
  if (!module) throw new Error(`Неизвестный игровой модуль: ${gameTypeId}`)
  return module
}
