import { categories } from '../data/questions'
import type { CategoryId, Question } from '../types'

export const diagnosticCategoryOrder = Object.keys(categories) as CategoryId[]

const isPositiveInteger = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0

/**
 * Produces the single canonical order used by both the host panel and a new
 * room snapshot. Existing questions without `categoryOrder` retain their
 * current relative order inside their category, then receive one on save.
 */
export const orderQuestionsByCategory = (questionSet: Question[]): Question[] => {
  const indexed = questionSet.map((question, index) => ({ question, index }))
  const known = diagnosticCategoryOrder.flatMap(category => {
    const group = indexed
      .filter(item => item.question.category === category)
    // A legacy pack can contain no local positions at all. In that case its
    // array order is the only safe source of truth. Only sort when a complete
    // category has already been migrated to explicit positions.
    const orderedGroup = group.every(item => isPositiveInteger(item.question.categoryOrder))
      ? [...group].sort((left, right) => left.question.categoryOrder! - right.question.categoryOrder! || left.index - right.index)
      : group

    return orderedGroup.map((item, index) => ({ ...item.question, categoryOrder: index + 1 }))
  })

  // Unknown categories are not expected in this diagnostic. Keep them intact
  // at the end rather than dropping user data from an older pack.
  const unknown = indexed
    .filter(item => !diagnosticCategoryOrder.includes(item.question.category))
    .map(item => ({ ...item.question }))

  return [...known, ...unknown]
}

export const nextCategoryQuestionOrder = (questionSet: Question[], category: CategoryId, excludedQuestionId?: string) =>
  questionSet.filter(question => question.category === category && question.id !== excludedQuestionId).length + 1
