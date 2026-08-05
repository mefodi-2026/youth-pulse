export type CategoryId = 'communication' | 'forgiveness' | 'service' | 'care' | 'honesty'
export type Answer = 'A' | 'B' | 'C' | 'D'
export type ResponseValue = Answer | 'SKIP'
export type SessionPhase = 'lobby' | 'live' | 'personal' | 'resultsIntro' | 'resultsReal' | 'closed'
export type UserStatus = 'pending' | 'active' | 'paused' | 'revoked'

export interface Question { id: string; category: CategoryId; title: string; options: Record<Answer, string> }
export interface Participant { id: string; nickname: string; joinedAt: number; status: 'waiting' | 'answering' | 'finished'; currentQuestionIndex: number; answers: Record<string, ResponseValue>; completedAt?: number; personalViewedAt?: number }
export interface LeaderProfile { uid: string; fullName: string; phone: string; email: string; workspaceId: string; status: UserStatus; inviteCode?: string; createdAt: number; updatedAt: number }
export interface Workspace { id: string; name: string; city: string; ownerUid: string; createdAt: number; updatedAt: number }
export interface Invite { status: 'active' | 'disabled'; expiresAt?: number }
export interface Session { roomId: string; createdAt: number; phase: SessionPhase; maxParticipants: number; hostUid: string; workspaceId?: string; resultsIntroStartedAt?: number; closedAt?: number; questions?: Question[]; participants: Record<string, Participant> }
export interface SessionArchive extends Session { archivedAt: number }
export interface Scores { total: number; categories: Record<CategoryId, number> }

