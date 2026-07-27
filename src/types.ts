export type CategoryId = 'communication' | 'forgiveness' | 'service' | 'care'
export type Answer = 'A' | 'B' | 'C' | 'D'
export type SessionPhase = 'lobby' | 'live' | 'personal' | 'resultsIntro' | 'resultsReal' | 'closed'

export interface Question { id: string; category: CategoryId; title: string; options: Record<Answer, string> }
export interface Participant { id: string; nickname: string; joinedAt: number; status: 'waiting' | 'answering' | 'finished'; currentQuestionIndex: number; answers: Record<string, Answer>; completedAt?: number; personalViewedAt?: number }
export interface Session { roomId: string; createdAt: number; phase: SessionPhase; maxParticipants: number; hostUid: string; resultsIntroStartedAt?: number; participants: Record<string, Participant> }
export interface Scores { total: number; categories: Record<CategoryId, number> }
