import { initializeApp } from 'firebase/app'
import { browserLocalPersistence, createUserWithEmailAndPassword, deleteUser, getAuth, onAuthStateChanged, setPersistence, signInAnonymously, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth'
import { get, getDatabase, onValue, push, ref, runTransaction, set, update } from 'firebase/database'
import { questions as builtInQuestions } from '../data/questions'
import { canUseFeature } from './access'
import type { Answer, ContentPack, Invite, LeaderProfile, Participant, ProductConfig, Question, ResponseValue, Session, SessionArchive, SessionPhase, TemplateSelection, TemplateSnapshot, UserStatus, Workspace, WorkspaceProduct } from '../types'

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
export const diagnosticProductId = 'youth-atmosphere'
export const diagnosticGameTypeId = 'diagnostic'
export const diagnosticPackId = 'youth-atmosphere-diagnostic'
export const diagnosticPackVersion = 1
export const defaultDiagnosticTemplateSelection: TemplateSelection = { selectedPackId: diagnosticPackId, templateSource: 'system' }
export const pilotPlanId = 'pilot-free'
export const pilotAccessSource = 'pilot' as const
const app = firebaseReady ? initializeApp(config) : null
const auth = app ? getAuth(app) : null
const db = app ? getDatabase(app) : null
let pendingAnonymousSignIn: Promise<NonNullable<typeof auth>['currentUser']> | null = null
const authPersistence = auth ? setPersistence(auth, browserLocalPersistence) : Promise.resolve()

export interface RegisterLeaderInput { fullName: string; phone: string; email: string; password: string; workspaceName: string; city: string; inviteCode?: string }

const copyQuestions = (questionSet: Question[]) => questionSet.map(question => ({ ...question, options: { ...question.options } }))
const copySettings = (settings: Record<string, boolean | number | string | null>) => ({ ...settings })

const createPilotWorkspaceAccess = (ownerUid: string, now: number): WorkspaceProduct => ({
  productId: diagnosticProductId,
  ownerUid,
  enabled: true,
  accessSource: pilotAccessSource,
  planId: pilotPlanId,
  startsAt: now,
  expiresAt: 0,
  testing: false,
})

export const createDiagnosticTemplateSnapshot = (questionSet: Question[] = builtInQuestions, source?: Partial<ContentPack>): TemplateSnapshot => ({
  productId: source?.productId || diagnosticProductId,
  gameTypeId: source?.gameTypeId || diagnosticGameTypeId,
  packId: source?.packId || diagnosticPackId,
  packVersion: source?.packVersion || diagnosticPackVersion,
  templateOrigin: source?.templateOrigin || 'system',
  title: source?.title || 'Диагностика атмосферы молодёжи',
  content: { questions: copyQuestions(source?.content?.questions?.length ? source.content.questions : questionSet) },
  settings: copySettings(source?.settings || { maxParticipants: 30, skippedAnswerScore: -1 }),
  ...(source?.workspaceId ? { workspaceId: source.workspaceId } : {}),
  capturedAt: Date.now(),
})

const normalizeContentPack = (value: unknown, fallbackQuestions: Question[], defaults: Partial<ContentPack>): ContentPack | null => {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<ContentPack> & { questions?: Question[] }
  const questionSet = raw.content?.questions || raw.questions
  if (!Array.isArray(questionSet) || !questionSet.length) return null
  return {
    productId: raw.productId || defaults.productId || diagnosticProductId,
    gameTypeId: raw.gameTypeId || defaults.gameTypeId || diagnosticGameTypeId,
    packId: raw.packId || defaults.packId || diagnosticPackId,
    packVersion: raw.packVersion || defaults.packVersion || diagnosticPackVersion,
    templateOrigin: raw.templateOrigin || defaults.templateOrigin || 'system',
    title: raw.title || defaults.title || 'Диагностика атмосферы молодёжи',
    content: { questions: copyQuestions(questionSet.length ? questionSet : fallbackQuestions) },
    settings: copySettings(raw.settings || defaults.settings || { maxParticipants: 30, skippedAnswerScore: -1 }),
    ...(raw.workspaceId || defaults.workspaceId ? { workspaceId: raw.workspaceId || defaults.workspaceId } : {}),
  }
}

/** Compatibility adapter for an explicitly selected source, with legacy fallbacks. */
export const resolveDiagnosticTemplate = async (workspaceId?: string, fallbackQuestions: Question[] = builtInQuestions, selection: TemplateSelection = defaultDiagnosticTemplateSelection): Promise<TemplateSnapshot> => {
  if (!db) return createDiagnosticTemplateSnapshot(fallbackQuestions)
  const fallback = fallbackQuestions.length ? fallbackQuestions : builtInQuestions
  const candidates: Array<{ path: string; defaults: Partial<ContentPack> }> = selection.templateSource === 'workspace' && workspaceId
    ? [{ path: `workspacePacks/${workspaceId}/${selection.selectedPackId}`, defaults: { workspaceId, packId: selection.selectedPackId, templateOrigin: 'workspace' } }]
    : [{ path: `globalPacks/${selection.selectedPackId}`, defaults: { packId: selection.selectedPackId, templateOrigin: 'system' } }]
  for (const candidate of candidates) {
    try {
      const snapshot = await get(ref(db, candidate.path))
      const pack = normalizeContentPack(snapshot.val(), fallback, candidate.defaults)
      if (pack) return createDiagnosticTemplateSnapshot(fallback, pack)
    } catch {
      // Newly introduced pack paths may not be published in Firebase Rules yet.
      // Continue to the legacy source rather than blocking room creation.
    }
  }
  try {
    const legacy = await get(ref(db, 'questionBank'))
    const legacyQuestions = legacy.val()
    if (Array.isArray(legacyQuestions) && legacyQuestions.length) return createDiagnosticTemplateSnapshot(legacyQuestions as Question[])
  } catch {
    // Offline/demo resilience: the bundled diagnostic remains the final fallback.
  }
  return createDiagnosticTemplateSnapshot(fallback)
}

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
  let active = true
  let unsubscribe: () => void = () => undefined
  void authPersistence.then(() => {
    if (active) unsubscribe = onAuthStateChanged(auth, callback)
  }).catch(() => { if (active) callback(null) })
  return () => { active = false; unsubscribe() }
}

