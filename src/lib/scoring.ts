import { categories, questions } from '../data/questions'
import { findRecommendation, recommendationLevels } from '../data/recommendations'
import type { CategoryId, Question, ResponseValue, Scores } from '../types'

const weight: Record<ResponseValue, number> = { A: 3, B: 2, C: 1, D: 0, SKIP: -1 }
export const scoreAnswers = (answers: Record<string, ResponseValue> = {}, questionSet: Question[] = questions): Scores => {
  const result = Object.fromEntries(Object.keys(categories).map(id => [id, 0])) as Record<CategoryId, number>
  let totalPoints = 0
  let totalMaximum = 0
  for (const category of Object.keys(categories) as CategoryId[]) {
    const items = questionSet.filter(q => q.category === category)
    const points = items.reduce((sum, q) => sum + (answers[q.id] ? weight[answers[q.id]] : 0), 0)
    const maximum = items.length * 3
    result[category] = maximum ? Math.round(points / maximum * 100) : 0
    totalPoints += points
    totalMaximum += maximum
  }
  return { categories: result, total: totalMaximum ? Math.round(totalPoints / totalMaximum * 100) : 0 }
}

export const recommendations = (scores: Scores) => (Object.keys(categories) as CategoryId[]).map(category => ({
  category,
  score: scores.categories[category] || 0,
  ...findRecommendation(category, scores.categories[category] || 0),
}))

export const recommendation = (scores: Scores) => {
  const weakest = recommendations(scores).sort((a, b) => a.score - b.score)[0]
  return weakest?.text || recommendationLevels.communication[4].text
}
