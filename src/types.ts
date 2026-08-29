import type { WheelRoomState } from './modes/wheel/types'

export type CategoryId = 'communication' | 'forgiveness' | 'service' | 'care' | 'honesty'
export type Answer = 'A' | 'B' | 'C' | 'D'
export type ResponseValue = Answer | 'SKIP'
export type SessionPhase = 'lobby' | 'live' | 'personal' | 'resultsIntro' | 'resultsReal' | 'closed'
/** A session format selected by a leader. Quiz is reserved for the future game module. */
export type RoomMode = 'diagnostic' | 'quiz' | 'wheel'
export type QuizDifficulty = 'easy' | 'medium' | 'hard'
export type SessionEventType = 'room_created' | 'room_started' | 'participant_joined' | 'participant_finished' | 'report_viewed' | 'room_closed'
export type UserStatus = 'pending' | 'active' | 'paused' | 'revoked'
export type BillingStatus = 'free' | 'pilot' | 'manual_paid' | 'expired' | 'disabled'
export type AccessSource = 'pilot' | 'manual'
export type ProductStatus = 'enabled' | 'maintenance' | 'testing' | 'disabled'
export type ProductId = string
export type GameTypeId = string
export type PackId = string
export type PackVersion = number
export type TemplateOrigin = 'system' | 'workspace'
/** Stable, versioned scoring presets selectable during room setup. */
export type ScoringTemplateId = 'standard-v1' | 'strict-v1'
export interface TemplateSelection { selectedPackId: PackId; templateSource: TemplateOrigin }
/** `active` is a legacy editor alias. Firebase records are always written as `published`. */
export type PackStatus = 'draft' | 'published' | 'archived' | 'active'
export interface PackRuleConfig {
  allowSkip: boolean
  answerMode: 'single-choice' | 'none'
  questionOrder: 'fixed' | 'shuffled'
  scoringMode: 'diagnostic-3-2-1-0' | 'diagnostic-2-1-0-minus-1' | 'quiz-correct-1-0' | 'none'
}

export interface BaseQuestion {
  id: string
  title: string
  options: Record<Answer, string>
}
export interface DiagnosticQuestion extends BaseQuestion {
  category: CategoryId
  /** Position inside the category. Legacy questions without it use their existing order as a fallback. */
  categoryOrder?: number
}
/** Quiz content deliberately has no required diagnostic category. */
export interface QuizQuestion extends BaseQuestion {
  category?: never
}
export type Question = DiagnosticQuestion | QuizQuestion
export interface PackSettings { [key: string]: boolean | number | string | null }
export interface PackContent { questions: Question[] }
/** Material that may be exposed while selecting a pack or playing a room. */
export interface PublicPackContent { questions: ParticipantQuestion[] }
export interface PackScoringSnapshot {
  /** Present on rooms created after the scoring-template setup was added. */
  scoringTemplateId?: ScoringTemplateId
  scoringTemplateVersion?: number
  scoringMap?: Record<ResponseValue, number>
  /** Legacy mirrors retained only to calculate rooms created before templates. */
  mode?: PackRuleConfig['scoringMode']
  answerScores?: Record<Answer, number>
  skippedAnswerScore?: number
}
/**
 * The compact immutable record copied into a room. It intentionally excludes
 * owner-only audit fields and any future editor-only draft metadata.
 */
