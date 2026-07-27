import { initializeApp } from 'firebase/app'
import { getAuth, signInAnonymously } from 'firebase/auth'
import { getDatabase, onValue, ref, runTransaction, set, update } from 'firebase/database'
import type { Answer, Participant, Session, SessionPhase } from '../types'

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

export const firebaseReady = Boolean(config.apiKey && config.databaseURL && config.projectId)
const app = firebaseReady ? initializeApp(config) : null
const auth = app ? getAuth(app) : null
const db = app ? getDatabase(app) : null
let pendingAnonymousSignIn: Promise<NonNullable<typeof auth>['currentUser']> | null = null

export const ensureAuth = async () => {
  if (!auth) return null
  if (auth.currentUser) return auth.currentUser
  if (!pendingAnonymousSignIn) pendingAnonymousSignIn = signInAnonymously(auth).then(result => result.user).finally(() => { pendingAnonymousSignIn = null })
  return pendingAnonymousSignIn
}

export const subscribeSession = (roomId: string, callback: (value: Session | null) => void, onError?: (error: Error) => void) => {
  if (!db) return () => undefined
  return onValue(ref(db, `sessions/${roomId}`), snapshot => callback(snapshot.val()), error => onError?.(error))
}

export const createSession = async (roomId: string, hostUid: string) => {
  if (!db) throw new Error('Firebase не настроен')
  const session: Session = { roomId, createdAt: Date.now(), phase: 'lobby', maxParticipants: 30, hostUid, participants: {} }
  await set(ref(db, `sessions/${roomId}`), session)
  return session
}

export const joinSession = async (roomId: string, participant: Participant) => {
  if (!db) throw new Error('Firebase не настроен')
  const result = await runTransaction(ref(db, `sessions/${roomId}/participants`), current => {
    const participants = current ?? {}
    if (participants[participant.id]) return participants
    if (Object.keys(participants).length >= 30) return
    return { ...participants, [participant.id]: participant }
  })
  if (!result.committed || !result.snapshot.child(participant.id).exists()) throw new Error('Комната недоступна или уже заполнена')
}

export const updatePhase = async (roomId: string, phase: SessionPhase) => {
  if (!db) throw new Error('Firebase не настроен')
  await update(ref(db, `sessions/${roomId}`), phase === 'resultsIntro' ? { phase, resultsIntroStartedAt: Date.now() } : { phase })
}

export const saveAnswer = async (roomId: string, participant: Participant, questionId: string, answer: Answer, nextIndex: number) => {
  if (!db) throw new Error('Firebase не настроен')
  const finished = nextIndex >= 16
  await update(ref(db, `sessions/${roomId}/participants/${participant.id}`), {
    answers: { ...participant.answers, [questionId]: answer }, currentQuestionIndex: nextIndex,
    status: finished ? 'finished' : 'answering', ...(finished ? { completedAt: Date.now() } : {})
  })
}

export const markPersonalViewed = async (roomId: string, participantId: string) => {
  if (!db) throw new Error('Firebase не настроен')
  await update(ref(db, `sessions/${roomId}/participants/${participantId}`), { personalViewedAt: Date.now() })
}
