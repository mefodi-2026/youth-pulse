import type { ModeManifest } from '../modeRegistry'
import { diagnosticGameModule } from './gameModule'
import { DiagnosticParticipantQuestionScreen } from './participant'
import { diagnosticSelection } from './contract'
import { diagnosticStatusDescription, diagnosticStatusText } from './presentation'

export const diagnosticManifest: ModeManifest = {
  id: 'diagnostic',
  mode: 'diagnostic',
  title: 'Диагностика',
  description: 'Проведите диагностику атмосферы молодёжи и получите статистику по категориям.',
  icon: '✦',
  menuLabel: 'Диагностика',
  productionMenu: true,
  runtime: diagnosticGameModule,
  setupPolicy: {
    defaultScoringTemplateId: 'standard-v1',
    initialSelection: ({ defaultPackId, workspacePacks }) => workspacePacks[defaultPackId]?.questions.length
      ? { selectedPackId: defaultPackId, templateSource: 'workspace' }
      : diagnosticSelection(defaultPackId),
    resolvePack: ({ selection, systemPacks, workspacePacks }) => selection.templateSource === 'workspace'
      ? workspacePacks[selection.selectedPackId] || null
      : systemPacks[selection.selectedPackId] || null,
    validateSelection: ({ selection, systemPacks, workspacePacks }) => {
      const pack = selection.templateSource === 'workspace' ? workspacePacks[selection.selectedPackId] : systemPacks[selection.selectedPackId]
      if (!pack) throw new Error('Опубликованный диагностический набор пока недоступен. Обновите страницу и попробуйте снова.')
    },
  },
  participantScreen: DiagnosticParticipantQuestionScreen,
  routes: { setup: '/host?tab=roomSetup&mode=diagnostic', participant: '/join', host: '/host', results: '/host?tab=results' },
  surfaces: {
    setup: 'modes/diagnostic/setup',
    participant: 'modes/diagnostic/participant',
    host: 'modes/diagnostic/host',
    results: 'modes/diagnostic/results',
  },
  dataContract: {
    packSchema: 'diagnostic-pack-v1',
    participantQuestionSchema: 'diagnostic-participant-question-v1',
    resultSchema: 'diagnostic-category-percentages-v1',
    legacySessionFallback: true,
  },
  capabilities: ['categories', 'personal-report', 'skip', 'scoring-presets'],
  statusText: diagnosticStatusText,
  statusDescription: diagnosticStatusDescription,
  resultsLabel: 'Результаты',
}