export interface PackSnapshot {
  title: string
  description: string
  questions: Question[]
  settings: PackSettings
  /** Declarative scoring configuration captured with the room. */
  ruleConfig?: PackRuleConfig
  /** Concrete scoring values captured with the room for stable exports. */
  scoring?: PackScoringSnapshot
}
export interface ContentPack {
  productId: ProductId
  gameTypeId: GameTypeId
  /** Missing on legacy packs; treat as a diagnostic pack. */
  mode?: RoomMode
  difficulty?: QuizDifficulty
  packId: PackId
  /** `version` is the content version; `packVersion` remains for older sessions. */
  version?: PackVersion
  packVersion: PackVersion
  status?: PackStatus
  /** System pack from which a workspace copy was made, if applicable. */
  sourcePackId?: PackId
  templateOrigin: TemplateOrigin
  title: string
  description: string
  /** Canonical content field for global packs. `content.questions` stays as a legacy mirror. */
  questions: Question[]
  content: PackContent
  publicContent?: PublicPackContent
  settings: PackSettings
  /** Declarative, allow-listed options. It is never interpreted as executable code. */
  ruleConfig?: PackRuleConfig
  contentSchemaVersion?: number
  workspaceId?: string
  /** Audit metadata. System packs are maintained only by the platform owner. */
  createdAt?: number
  updatedAt?: number
  createdBy?: string
  /** Audit fields used by a quiz copied from the global library. */
  sourcePackVersion?: PackVersion
  copiedBy?: string
  copiedAt?: number
}
export interface TemplateSnapshot extends ContentPack { capturedAt: number }
export interface Participant { id: string; nickname: string; joinedAt: number; status: 'waiting' | 'answering' | 'finished'; currentQuestionIndex: number; answers: Record<string, ResponseValue>; completedAt?: number; personalViewedAt?: number }
/** Operational event log. It intentionally contains IDs and nicknames only, never participant real names or answers. */
export interface SessionEvent {
  id: string
  type: SessionEventType
  roomId: string
  workspaceId?: string
  /** Present for host events. Participant events intentionally do not expose a host UID. */
  hostUid?: string
  participantId?: string
  createdAt: number
}
export interface LeaderProfile { uid: string; fullName: string; phone: string; email: string; workspaceId: string; status: UserStatus; inviteCode?: string; createdAt: number; updatedAt: number; lastActiveAt?: number }
export interface Workspace {
  id: string
  name: string
  city: string
  ownerUid: string
  /** Access fields are optional only to preserve workspaces created before the access layer. */
  planId?: string
  billingStatus?: BillingStatus
  /** Unix milliseconds; 0 means access has no scheduled end. */
  accessEndsAt?: number
  accessSource?: AccessSource
  createdAt: number
  updatedAt: number
}
export interface WorkspaceProduct {
  productId: ProductId
  ownerUid: string
  enabled: boolean
  accessSource: AccessSource
  /** Human-readable plan marker. `planId` is retained for existing records. */
  plan?: string
  planId: string
  startsAt: number
  /** Unix milliseconds; 0 means access has no scheduled end. */
  expiresAt: number
  testing: boolean
}
export type ProductType = 'diagnostic' | 'quiz' | 'game'
/**
 * Published operational configuration. Draft edits intentionally stay in the
 * owner UI until they are explicitly published by the platform owner.
 */
