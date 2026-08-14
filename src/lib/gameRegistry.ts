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

export const diagnosticGameModule: GameModule = {
  productId: 'youth-atmosphere',
  gameTypeId: 'diagnostic',
  contentSchemaVersion: 1,
  defaultRuleConfig: diagnosticRuleConfig,
  normalizeRuleConfig: normalizeDiagnosticRuleConfig,
  getQuestions: (session, legacyFallback) => getSessionQuestions(session, legacyFallback),
  score: (answers, questionSet, session) => scoreAnswers(answers, questionSet, resolveSessionScoring(session)),
}

const modules: Record<string, GameModule> = {
  [diagnosticGameModule.gameTypeId]: diagnosticGameModule,
}

/** Unknown types deliberately fall back to the safe diagnostic adapter until a module is registered. */
export const getGameModule = (gameTypeId?: string) => modules[gameTypeId || ''] || diagnosticGameModule
