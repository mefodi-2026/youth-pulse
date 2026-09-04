import { orderQuestionsByCategory } from '../lib/questionOrder'
import type { DiagnosticQuestion, Question, RoomMode } from '../types'

export const readCanonicalQuestions = (value: unknown): Question[] => {
  if (Array.isArray(value)) return value as Question[]
  if (value && typeof value === 'object') return Object.values(value as Record<string, Question>)
  return []
}

export const isDiagnosticQuestion = (question: Question): question is DiagnosticQuestion =>
  typeof question.category === 'string'

/**
 * `ContentPack.questions` is the canonical source. The other arguments are
 * read-only legacy adapters for packs written before that contract existed.
 */
export const resolveCanonicalPackQuestions = (input: {
  questions?: unknown
  legacyContentQuestions?: unknown
  legacyPublicQuestions?: unknown
}): Question[] => {
  const canonical = readCanonicalQuestions(input.questions)
  if (canonical.length) return canonical
  const legacyContent = readCanonicalQuestions(input.legacyContentQuestions)
  if (legacyContent.length) return legacyContent
  return readCanonicalQuestions(input.legacyPublicQuestions)
}

export const normalizeQuestionsForMode = (mode: RoomMode, questions: Question[]): Question[] => {
  if (mode === 'quiz') return questions.map(question => ({ ...question, options: { ...question.options } }))
  const diagnostic = questions.filter(isDiagnosticQuestion)
  if (diagnostic.length !== questions.length) throw new Error('Набор «Проверь себя» содержит вопрос без категории.')
  return orderQuestionsByCategory(diagnostic)
}