export const waitForAuthPersistence = async () => {
  await authPersistence
  return auth?.currentUser || null
}

export const subscribeLeaderProfile = (uid: string, callback: (value: LeaderProfile | null) => void, onError?: (error: Error) => void) => {
  if (!db) { callback(null); return () => undefined }
  return onValue(ref(db, `users/${uid}`), snapshot => callback((snapshot.val() || null) as LeaderProfile | null), error => onError?.(error))
}

export const subscribeWorkspace = (workspaceId: string, callback: (value: Workspace | null) => void, onError?: (error: Error) => void) => {
  if (!db) { callback(null); return () => undefined }
  return onValue(ref(db, `workspaces/${workspaceId}`), snapshot => callback((snapshot.val() || null) as Workspace | null), error => onError?.(error))
}

export const subscribeWorkspaceProduct = (workspaceId: string, productId: string, callback: (value: WorkspaceProduct | null) => void, onError?: (error: Error) => void) => {
  if (!db) { callback(null); return () => undefined }
  return onValue(ref(db, `workspaceProducts/${workspaceId}/${productId}`), snapshot => callback((snapshot.val() || null) as WorkspaceProduct | null), error => onError?.(error))
}

export const subscribeProduct = (productId: string, callback: (value: ProductConfig | null) => void, onError?: (error: Error) => void) => {
  if (!db) { callback(null); return () => undefined }
  return onValue(ref(db, `products/${productId}`), snapshot => callback((snapshot.val() || null) as ProductConfig | null), error => onError?.(error))
}

export const registerLeader = async (input: RegisterLeaderInput) => {
  const services = requireFirebase()
  await authPersistence
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
    const workspace: Workspace = {
      id: workspaceId,
      name: input.workspaceName.trim(),
      city: input.city.trim(),
      ownerUid: user.uid,
      planId: pilotPlanId,
      billingStatus: 'pilot',
      accessEndsAt: 0,
      accessSource: pilotAccessSource,
      createdAt: now,
      updatedAt: now,
    }
    const productAccess = createPilotWorkspaceAccess(user.uid, now)
    await update(ref(services.db), {
      [`users/${user.uid}`]: profile,
      [`workspaces/${workspaceId}`]: workspace,
      [`workspaceProducts/${workspaceId}/${diagnosticProductId}`]: productAccess,
    })
    return profile
  } catch (error) {
    await deleteUser(user).catch(() => undefined)
    throw error
  }
}

