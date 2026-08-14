import { categories, questions } from '../data/questions'
import { findRecommendation, recommendationLevels } from '../data/recommendations'
import type { Answer, CategoryId, PackScoringSnapshot, Question, ResponseValue, Scores, ScoringTemplateId, Session } from '../types'

export interface ScoringTemplateSnapshot {
  scoringTemplateId: ScoringTemplateId
  scoringTemplateVersion: number
  scoringMap: Record<ResponseValue, number>
}

/**
 * These values are executable product mechanics, not editable Firebase rules.
 * A room copies one of them at creation, so a later change cannot affect it.
 */
export const scoringTemplates: Record<ScoringTemplateId, ScoringTemplateSnapshot> = {
  'standard-v1': {
    scoringTemplateId: 'standard-v1',
    scoringTemplateVersion: 1,
    scoringMap: { A: 3, B: 2, C: 1, D: 0, SKIP: -1 },
  },
  'strict-v1': {
    scoringTemplateId: 'strict-v1',
    scoringTemplateVersion: 1,
    scoringMap: { A: 2, B: 1, C: 0, D: -1, SKIP: -2 },
  },
}

export const getScoringTemplate = (templateId: ScoringTemplateId = 'standard-v1'): ScoringTemplateSnapshot => {
  const template = scoringTemplates[templateId] || scoringTemplates['standard-v1']
  return { ...template, scoringMap: { ...template.scoringMap } }
}

const isResponseValue = (value: string): value is ResponseValue => value === 'A' || value === 'B' || value === 'C' || value === 'D' || value === 'SKIP'

/** Supports old rooms that stored answerScores/skippedAnswerScore before versioned presets existed. */
export const resolveSessionScoring = (session?: Pick<Session, 'scoringTemplateId' | 'scoringTemplateVersion' | 'scoringMap' | 'packSnapshot'> | null): ScoringTemplateSnapshot => {
  const directMap = session?.scoringMap
  if (directMap && Object.keys(directMap).every(isResponseValue)) {
    return {
      scoringTemplateId: session.scoringTemplateId || 'standard-v1',
      scoringTemplateVersion: Number(session.scoringTemplateVersion) || 1,
      scoringMap: { ...getScoringTemplate(session.scoringTemplateId || 'standard-v1').scoringMap, ...directMap },
    }
  }

  const legacy = session?.packSnapshot?.scoring as PackScoringSnapshot | undefined
  if (legacy?.scoringMap && Object.keys(legacy.scoringMap).every(isResponseValue)) {
    return {
      scoringTemplateId: legacy.scoringTemplateId || 'standard-v1',
      scoringTemplateVersion: Number(legacy.scoringTemplateVersion) || 1,
      scoringMap: { ...getScoringTemplate(legacy.scoringTemplateId || 'standard-v1').scoringMap, ...legacy.scoringMap },
    }
  }
  if (legacy?.answerScores) {
    return {
      scoringTemplateId: 'standard-v1',
      scoringTemplateVersion: 1,
      scoringMap: { ...legacy.answerScores, SKIP: Number(legacy.skippedAnswerScore ?? -1) },
    }
  }
  return getScoringTemplate('standard-v1')
}

export const scoreAnswers = (
  answers: Record<string, ResponseValue> = {},
  questionSet: Question[] = questions,
  scoring: ScoringTemplateSnapshot = getScoringTemplate(),
): Scores => {
  const result = Object.fromEntries(Object.keys(categories).map(id => [id, 0])) as Record<CategoryId, number>
  const map = scoring.scoringMap
  const values = Object.values(map)
  const highest = Math.max(...values)
  const lowest = Math.min(...values)
  let totalPoints = 0
  let totalMaximum = 0
  let totalMinimum = 0
  for (const category of Object.keys(categories) as CategoryId[]) {
    const items = questionSet.filter(question => question.category === category)
    const points = items.reduce((sum, question) => sum + (answers[question.id] ? map[answers[question.id]] : 0), 0)
    const maximum = items.length * highest
    const minimum = items.length * lowest
    // Percentages deliberately remain relative to the positive maximum. This
    // keeps the established diagnostic display of skipped/negative answers.
    result[category] = maximum ? Math.round(points / maximum * 100) : 0
    totalPoints += points
    totalMaximum += maximum
    totalMinimum += minimum
  }
  return {
    categories: result,
    total: totalMaximum ? Math.round(totalPoints / totalMaximum * 100) : 0,
    points: totalPoints,
    maximumPoints: totalMaximum,
    minimumPoints: totalMinimum,
  }
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
