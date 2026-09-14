import { signInAnonymously } from 'firebase/auth'
import { onValue, ref } from 'firebase/database'
import { httpsCallable } from 'firebase/functions'
import { firebaseAuth, firebaseAuthPersistence, firebaseDb, firebaseFunctions } from '../../repositories/firebaseClient'
import type { VerseAudienceView, VerseHostView, VersePack, VerseParticipantView } from './types'

const services = () => {
  if (!firebaseAuth || !firebaseDb || !firebaseFunctions) throw new Error('Firebase не настроен для preview-среды.')
  return { auth: firebaseAuth, db: firebaseDb, functions: firebaseFunctions }
}
const message = (error: unknown) => error instanceof Error ? error.message.replace(/^Firebase:\s*/, '') : 'Операция не выполнена.'
const call = async <T>(name: string, data: unknown = {}) => {
  try { return (await httpsCallable<unknown, T>(services().functions, name)(data)).data } catch (error) { throw new Error(message(error)) }
}

export const getVerseMatchLibrary = () => call<{ system: VersePack[]; workspace: VersePack[]; archives: VerseHostView[] }>('getVerseMatchLibrary')
export const saveVerseMatchPack = (scope: 'system' | 'workspace', pack: VersePack) => call<{ pack: VersePack }>('saveVerseMatchPack', { scope, pack })
export const copyVerseMatchPack = (packId: string) => call<{ pack: VersePack; reused: boolean }>('copyVerseMatchPack', { packId })
export const deleteVerseMatchPack = (packId: string) => call<{ deleted: boolean }>('deleteVerseMatchPack', { packId })
export const createVerseMatchRoom = (input: { title: string; packId: string; difficulty: string; cardsPerPlayer: number; direction: string }) => call<{ roomId: string }>('createVerseMatchRoom', input)
export const joinVerseMatchRoom = (roomId: string, nickname: string) => call<{ participantId: string; reused: boolean }>('joinVerseMatchRoom', { roomId, nickname })
export const startVerseMatchGame = (roomId: string) => call('startVerseMatchGame', { roomId })
export const submitVerseMatchCard = (roomId: string, cardId: string, roundId: string, roundVersion: number) => call<{ accepted: boolean; correct: boolean }>('submitVerseMatchCard', { roomId, cardId, roundId, roundVersion })
export const revealVerseMatchAnswer = (roomId: string) => call('revealVerseMatchAnswer', { roomId })
export const nextVerseMatchRound = (roomId: string) => call('nextVerseMatchRound', { roomId })
export const finishVerseMatchGame = (roomId: string, early: boolean) => call('finishVerseMatchGame', { roomId, early })

export const prepareVerseParticipantAuth = async () => {
  const { auth } = services(); await firebaseAuthPersistence
  if (auth.currentUser?.isAnonymous) return auth.currentUser.uid
  if (auth.currentUser) throw new Error('Для участия откройте ссылку в режиме инкогнито или другом браузере.')
  return (await signInAnonymously(auth)).user.uid
}

const subscribe = <T>(path: string, callback: (value: T | null) => void, onError?: (error: Error) => void) => {
  const { db } = services()
  return onValue(ref(db, path), snapshot => callback((snapshot.val() || null) as T | null), error => onError?.(error))
}
const list = <T>(value: T[] | Record<string, T> | null | undefined): T[] => Array.isArray(value) ? value : value && typeof value === 'object' ? Object.values(value) : []
export const normalizeVerseHostView = (value: VerseHostView): VerseHostView => ({ ...value, participants: list(value.participants), history: list(value.history), results: value.results == null ? null : list(value.results), currentRound: value.currentRound || null })
export const normalizeVerseParticipantView = (value: VerseParticipantView): VerseParticipantView => ({ ...value, cards: list(value.cards), result: value.result || null, currentRound: value.currentRound || null })
export const normalizeVerseAudienceView = (value: VerseAudienceView): VerseAudienceView => ({ ...value, results: value.results == null ? null : list(value.results), currentRound: value.currentRound || null })
export const subscribeVerseHost = (roomId: string, callback: (value: VerseHostView | null) => void, onError?: (error: Error) => void) => subscribe<VerseHostView>(`verseMatchHostViews/${roomId}`, value => callback(value ? normalizeVerseHostView(value) : null), onError)
export const subscribeVerseParticipant = (roomId: string, participantId: string, callback: (value: VerseParticipantView | null) => void, onError?: (error: Error) => void) => subscribe<VerseParticipantView>(`verseMatchParticipantViews/${roomId}/${participantId}`, value => callback(value ? normalizeVerseParticipantView(value) : null), onError)
export const subscribeVerseAudience = (roomId: string, callback: (value: VerseAudienceView | null) => void, onError?: (error: Error) => void) => subscribe<VerseAudienceView>(`verseMatchPublicViews/${roomId}`, value => callback(value ? normalizeVerseAudienceView(value) : null), onError)
