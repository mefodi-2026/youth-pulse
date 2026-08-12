export type CategoryId = 'communication' | 'forgiveness' | 'service' | 'care' | 'honesty'
export type Answer = 'A' | 'B' | 'C' | 'D'
export type ResponseValue = Answer | 'SKIP'
export type SessionPhase = 'lobby' | 'live' | 'personal' | 'resultsIntro' | 'resultsReal' | 'closed'
/** A session format selected by a leader. Quiz is reserved for the future game module. */
export type RoomMode = 'diagnostic' | 'quiz'
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
export interface TemplateSelection { selectedPackId: PackId; templateSource: TemplateOrigin }
export type PackStatus = 'draft' | 'active' | 'archived'
export interface PackRuleConfig {
  allowSkip: boolean
  answerMode: 'single-choice'
  questionOrder: 'fixed' | 'shuffled'
  scoringMode: 'diagnostic-3-2-1-0'
}

export interface Question {
  id: string
  category: CategoryId
  /** Position inside the category. Legacy questions without it use their existing order as a fallback. */
  categoryOrder?: number
  title: string
  options: Record<Answer, string>
}
export interface PackSettings { [key: string]: boolean | number | string | null }
export interface PackContent { questions: Question[] }
/**
 * The compact immutable record copied into a room. It intentionally excludes
 * owner-only audit fields and any future editor-only draft metadata.
 */
export interface PackSnapshot {
  title: string
  description: string
  questions: Question[]
  settings: PackSettings
}
export interface ContentPack {
  productId: ProductId
  gameTypeId: GameTypeId
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
  settings: PackSettings
  /** Declarative, allow-listed options. It is never interpreted as executable code. */
  ruleConfig?: PackRuleConfig
  contentSchemaVersion?: number
  workspaceId?: string
  /** Audit metadata. System packs are maintained only by the platform owner. */
  createdAt?: number
  updatedAt?: number
  createdBy?: string
}
export interface TemplateSnapshot extends ContentPack { capturedAt: number }
export interface Participant { id: string; nickname: string; joinedAt: number; status: 'waiting' | 'answering' | 'finished'; currentQuestionIndex: number; answers: Record<string, ResponseValue>; completedAt?: number; personalViewedAt?: number }
/** Operational event log. It intentionally contains IDs and nicknames only, never participant real names or answers. */
export interface SessionEvent {
  id: string
  type: SessionEventType
  roomId: string
  workspaceId?: string
  hostUid: string
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
  maxParticipants: number
  hostUid: string
  workspaceId?: string
  /** Pilot-analysis metadata; optional to keep old rooms readable. */
  groupName?: string
  city?: string
  mode?: RoomMode
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
  /** Compact immutable snapshot required by the room contract. */
  packSnapshot?: PackSnapshot
  templateOrigin?: TemplateOrigin
  templateSnapshot?: TemplateSnapshot
  resultsIntroStartedAt?: number
  closedAt?: number
  /** Legacy mirror retained so existing rooms continue to work during migration. */
  questions?: Question[]
  participants: Record<string, Participant>
  events?: Record<string, SessionEvent>
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
}
export interface Scores { total: number; categories: Record<CategoryId, number> }

export const getSessionQuestions = (session: Pick<Session, 'templateSnapshot' | 'packSnapshot' | 'questions'> | null | undefined, fallback: Question[]) => {
  const packSnapshotQuestions = session?.packSnapshot?.questions
  if (Array.isArray(packSnapshotQuestions)) return packSnapshotQuestions
  const snapshotQuestions = session?.templateSnapshot?.content.questions
  if (Array.isArray(snapshotQuestions)) return snapshotQuestions
  if (Array.isArray(session?.questions)) return session.questions
  return fallback
}

