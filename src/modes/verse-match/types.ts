export type VerseDifficulty = 'easy' | 'medium' | 'hard'
export type VerseDifficultySelection = VerseDifficulty | 'mixed' | 'all'
export type VerseDirection = 'starts' | 'ends' | 'mixed'
export type VerseCardDirection = 'start' | 'end'
export type VersePhase = 'lobby' | 'live' | 'completed' | 'closed'

export interface VerseEntry {
  id: string; bookId: string; book: string; chapter: number; verse: string; reference: string
  translationId?: string; translation: string; contentVersion?: string; fullText: string; start: string; end: string
  difficulty: VerseDifficulty; enabled: boolean; verificationStatus: 'draft' | 'verified' | 'rejected'
  exclusionReason?: string
}

export interface VersePack {
  packId: string; version: number; schemaVersion?: number; title: string; description: string; bookId?: string; translationId?: string; translation: string
  sourceUrl: string; sourceEdition?: string; license: string; contentVersion?: string; status: 'draft' | 'published' | 'archived'; official?: boolean; editorialMethod?: string; entries: VerseEntry[]
  unavailableEntries?: Array<{ id: string; reference: string; reason: string }>
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
  config: { packId: string; bookId?: string; translationId?: string; difficulty: VerseDifficultySelection; difficultyMix?: VerseDifficulty[]; cardsPerPlayer: 5 | 7 | 10; direction: VerseDirection }
  pack: { packId: string; version: number; title: string; bookId?: string; translationId?: string; translation: string }
  capacity: { available: number; required: number; maxPlayers: number; maxRounds: number }
  participants: VerseParticipantSummary[]; currentRound: VerseRound | null; roundNumber: number
  remainingCards: number; history: Array<VerseRound & { answeredByName?: string | null }>; results: VerseResult[] | null
}

export interface VerseCard {
  cardId: string; direction: VerseCardDirection; fragment: string; status: 'available' | 'correct' | 'error' | 'missed'
  fullText?: string; reference?: string; attemptPromptText?: string; attemptPromptDirection?: VerseCardDirection
}

export interface VerseParticipantView {
  roomId: string; participantId: string; nickname: string; title: string; environment: 'development'
  phase: VersePhase; version: number; config: { cardsPerPlayer: number; direction: VerseDirection }; pack?: { title: string; translation: string; translationId?: string }
  currentRound: VerseRound | null; cards: VerseCard[]
  stats: { correct: number; errors: number; missed: number; remaining: number; total: number }
  result: VerseResult | null; endedEarly: boolean
}

export interface VerseAudienceView {
  roomId: string; title: string; environment: 'development'; phase: VersePhase; currentRound: VerseRound | null
  roundNumber: number; remainingCards: number; participantCount: number; completedRounds: number
  endedEarly: boolean; results: VerseResult[] | null
  pack?: { title: string; translation: string; translationId?: string }
}

export interface VerseTranslationCatalogItem { translationId: string; title: string; status: 'available' | 'license-required'; packId: string | null; sourceUrl: string; sourceEdition: string; license: string }
export interface VerseBookCatalogItem { bookId: string; title: string; translations: VerseTranslationCatalogItem[] }
export interface VerseCatalog { schemaVersion: number; books: VerseBookCatalogItem[] }
export interface VerseProgress { bookId: string; unlocked: Record<VerseDifficultySelection, boolean>; completedRoomIds: Record<string, { difficulty: VerseDifficulty; completedAt: number }>; updatedAt: number }
export interface VerseLibrary { system: VersePack[]; workspace: VersePack[]; archives: VerseHostView[]; catalog: VerseCatalog; progress: Record<string, VerseProgress> }

export interface VersePackValidation { valid: boolean; issues: Array<{ path: string; message: string }> }
