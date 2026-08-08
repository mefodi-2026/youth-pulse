export type CategoryId = 'communication' | 'forgiveness' | 'service' | 'care' | 'honesty'
export type Answer = 'A' | 'B' | 'C' | 'D'
export type ResponseValue = Answer | 'SKIP'
export type SessionPhase = 'lobby' | 'live' | 'personal' | 'resultsIntro' | 'resultsReal' | 'closed'
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

export interface Question { id: string; category: CategoryId; title: string; options: Record<Answer, string> }
export interface PackSettings { [key: string]: boolean | number | string | null }
export interface PackContent { questions: Question[] }
export interface ContentPack {
  productId: ProductId
  gameTypeId: GameTypeId
  packId: PackId
  packVersion: PackVersion
  templateOrigin: TemplateOrigin
  title: string
  content: PackContent
  settings: PackSettings
  workspaceId?: string
}
export interface TemplateSnapshot extends ContentPack { capturedAt: number }
export interface Participant { id: string; nickname: string; joinedAt: number; status: 'waiting' | 'answering' | 'finished'; currentQuestionIndex: number; answers: Record<string, ResponseValue>; completedAt?: number; personalViewedAt?: number }
export interface LeaderProfile { uid: string; fullName: string; phone: string; email: string; workspaceId: string; status: UserStatus; inviteCode?: string; createdAt: number; updatedAt: number }
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
  planId: string
  startsAt: number
  /** Unix milliseconds; 0 means access has no scheduled end. */
  expiresAt: number
  testing: boolean
}
export interface ProductConfig { productId: ProductId; status: ProductStatus }
export interface Invite { status: 'active' | 'disabled'; expiresAt?: number }
export interface Session {
  roomId: string
  createdAt: number
  phase: SessionPhase
  maxParticipants: number
  hostUid: string
  workspaceId?: string
  selectedPackId?: PackId
  templateSource?: TemplateOrigin
  productId?: ProductId
  gameTypeId?: GameTypeId
  packId?: PackId
  packVersion?: PackVersion
  templateOrigin?: TemplateOrigin
  templateSnapshot?: TemplateSnapshot
  resultsIntroStartedAt?: number
  closedAt?: number
  /** Legacy mirror retained so existing rooms continue to work during migration. */
  questions?: Question[]
  participants: Record<string, Participant>
}
export interface SessionArchive extends Session { archivedAt: number }
export interface Scores { total: number; categories: Record<CategoryId, number> }

export const getSessionQuestions = (session: Pick<Session, 'templateSnapshot' | 'questions'> | null | undefined, fallback: Question[]) => {
  const snapshotQuestions = session?.templateSnapshot?.content.questions
  if (snapshotQuestions?.length) return snapshotQuestions
  return session?.questions?.length ? session.questions : fallback
}
