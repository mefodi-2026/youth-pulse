export type CategoryId = 'communication' | 'forgiveness' | 'service' | 'care' | 'honesty'
export type Answer = 'A' | 'B' | 'C' | 'D'
export type ResponseValue = Answer | 'SKIP'
export type SessionPhase = 'lobby' | 'live' | 'personal' | 'resultsIntro' | 'resultsReal' | 'closed'

export interface Question { id: string; category: CategoryId; title: string; options: Record<Answer, string> }
export interface Participant { id: string; nickname: string; joinedAt: number; status: 'waiting' | 'answering' | 'finished'; currentQuestionIndex: number; answers: Record<string, ResponseValue>; completedAt?: number; personalViewedAt?: number }
export interface Session { roomId: string; createdAt: number; phase: SessionPhase; maxParticipants: number; hostUid: string; resultsIntroStartedAt?: number; closedAt?: number; questions?: Question[]; participants: Record<string, Participant> }
export interface SessionArchive extends Session { archivedAt: number }
export interface Scores { total: number; categories: Record<CategoryId, number> }

