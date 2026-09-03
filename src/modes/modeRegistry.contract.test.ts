import type { PackRuleConfig } from '../types'
import type { GameModule } from './contracts'
import { createModeRegistry, type ModeManifest } from './modeRegistry'
import type { ParticipantQuestionScreenProps } from './participantTypes'

const TestParticipantScreen = (_props: ParticipantQuestionScreenProps) => null

const testRuntime: GameModule = {
  productId: 'contract-test-product',
  gameTypeId: 'contract-test-mode',
  contentSchemaVersion: 1,
  defaultRuleConfig: { allowSkip: false, answerMode: 'single-choice', questionOrder: 'fixed', scoringMode: 'quiz-correct-1-0' },
  normalizeRuleConfig: value => ({ allowSkip: false, answerMode: 'single-choice', questionOrder: value?.questionOrder === 'shuffled' ? 'shuffled' : 'fixed', scoringMode: 'quiz-correct-1-0' } as PackRuleConfig),
  getQuestions: (_session, fallback) => fallback,
  score: (_answers, questions) => ({ total: 0, categories: { communication: 0, forgiveness: 0, service: 0, care: 0, honesty: 0 }, maximumPoints: questions.length }),
}

/** Compile-time/test-only proof that a third module is one additive manifest. */
export const testOnlyManifest: ModeManifest = {
  id: 'contract-test-mode',
  mode: 'contract-test-mode',
  title: 'Test only',
  description: 'Never included in the production menu.',
  icon: 'T',
  menuLabel: 'Test only',
  productionMenu: false,
  runtime: testRuntime,
  setupPolicy: {
    defaultScoringTemplateId: 'standard-v1',
    initialSelection: ({ defaultPackId }) => ({ selectedPackId: defaultPackId, templateSource: 'system' }),
    resolvePack: ({ selection, systemPacks }) => systemPacks[selection.selectedPackId] || null,
    validateSelection: () => undefined,
  },
  participantScreen: TestParticipantScreen,
  routes: { setup: '/test/setup', participant: '/test/join', host: '/test/host', results: '/test/results' },
  surfaces: { setup: 'test/setup', participant: 'test/participant', host: 'test/host', results: 'test/results' },
  dataContract: { packSchema: 'test-v1', participantQuestionSchema: 'test-public-v1', resultSchema: 'test-result-v1', legacySessionFallback: false },
  capabilities: [],
  statusText: () => 'Test status',
  statusDescription: () => 'Test status description',
  resultsLabel: 'Test results',
}

const contractRegistry = createModeRegistry([testOnlyManifest])
if (contractRegistry[testOnlyManifest.id] !== testOnlyManifest || testOnlyManifest.productionMenu) {
  throw new Error('Mode registry contract failed.')
}
