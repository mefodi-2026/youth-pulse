import { initializeApp } from 'firebase/app'
import { createUserWithEmailAndPassword, deleteUser, getAuth, onAuthStateChanged, signInAnonymously, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth'
import { get, getDatabase, onValue, push, ref, runTransaction, set, update } from 'firebase/database'
import type { Answer, Invite, LeaderProfile, Participant, Question, ResponseValue, Session, SessionArchive, SessionPhase, UserStatus, Workspace } from '../types'

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

export interface RegisterLeaderInput { fullName: string; phone: string; email: string; password: string; workspaceName: string; city: string; inviteCode?: string }

const requireFirebase = () => {
  if (!auth || !db) throw new Error('Firebase не настроен')
  return { auth, db }
}

const inviteStatus = async (inviteCode?: string): Promise<UserStatus> => {
  if (!inviteCode || !db) return 'pending'
  const snapshot = await get(ref(db, `invites/${inviteCode}`))
  const invite = snapshot.val() as Invite | null
  if (!invite || invite.status !== 'active') return 'pending'
  if (invite.expiresAt && invite.expiresAt <= Date.now()) return 'pending'
  return 'active'
}

export const subscribeAuthUser = (callback: (user: User | null) => void) => {
  if (!auth) { callback(null); return () => undefined }
  return onAuthStateChanged(auth, callback)
}

export const subscribeLeaderProfile = (uid: string, callback: (value: LeaderProfile | null) => void, onError?: (error: Error) => void) => {
  if (!db) { callback(null); return () => undefined }
  return onValue(ref(db, `users/${uid}`), snapshot => callback((snapshot.val() || null) as LeaderProfile | null), error => onError?.(error))
}

export const subscribeWorkspace = (workspaceId: string, callback: (value: Workspace | null) => void, onError?: (error: Error) => void) => {
  if (!db) { callback(null); return () => undefined }
  return onValue(ref(db, `workspaces/${workspaceId}`), snapshot => callback((snapshot.val() || null) as Workspace | null), error => onError?.(error))
}

export const registerLeader = async (input: RegisterLeaderInput) => {
  const services = requireFirebase()
  const credential = await createUserWithEmailAndPassword(services.auth, input.email.trim(), input.password)
  const { user } = credential
  const now = Date.now()
  const cleanInviteCode = input.inviteCode?.trim().toUpperCase() || undefined
  try {
    const status = await inviteStatus(cleanInviteCode)
    const workspaceId = push(ref(services.db, 'workspaces')).key
    if (!workspaceId) throw new Error('Не удалось создать рабочее пространство')
    const profile: LeaderProfile = {
      uid: user.uid,
      fullName: input.fullName.trim(),
      phone: input.phone.trim(),
      email: user.email || input.email.trim(),
      workspaceId,
      status,
      ...(cleanInviteCode ? { inviteCode: cleanInviteCode } : {}),
      createdAt: now,
      updatedAt: now,
    }
    const workspace: Workspace = { id: workspaceId, name: input.workspaceName.trim(), city: input.city.trim(), ownerUid: user.uid, createdAt: now, updatedAt: now }
    await update(ref(services.db), { [`users/${user.uid}`]: profile, [`workspaces/${workspaceId}`]: workspace })
    return profile
  } catch (error) {
    await deleteUser(user).catch(() => undefined)
    throw error
  }
}

export const loginLeader = async (email: string, password: string) => {
  const services = requireFirebase()
  return signInWithEmailAndPassword(services.auth, email.trim(), password)
}

export const logoutLeader = async () => {
  if (!auth) return
  await signOut(auth)
}

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

export const createSession = async (roomId: string, hostUid: string, questionSet?: Question[], workspaceId?: string) => {
  if (!db) throw new Error('Firebase не настроен')
  const session: Session = { roomId, createdAt: Date.now(), phase: 'lobby', maxParticipants: 30, hostUid, ...(workspaceId ? { workspaceId } : {}), questions: questionSet, participants: {} }
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
  await update(ref(db, `sessions/${roomId}`), phase === 'resultsIntro' ? { phase, resultsIntroStartedAt: Date.now() } : phase === 'closed' ? { phase, closedAt: Date.now() } : { phase })
}

export const archiveSession = async (session: Session) => {
  if (!db) throw new Error('Firebase is not configured')
  const user = await ensureAuth()
  if (!user) throw new Error('Не удалось войти в Firebase для завершения сессии')
  const archived: SessionArchive = { ...session, phase: 'closed', closedAt: session.closedAt || Date.now(), archivedAt: Date.now() }
  await update(ref(db, `sessions/${session.roomId}`), { phase: 'closed', closedAt: archived.closedAt })
  try {
    await set(ref(db, `sessionArchives/${session.roomId}`), archived)
  } catch (error) {
    console.warn('Архив комнаты пока не сохранён. Опубликуйте правила Firebase.', error)
  }
  return archived
}

export const subscribeSessionArchives = (callback: (value: Record<string, SessionArchive>) => void, onError?: (error: Error) => void) => {
  if (!db) return () => undefined
  return onValue(ref(db, 'sessionArchives'), snapshot => callback((snapshot.val() || {}) as Record<string, SessionArchive>), error => onError?.(error))
}

export const saveQuestionBank = async (questionSet: Question[]) => {
  if (!db) throw new Error('Firebase is not configured')
  const user = await ensureAuth()
  if (!user) throw new Error('Не удалось войти в Firebase для сохранения вопросов')
  await set(ref(db, 'questionBank'), questionSet)
}

export const saveSessionQuestions = async (roomId: string, questionSet: Question[]) => {
  if (!db) throw new Error('Firebase is not configured')
  const user = await ensureAuth()
  if (!user) throw new Error('Не удалось войти в Firebase для сохранения вопросов комнаты')
  await update(ref(db, `sessions/${roomId}`), { questions: questionSet })
}

export const subscribeQuestionBank = (callback: (value: Question[] | null) => void, onError?: (error: Error) => void) => {
  if (!db) return () => undefined
  return onValue(ref(db, 'questionBank'), snapshot => callback((snapshot.val() || null) as Question[] | null), error => onError?.(error))
}

export const saveAnswer = async (roomId: string, participant: Participant, questionId: string, answer: ResponseValue, nextIndex: number, totalQuestions = 16) => {
  if (!db) throw new Error('Firebase не настроен')
  const finished = nextIndex >= totalQuestions
  await update(ref(db, `sessions/${roomId}/participants/${participant.id}`), {
    answers: { ...participant.answers, [questionId]: answer }, currentQuestionIndex: nextIndex,
    status: finished ? 'finished' : 'answering', ...(finished ? { completedAt: Date.now() } : {})
  })
}

export const markPersonalViewed = async (roomId: string, participantId: string) => {
  if (!db) throw new Error('Firebase не настроен')
  await update(ref(db, `sessions/${roomId}/participants/${participantId}`), { personalViewedAt: Date.now() })
}

