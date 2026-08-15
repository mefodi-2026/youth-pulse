import type { RoomMode } from '../types'
import { diagnosticMode } from './diagnostic/contract'
import { quizMode } from './quiz/contract'

/**
 * Presentation-level metadata for modes. Game mechanics deliberately stay in
 * their mode contracts and gameRegistry; this file only drives host navigation
 * and makes a future mode additive instead of another App.tsx conditional.
 */
export interface ModeDefinition {
  mode: RoomMode
  title: string
  description: string
  icon: string
  menuLabel: string
  setupTab: 'roomSetup'
  participantRoute: '/join'
  hostRoute: '/host'
  resultsRoute: '/host'
  capabilities: readonly string[]
}

/**
 * Planned modules are intentionally metadata only: they are not routable,
 * cannot create rooms and do not extend RoomMode until their own isolated
 * folder, contract and security review are added.
 */
export interface PlannedModeBlueprint {
  id: string
  title: string
  description: string
}

export const plannedModeBlueprints: readonly PlannedModeBlueprint[] = [
  { id: 'wheel-of-fortune', title: 'Колесо фортуны', description: 'Будущий игровой модуль с отдельным контрактом и UI.' },
]

export const modeRegistry: Record<RoomMode, ModeDefinition> = {
  diagnostic: {
    mode: diagnosticMode,
    title: 'Диагностика',
    description: 'Проведите диагностику атмосферы молодёжи и получите статистику по категориям.',
    icon: '✦',
    menuLabel: 'Диагностика',
    setupTab: 'roomSetup',
    participantRoute: '/join',
    hostRoute: '/host',
    resultsRoute: '/host',
    capabilities: ['categories', 'personal-report', 'skip', 'scoring-presets'],
  },
  quiz: {
    mode: quizMode,
    title: 'Библейская викторина',
    description: 'Проведите викторину по Библии и определите участников с лучшим результатом.',
    icon: '✦',
    menuLabel: 'Библейская викторина',
    setupTab: 'roomSetup',
    participantRoute: '/join',
    hostRoute: '/host',
    resultsRoute: '/host',
    capabilities: ['difficulty', 'correct-answer', 'top-3', 'workspace-copy'],
  },
}

export const getModeDefinition = (mode?: RoomMode) => modeRegistry[mode || diagnosticMode]