export interface ProductConfig {
  productId: ProductId
  name: string
  description: string
  type: ProductType
  status: ProductStatus
  version: number
  maintenanceMessage?: string
  updatedAt: number
  publishedAt?: number
}
export interface Invite { status: 'active' | 'disabled'; expiresAt?: number }
export interface Session {
  roomId: string
  /** Human-readable meeting name. Older rooms may not have it. */
  roomTitle?: string
  /** Immutable code shown to the host; defaults to roomId for legacy rooms. */
  displayCode?: string
  createdAt: number
  phase: SessionPhase
  /** Stable phase mirror for pilot exports and integrations. */
  status?: SessionPhase
  maxParticipants: number
  hostUid: string
  /** UID that created the room; optional only for historical sessions. */
  createdBy?: string
  workspaceId?: string
  /** Pilot-analysis metadata; optional to keep old rooms readable. */
  groupName?: string
  city?: string
  mode?: RoomMode
  /** Quiz metadata is optional to preserve rooms created before the quiz module. */
  quizPackId?: PackId
  quizPackVersion?: PackVersion
  difficulty?: QuizDifficulty
  startedAt?: number
  /** Expected number stated by the leader when a room is created. */
  estimatedParticipants?: number
  /** Current aggregate counts. Participant nicknames and answers remain separate. */
  participantCount?: number
  completedCount?: number
  selectedPackId?: PackId
  templateSource?: TemplateOrigin
  productId?: ProductId
  gameTypeId?: GameTypeId
  packId?: PackId
  sourcePackId?: PackId
  packVersion?: PackVersion
  /** Source-pack modification time captured during room creation. */
  packUpdatedAt?: number
  /** Immutable source snapshot identity captured at room creation. */
  snapshotId?: string
  /** Compact immutable snapshot required by the room contract. */
  packSnapshot?: PackSnapshot
  /** Room-level settings captured from the selected pack at creation. */
  settings?: PackSettings
  /** Immutable selected scoring preset. Old rooms intentionally omit these fields. */
  scoringTemplateId?: ScoringTemplateId
  scoringTemplateVersion?: number
  scoringMap?: Record<ResponseValue, number>
  templateOrigin?: TemplateOrigin
  templateSnapshot?: TemplateSnapshot
  resultsIntroStartedAt?: number
  closedAt?: number
  /** Legacy mirror retained so existing rooms continue to work during migration. */
  questions?: Question[]
  participants: Record<string, Participant>
  events?: Record<string, SessionEvent>
  /** Mode-owned state. Diagnostic and quiz never read or write this branch. */
  wheel?: WheelRoomState
}
export interface SessionArchive extends Session { archivedAt: number }
/** Feedback belongs to a leader workspace and is visible only to the platform owner. */
export interface FeedbackItem {
  id: string
  uid: string
  workspaceId: string
  message: string
  createdAt: number
}
/** Public, deliberately minimal join metadata. It never contains questions or answers. */
export interface RoomLobby {
  roomId: string
  roomTitle?: string
  displayCode?: string
  hostUid: string
  workspaceId: string
  phase: SessionPhase
  maxParticipants: number
  createdAt: number
  closedAt?: number
  mode?: RoomMode
  packId?: PackId
  packTitle?: string
  difficulty?: QuizDifficulty
}
/**
 * Deliberately minimal room metadata readable by anonymous participants.
 * Private session data, workspace ownership and host identity never belong here.
 */
export interface PublicRoom {
  roomId: string
  roomTitle?: string
  displayCode?: string
  phase: SessionPhase
  maxParticipants: number
  createdAt: number
  closedAt?: number
  mode?: RoomMode
  gameTypeId?: GameTypeId
  productId?: ProductId
  packId?: PackId
  packTitle?: string
  difficulty?: QuizDifficulty
  scoringTemplateId?: ScoringTemplateId
  /** Participant-safe wheel status. Full pools and participant IDs are never mirrored here. */
  wheel?: {
    inputMode: 'participants' | 'host'
    drawOrder: 'name_then_task' | 'task_then_name'
    phase: import('./modes/wheel/types').WheelPhase
    version?: number
    nameCount: number
    taskCount: number
    submissionCount: number
    roundCount?: number
    pendingCount?: number
    currentRound?: import('./modes/wheel/types').WheelPublicRound
    activeSpin?: import('./modes/wheel/types').WheelSpinAnimation
    history?: import('./modes/wheel/types').WheelPublicHistoryItem[]
  }
}
/** Question shape sent to a participant. Answer keys and explanations are excluded. */
export type ParticipantQuestion = Question
export interface ParticipantQuestionSet {
  roomId: string
  createdAt: number
  mode?: RoomMode
  gameTypeId?: GameTypeId
  productId?: ProductId
  packId?: PackId
  packTitle?: string
  scoringTemplateId?: ScoringTemplateId
  questions: ParticipantQuestion[]
}
export interface ParticipantQuizResult {
  participantId: string
  correct: number
  total: number
  percentage: number
  releasedAt: number
}
export interface Scores {
  total: number
  categories: Record<CategoryId, number>
  /** Raw point range is useful for exports and future reports; existing UI can ignore it. */
  points?: number
  maximumPoints?: number
  minimumPoints?: number
}

export const getSessionQuestions = (session: Pick<Session, 'templateSnapshot' | 'packSnapshot' | 'questions'> | null | undefined, fallback: Question[]) => {
  const packSnapshotQuestions = session?.packSnapshot?.questions
  if (Array.isArray(packSnapshotQuestions)) return packSnapshotQuestions
  const snapshotQuestions = session?.templateSnapshot?.content.questions
  if (Array.isArray(snapshotQuestions)) return snapshotQuestions
  if (Array.isArray(session?.questions)) return session.questions
  return fallback
}
