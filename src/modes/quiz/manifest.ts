import type { ModeManifest } from '../modeRegistry'
import { bibleQuizGameModule } from './gameModule'
import { QuizParticipantQuestionScreen } from './participant'
import { initialQuizSelection } from './contract'

export const quizManifest: ModeManifest = {
  id: 'quiz',
  mode: 'quiz',
  title: 'Библейская викторина',
  description: 'Проведите викторину по Библии и определите участников с лучшим результатом.',
  icon: '✦',
  menuLabel: 'Библейская викторина',
  productionMenu: true,
  runtime: bibleQuizGameModule,
  setupPolicy: {
    defaultScoringTemplateId: 'standard-v1',
    initialSelection: ({ workspacePacks, systemPacks }) => initialQuizSelection(workspacePacks, systemPacks),
    resolvePack: ({ selection, systemPacks, workspacePacks }) => selection.templateSource === 'workspace'
      ? workspacePacks[selection.selectedPackId] || null
      : systemPacks[selection.selectedPackId] || null,
    validateSelection: ({ selection, workspacePacks }) => {
      if (selection.templateSource !== 'workspace' || !workspacePacks[selection.selectedPackId]) {
        throw new Error('Сначала добавьте выбранный набор викторины в свой workspace, затем выберите его для комнаты.')
      }
    },
  },
  participantScreen: QuizParticipantQuestionScreen,
  routes: { setup: '/host?tab=roomSetup&mode=quiz', participant: '/join', host: '/host', results: '/host?tab=results' },
  surfaces: {
    setup: 'modes/quiz/setup',
    participant: 'modes/quiz/participant',
    host: 'modes/quiz/host',
    results: 'modes/quiz/results',
  },
  dataContract: {
    packSchema: 'quiz-public-pack-v1',
    participantQuestionSchema: 'quiz-participant-question-without-answer-key-v1',
    resultSchema: 'trusted-quiz-result-v1',
    legacySessionFallback: false,
  },
  capabilities: ['difficulty', 'trusted-grading', 'top-3', 'workspace-copy'],
}
