import type { Question, ResponseValue, Scores } from '../../types'

/** Browser-side quiz scoring never contains or infers the private answer key. */
export const pendingQuizScore = (_answers: Record<string, ResponseValue>, questions: Question[]): Scores => ({
  total: 0,
  categories: { communication: 0, forgiveness: 0, service: 0, care: 0, honesty: 0 },
  points: 0,
  maximumPoints: questions.length,
  minimumPoints: 0,
})
