import type { ModeManifest } from '../modeRegistry'
import { verseMatchDataContract, verseMatchGameTypeId } from './contract'
import { verseMatchGameModule } from './gameModule'
import { VerseLandingScreen, VerseParticipantFlow, VerseParticipantPlaceholder, VerseSetupScreen } from './screens'
import { verseMatchStatusDescription, verseMatchStatusText } from './presentation'

export const verseMatchManifest: ModeManifest = {
  id: verseMatchGameTypeId, mode: verseMatchGameTypeId, title: 'Собери стих',
  description: 'Командная игра на сопоставление начала и окончания библейских стихов.', icon: '✦', menuLabel: 'Собери стих', productionMenu: true,
  runtime: verseMatchGameModule,
  setupPolicy: { defaultScoringTemplateId: 'standard-v1', initialSelection: () => null, resolvePack: () => null, validateSelection: () => undefined },
  participantScreen: VerseParticipantPlaceholder, participantFlow: VerseParticipantFlow,
  landingScreen: VerseLandingScreen, setupScreen: VerseSetupScreen,
  routes: { setup: '/host?tab=roomSetup&mode=verse-match', participant: '/join', host: '/verse-host', results: '/verse-host' },
  surfaces: { setup: 'modes/verse-match/setup', participant: 'modes/verse-match/participant', host: 'modes/verse-match/host', results: 'modes/verse-match/results' },
  dataContract: verseMatchDataContract,
  capabilities: ['server-distribution', 'private-cards', 'manual-rounds', 'early-results', 'pack-editor'],
  statusText: verseMatchStatusText, statusDescription: verseMatchStatusDescription, resultsLabel: 'Результаты игры',
}