export const loginLeader = async (email: string, password: string) => {
  const services = requireFirebase()
  await authPersistence
  return signInWithEmailAndPassword(services.auth, email.trim(), password)
}

export const logoutLeader = async () => {
  if (!auth) return
  await signOut(auth)
}

export const ensureAuth = async () => {
  if (!auth) return null
  await authPersistence
  if (auth.currentUser) return auth.currentUser
  if (!pendingAnonymousSignIn) pendingAnonymousSignIn = signInAnonymously(auth).then(result => result.user).finally(() => { pendingAnonymousSignIn = null })
  return pendingAnonymousSignIn
}

export const subscribeSession = (roomId: string, callback: (value: Session | null) => void, onError?: (error: Error) => void) => {
  if (!db) return () => undefined
  return onValue(ref(db, `sessions/${roomId}`), snapshot => callback(snapshot.val()), error => onError?.(error))
}

const assertRoomCreationAccess = async (hostUid: string, workspaceId: string) => {
  const services = requireFirebase()
  const [profileSnapshot, workspaceSnapshot, workspaceProductSnapshot, productSnapshot] = await Promise.all([
    get(ref(services.db, `users/${hostUid}`)),
    get(ref(services.db, `workspaces/${workspaceId}`)),
    get(ref(services.db, `workspaceProducts/${workspaceId}/${diagnosticProductId}`)),
    get(ref(services.db, `products/${diagnosticProductId}`)),
  ])
  const decision = canUseFeature(diagnosticProductId, 'create_room', {
    profile: profileSnapshot.val() as LeaderProfile | null,
    workspace: workspaceSnapshot.val() as Workspace | null,
    workspaceProduct: workspaceProductSnapshot.val() as WorkspaceProduct | null,
    product: productSnapshot.val() as ProductConfig | null,
  })
  if (!decision.allowed) throw new Error(decision.reason || 'Создание комнаты недоступно.')
}

export const createSessionRecord = (roomId: string, hostUid: string, questionSet: Question[] = builtInQuestions, workspaceId?: string, templateSnapshot?: TemplateSnapshot, templateSelection?: TemplateSelection): Session => {
  const template = templateSnapshot || createDiagnosticTemplateSnapshot(questionSet)
  const selection = templateSelection || { selectedPackId: template.packId, templateSource: template.templateOrigin }
  return {
    roomId,
    createdAt: Date.now(),
    phase: 'lobby',
    maxParticipants: 30,
    hostUid,
    ...(workspaceId ? { workspaceId } : {}),
    selectedPackId: selection.selectedPackId,
    templateSource: selection.templateSource,
    productId: template.productId,
    gameTypeId: template.gameTypeId,
    packId: template.packId,
    packVersion: template.packVersion,
    templateOrigin: template.templateOrigin,
    templateSnapshot: template,
    questions: copyQuestions(template.content.questions),
    participants: {},
  }
}

export const createSession = async (roomId: string, hostUid: string, questionSet?: Question[], workspaceId?: string, templateSelection: TemplateSelection = defaultDiagnosticTemplateSelection) => {
  if (!db) throw new Error('Firebase не настроен')
  if (!workspaceId) throw new Error('Для создания комнаты нужно рабочее пространство.')
  await assertRoomCreationAccess(hostUid, workspaceId)
  const template = await resolveDiagnosticTemplate(workspaceId, questionSet?.length ? questionSet : builtInQuestions, templateSelection)
  const session = createSessionRecord(roomId, hostUid, questionSet, workspaceId, template, templateSelection)
  await set(ref(db, `sessions/${roomId}`), session)
  return session
}

