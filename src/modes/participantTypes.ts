import type { Question, ResponseValue } from '../types'

export interface ParticipantQuestionScreenProps {
  question: Question
  currentIndex: number
  total: number
  packTitle?: string
  saving: boolean
  notice: string
  onAnswer: (value: ResponseValue) => void
}
