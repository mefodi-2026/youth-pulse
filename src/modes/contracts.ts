import type { ContentPack, PackRuleConfig, Question, ResponseValue, Scores, ScoringTemplateId, Session, TemplateSelection } from '../types'
import type { ComponentType } from 'react'

export interface GameModule {
  productId: string
  gameTypeId: string
  contentSchemaVersion: number
  defaultRuleConfig: PackRuleConfig
  normalizeRuleConfig: (value?: Partial<PackRuleConfig>) => PackRuleConfig
  getQuestions: (session: Pick<Session, 'templateSnapshot' | 'packSnapshot' | 'questions' | 'gameTypeId'> | null | undefined, legacyFallback: Question[]) => Question[]
  score: (answers: Record<string, ResponseValue>, questionSet: Question[], session?: Session | null) => Scores
}

export interface ModeDataContract {
  packSchema: string
  participantQuestionSchema: string
  resultSchema: string
  legacySessionFallback: boolean
  roomStateSchema?: string
}

export interface ModeLandingScreenProps {
  onSetup: () => void
}

export interface ModeSetupScreenProps {
  onBack: () => void
}

export interface ModeOptionalScreens {
  landingScreen?: ComponentType<ModeLandingScreenProps>
  setupScreen?: ComponentType<ModeSetupScreenProps>
}

export interface ModeSurfaceLinks {
  setup: string
  participant: string
  host: string
  results: string
}

export interface ModePackContext {
  defaultPackId: string
  selection: TemplateSelection
  systemPacks: Record<string, ContentPack>
  workspacePacks: Record<string, ContentPack>
}

export interface ModeSetupPolicy {
  defaultScoringTemplateId: ScoringTemplateId
  initialSelection: (context: Omit<ModePackContext, 'selection'>) => TemplateSelection | null
  resolvePack: (context: ModePackContext) => ContentPack | null
  validateSelection: (context: ModePackContext) => void
}