export const joinSession = async (roomId: string, participant: Participant) => {
  const services = requireFirebase()
  await authPersistence
  if (!services.auth.currentUser) throw new Error('Firebase user is not ready.')
  if (services.auth.currentUser.uid !== participant.id) throw new Error('Participant identity does not match the current Firebase user.')
  const sessionSnapshot = await get(ref(services.db, `sessions/${roomId}`))
  const session = sessionSnapshot.val() as Session | null
  if (!session) throw new Error('Комната не найдена или больше недоступна.')
  if (session.phase === 'closed') throw new Error('Сессия завершена ведущим. Подключение больше недоступно.')
  const result = await runTransaction(ref(services.db, `sessions/${roomId}/participants`), current => {
    const participants = current ?? {}
    if (participants[participant.id]) return participants
    if (Object.keys(participants).length >= 30) return
    return { ...participants, [participant.id]: participant }
  })
  if (!result.committed || !result.snapshot.child(participant.id).exists()) throw new Error('Комната недоступна или уже заполнена')
}

const assertCurrentUserIsRoomHost = async (roomId: string, expectedHostUid?: string) => {
  const services = requireFirebase()
  const user = services.auth.currentUser
  if (!user || user.isAnonymous) throw new Error('Для управления комнатой войдите в аккаунт ведущего.')
  const snapshot = await get(ref(services.db, `sessions/${roomId}`))
  const session = snapshot.val() as Session | null
  if (!session) throw new Error('Комната не найдена.')
  if (expectedHostUid && session.hostUid !== expectedHostUid) throw new Error('Комната была изменена другим ведущим. Обновите страницу.')
  if (session.hostUid !== user.uid) throw new Error('Только ведущий этой комнаты может изменить её состояние.')
  return { db: services.db, session }
}

export const updatePhase = async (roomId: string, phase: SessionPhase, expectedHostUid?: string) => {
  const services = await assertCurrentUserIsRoomHost(roomId, expectedHostUid)
  if (services.session.phase === 'closed' && phase !== 'closed') throw new Error('Завершённую сессию нельзя запустить повторно.')
  await update(ref(services.db, `sessions/${roomId}`), phase === 'resultsIntro' ? { phase, resultsIntroStartedAt: Date.now() } : phase === 'closed' ? { phase: 'closed', closedAt: Date.now() } : { phase })
}

/** Writes only an archive. The caller must close the live session first. */
export const archiveSession = async (session: Session) => {
  const services = await assertCurrentUserIsRoomHost(session.roomId, session.hostUid)
  if (services.session.phase !== 'closed') throw new Error('Сначала завершите сессию, затем создавайте архив.')
  const archived: SessionArchive = {
    ...services.session,
    phase: 'closed',
    closedAt: services.session.closedAt || session.closedAt || Date.now(),
    archivedAt: Date.now(),
  }
  await set(ref(services.db, `sessionArchives/${session.roomId}`), archived)
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
  const services = requireFirebase()
  await authPersistence
  const currentUser = services.auth.currentUser
  if (!currentUser || currentUser.uid !== participant.id) throw new Error('Participant identity does not match the current Firebase user.')
  const sessionSnapshot = await get(ref(services.db, `sessions/${roomId}`))
  const session = sessionSnapshot.val() as Session | null
  if (!session) throw new Error('Комната больше недоступна.')
  if (session.phase !== 'live') throw new Error(session.phase === 'closed' ? 'Сессия завершена ведущим. Ответы больше не принимаются.' : 'Диагностика ещё не запущена.')
  const storedParticipant = session.participants?.[participant.id]
  if (!storedParticipant) throw new Error('Участник не найден в комнате. Подключитесь заново.')
  if (storedParticipant.id !== currentUser.uid) throw new Error('Participant record does not belong to the current Firebase user.')
  const finished = nextIndex >= totalQuestions
  const next: Participant = {
    ...storedParticipant,
    answers: { ...storedParticipant.answers, [questionId]: answer }, currentQuestionIndex: nextIndex,
    status: finished ? 'finished' : 'answering', ...(finished ? { completedAt: Date.now() } : {})
  }
  await update(ref(services.db, `sessions/${roomId}/participants/${participant.id}`), {
    answers: next.answers, currentQuestionIndex: next.currentQuestionIndex,
    status: next.status, ...(next.completedAt ? { completedAt: next.completedAt } : {})
  })
  return next
}

export const markPersonalViewed = async (roomId: string, participantId: string) => {
  const services = requireFirebase()
  await authPersistence
  if (!services.auth.currentUser || services.auth.currentUser.uid !== participantId) throw new Error('Participant identity does not match the current Firebase user.')
  await update(ref(services.db, `sessions/${roomId}/participants/${participantId}`), { personalViewedAt: Date.now() })
}
