import type { Question, ResponseValue } from '../types'

export interface ParticipantQuestionScreenProps {
  question: Question
  currentIndex: number
  total: number
  packTitle?: string
  saving: boolean
  notice: string
  selectedAnswer?: ResponseValue | null
  retryable?: boolean
  onAnswer: (value: ResponseValue) => void
  onRetry?: () => void
}
