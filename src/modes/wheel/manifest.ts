import type { ModeManifest } from '../modeRegistry'
import { wheelDataContract, wheelGameTypeId } from './contract'
import { wheelGameModule } from './gameModule'
import { WheelHostScreen, WheelLandingScreen, WheelMainScreen, WheelParticipantFlow, WheelParticipantPlaceholder, WheelSetupScreen } from './screens'

export const wheelManifest: ModeManifest = {
  id: wheelGameTypeId,
  mode: wheelGameTypeId,
  title: 'Колесо фортуны',
  description: 'Два синхронных колеса: имена участников и задания для молодёжной встречи.',
  icon: '◉',
  menuLabel: 'Колесо фортуны',
  productionMenu: true,
  runtime: wheelGameModule,
  setupPolicy: {
    defaultScoringTemplateId: 'standard-v1',
    initialSelection: () => null,
    resolvePack: () => null,
    validateSelection: () => undefined,
  },
  participantScreen: WheelParticipantPlaceholder,
  participantFlow: WheelParticipantFlow,
  hostScreen: WheelHostScreen,
  mainScreen: WheelMainScreen,
  landingScreen: WheelLandingScreen,
  setupScreen: WheelSetupScreen,
  routes: { setup: '/host?tab=roomSetup&mode=wheel', participant: '/join', host: '/host?tab=currentRoom', results: '/host?tab=currentRoom&view=results' },
  surfaces: {
    setup: 'modes/wheel/setup',
    participant: 'modes/wheel/participant',
    host: 'modes/wheel/host',
    results: 'modes/wheel/results',
  },
  dataContract: wheelDataContract,
  capabilities: ['participant-input', 'host-input', 'name-task-order', 'pending-tasks'],
}
