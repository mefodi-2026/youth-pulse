export type VerseDifficulty = 'easy' | 'medium' | 'hard'
export type VerseDirection = 'starts' | 'ends' | 'mixed'
export type VerseCardDirection = 'start' | 'end'
export type VersePhase = 'lobby' | 'live' | 'completed' | 'closed'

export interface VerseEntry {
  id: string; bookId: string; book: string; chapter: number; verse: string; reference: string
  translation: string; fullText: string; start: string; end: string
  difficulty: VerseDifficulty; enabled: boolean; verificationStatus: 'draft' | 'verified' | 'rejected'
}

export interface VersePack {
  packId: string; version: number; title: string; description: string; translation: string
  sourceUrl: string; license: string; status: 'draft' | 'published' | 'archived'; entries: VerseEntry[]
  workspaceId?: string; sourcePackId?: string; createdBy?: string; createdAt?: number; updatedAt?: number
}

export interface VerseRound {
  roundId: string; version: number; status: 'open' | 'revealed'; promptDirection: VerseCardDirection
  promptText: string; outcome?: 'correct' | 'missed'; fullText?: string; reference?: string; answeredByName?: string
}

export interface VerseResult {
  participantId: string; nickname: string; correct: number; errors: number; missed: number
  remaining: number; total: number; percentage: number; perfect: boolean; place: number | null
}

export interface VerseParticipantSummary extends Omit<VerseResult, 'participantId' | 'nickname' | 'percentage' | 'perfect' | 'place'> {
  id: string; nickname: string; joinedAt: number
}

export interface VerseHostView {
  roomId: string; hostUid: string; workspaceId: string; title: string; environment: 'development'
  phase: VersePhase; version: number; createdAt: number; startedAt?: number | null; completedAt?: number | null
  closedAt?: number | null; endedEarly: boolean
  config: { packId: string; difficulty: VerseDifficulty; cardsPerPlayer: 5 | 7 | 10; direction: VerseDirection }
  pack: { packId: string; version: number; title: string; translation: string }
  capacity: { available: number; required: number; maxPlayers: number; maxRounds: number }
  participants: VerseParticipantSummary[]; currentRound: VerseRound | null; roundNumber: number
  remainingCards: number; history: Array<VerseRound & { answeredByName?: string | null }>; results: VerseResult[] | null
}

export interface VerseCard {
  cardId: string; direction: VerseCardDirection; fragment: string; status: 'available' | 'correct' | 'error' | 'missed'
  fullText?: string; reference?: string
}

export interface VerseParticipantView {
  roomId: string; participantId: string; nickname: string; title: string; environment: 'development'
  phase: VersePhase; version: number; config: { cardsPerPlayer: number; direction: VerseDirection }
  currentRound: VerseRound | null; cards: VerseCard[]
  stats: { correct: number; errors: number; missed: number; remaining: number; total: number }
  result: VerseResult | null; endedEarly: boolean
}

export interface VerseAudienceView {
  roomId: string; title: string; environment: 'development'; phase: VersePhase; currentRound: VerseRound | null
  roundNumber: number; remainingCards: number; participantCount: number; completedRounds: number
  endedEarly: boolean; results: VerseResult[] | null
}

export interface VersePackValidation { valid: boolean; issues: Array<{ path: string; message: string }> }
