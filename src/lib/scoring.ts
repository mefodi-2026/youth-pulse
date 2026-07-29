import { categories, questions } from '../data/questions'
import type { CategoryId, Question, ResponseValue, Scores } from '../types'

const weight: Record<ResponseValue, number> = { A: 3, B: 2, C: 1, D: 0, SKIP: -1 }
export const scoreAnswers = (answers: Record<string, ResponseValue> = {}, questionSet: Question[] = questions): Scores => {
  const result = Object.fromEntries(Object.keys(categories).map(id => [id, 0])) as Record<CategoryId, number>
  for (const category of Object.keys(categories) as CategoryId[]) {
    const items = questionSet.filter(q => q.category === category)
    result[category] = items.length ? Math.round(items.reduce((sum, q) => sum + (answers[q.id] ? weight[answers[q.id]] : 0), 0) / (items.length * 3) * 100) : 0
  }
  return { categories: result, total: Math.round(Object.values(result).reduce((sum, value) => sum + value, 0) / Object.keys(categories).length) }
}

export const recommendation = (scores: Scores) => {
  const weakest = Object.entries(scores.categories).sort((a, b) => a[1] - b[1])[0][0] as CategoryId
  const copy: Record<CategoryId, string> = {
    communication: 'На следующей встрече попробуй первым поздороваться с одним новым человеком.',
    forgiveness: 'Если есть недопонимание, выбери бережный разговор вместо молчания.',
    service: 'Выбери одно небольшое дело, в котором сможешь поддержать молодёжь на этой неделе.',
    care: 'Обрати внимание на того, кто сегодня остаётся один, и просто побудь рядом.',
    honesty: 'Выбери один честный и бережный шаг, который поможет жить в согласии со своими принципами.'
  }
  return copy[weakest]
}
