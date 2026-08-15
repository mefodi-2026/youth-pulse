import { initializeApp } from 'firebase/app'
import { browserLocalPersistence, createUserWithEmailAndPassword, deleteUser, getAuth, onAuthStateChanged, setPersistence, signInAnonymously, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth'
import { equalTo, get, getDatabase, onValue, orderByChild, push, query, ref, set, update } from 'firebase/database'
import { questions as builtInQuestions } from '../data/questions'
import { bibleQuizStarterPacks } from '../data/bibleQuizPacks'
import { canUseFeature } from './access'
import { bibleQuizGameModule, diagnosticGameModule, getGameModule } from './gameRegistry'
import { getScoringTemplate } from './scoring'
import { orderQuestionsByCategory } from './questionOrder'
import { participantQuestionsPath, participantResultPath, privateQuestionsPath, publicRoomPath, roomParticipantPath, roomPath } from '../core/roomService'
import { getSessionQuestions, type Answer, type ContentPack, type FeedbackItem, type Invite, type LeaderProfile, type Participant, type ParticipantQuestion, type ParticipantQuestionSet, type ParticipantQuizResult, type PrivateQuestionSet, type ProductConfig, type PublicRoom, type Question, type ResponseValue, type RoomLobby, type RoomMode, type ScoringTemplateId, type Session, type SessionArchive, type SessionEvent, type SessionEventType, type SessionPhase, type TemplateSelection, type TemplateSnapshot, type UserStatus, type Workspace, type WorkspaceProduct } from '../types'

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
export const diagnosticProductId = diagnosticGameModule.productId
export const diagnosticGameTypeId = diagnosticGameModule.gameTypeId
export const quizProductId = bibleQuizGameModule.productId
export const quizGameTypeId = bibleQuizGameModule.gameTypeId
export const diagnosticPackId = 'youth-atmosphere-diagnostic'
export const diagnosticPackVersion = 1
export const defaultDiagnosticTemplateSelection: TemplateSelection = { selectedPackId: diagnosticPackId, templateSource: 'system' }
export const pilotPlanId = 'pilot-free'
export const pilotAccessSource = 'pilot' as const

/**
 * A stable catalogue used by the owner UI. Values in `products/{productId}`
 * override these defaults after the owner explicitly publishes a setting.
 */
export const platformProductDefaults: Record<string, ProductConfig> = {
  [diagnosticProductId]: {
    productId: diagnosticProductId,
    name: 'Диагностика атмосферы',
    description: 'Интерактивная диагностика для молодёжных групп.',
    type: 'diagnostic',
    status: 'enabled',
    version: 1,
    maintenanceMessage: '',
    updatedAt: 0,
  },
  'bible-quiz': {
    productId: 'bible-quiz',
    name: 'Библейская викторина',
    description: 'Будущий игровой модуль для командных викторин.',
    type: 'quiz',
    status: 'enabled',
    version: 1,
    maintenanceMessage: 'Викторина пока находится в разработке.',
    updatedAt: 0,
  },
}
const app = firebaseReady ? initializeApp(config) : null
const auth = app ? getAuth(app) : null
const db = app ? getDatabase(app) : null
let pendingAnonymousSignIn: Promise<NonNullable<typeof auth>['currentUser']> | null = null
const authPersistence = auth ? setPersistence(auth, browserLocalPersistence) : Promise.resolve()

export interface RegisterLeaderInput { fullName: string; phone: string; email: string; password: string; workspaceName: string; city: string; inviteCode?: string }
export interface RoomPilotDetails {
  groupName: string
  city: string
  mode: RoomMode
  estimatedParticipants: number
}

const copyQuestions = (questionSet: Question[]) => questionSet.map(question => ({ ...question, options: { ...question.options } }))
const copySettings = (settings: Record<string, boolean | number | string | null>) => ({ ...settings })
const systemDiagnosticPackTitle = 'Диагностика атмосферы молодёжи'
const normalizePackTitle = (title: unknown) => {
  const value = typeof title === 'string' ? title.trim() : ''
  return value && !/^\?+$/.test(value) ? value : systemDiagnosticPackTitle
}
const defaultPackDescription = 'Интерактивная диагностика для молодёжных групп.'
const normalizePackStatus = (status: unknown): ContentPack['status'] => status === 'draft' || status === 'archived' ? status : 'published'

/** Safe metadata for a participant: no host UID, workspace ID, answers or settings. */
const createPublicRoom = (session: Session): PublicRoom => ({
  roomId: session.roomId,
  ...(session.roomTitle ? { roomTitle: session.roomTitle } : {}),
  ...(session.displayCode ? { displayCode: session.displayCode } : {}),
  phase: session.phase,
  maxParticipants: session.maxParticipants,
  createdAt: session.createdAt,
  ...(session.closedAt ? { closedAt: session.closedAt } : {}),
  ...(session.mode ? { mode: session.mode } : {}),
  ...(session.productId ? { productId: session.productId } : {}),
  ...(session.gameTypeId ? { gameTypeId: session.gameTypeId } : {}),
  ...(session.packId ? { packId: session.packId } : {}),
  ...(session.packSnapshot?.title ? { packTitle: session.packSnapshot.title } : {}),
  ...(session.difficulty ? { difficulty: session.difficulty } : {}),
  ...(session.scoringTemplateId ? { scoringTemplateId: session.scoringTemplateId } : {}),
})

const toParticipantQuestion = (question: Question): ParticipantQuestion => ({
  id: question.id,
  category: question.category,
  ...(question.categoryOrder !== undefined ? { categoryOrder: question.categoryOrder } : {}),
  title: question.title,
  options: { ...question.options },
})

const createParticipantQuestionSet = (session: Session): ParticipantQuestionSet => {
  const questionSet = getSessionQuestions(session, builtInQuestions)
  return {
    roomId: session.roomId,
    createdAt: session.createdAt,
    ...(session.mode ? { mode: session.mode } : {}),
    ...(session.productId ? { productId: session.productId } : {}),
    ...(session.gameTypeId ? { gameTypeId: session.gameTypeId } : {}),
    ...(session.packId ? { packId: session.packId } : {}),
    ...(session.packSnapshot?.title ? { packTitle: session.packSnapshot.title } : {}),
    ...(session.scoringTemplateId ? { scoringTemplateId: session.scoringTemplateId } : {}),
    questions: questionSet.map(toParticipantQuestion),
  }
}

const createPrivateQuestionSet = (session: Session): PrivateQuestionSet => ({
  roomId: session.roomId,
  createdAt: session.createdAt,
  questions: getSessionQuestions(session, builtInQuestions).map(question => ({
    id: question.id,
    ...(question.correctAnswer ? { correctAnswer: question.correctAnswer } : {}),
    ...(question.explanation ? { explanation: question.explanation } : {}),
  })),
})

const createPilotWorkspaceAccess = (productId: string, ownerUid: string, now: number): WorkspaceProduct => ({
  productId,
  ownerUid,
  enabled: true,
  accessSource: pilotAccessSource,
  plan: pilotPlanId,
  planId: pilotPlanId,
  startsAt: now,
  expiresAt: 0,
  testing: false,
})

export const createDiagnosticTemplateSnapshot = (questionSet: Question[] = builtInQuestions, source?: Partial<ContentPack>): TemplateSnapshot => ({
  productId: source?.productId || diagnosticProductId,
  gameTypeId: source?.gameTypeId || diagnosticGameTypeId,
  packId: source?.packId || diagnosticPackId,
  version: source?.version || source?.packVersion || diagnosticPackVersion,
  packVersion: source?.packVersion || source?.version || diagnosticPackVersion,
  status: normalizePackStatus(source?.status),
  sourcePackId: source?.sourcePackId || source?.packId || diagnosticPackId,
  templateOrigin: source?.templateOrigin || 'system',
  title: normalizePackTitle(source?.title),
  description: source?.description || defaultPackDescription,
  questions: copyQuestions(orderQuestionsByCategory(source?.questions?.length ? source.questions : source?.content?.questions?.length ? source.content.questions : questionSet)),
  content: { questions: copyQuestions(orderQuestionsByCategory(source?.questions?.length ? source.questions : source?.content?.questions?.length ? source.content.questions : questionSet)) },
  settings: copySettings(source?.settings || { maxParticipants: 30, skippedAnswerScore: -1 }),
  ruleConfig: getGameModule(source?.gameTypeId).normalizeRuleConfig(source?.ruleConfig),
  contentSchemaVersion: source?.contentSchemaVersion || getGameModule(source?.gameTypeId).contentSchemaVersion,
  ...(source?.workspaceId ? { workspaceId: source.workspaceId } : {}),
  ...(source?.updatedAt ? { updatedAt: source.updatedAt } : {}),
  capturedAt: Date.now(),
})

const normalizeContentPack = (value: unknown, _fallbackQuestions: Question[], defaults: Partial<ContentPack>): ContentPack | null => {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<ContentPack> & { questions?: Question[] }
  const questionSet = raw.questions || raw.content?.questions
  if (!Array.isArray(questionSet)) return null
  const isQuiz = raw.mode === 'quiz' || raw.gameTypeId === quizGameTypeId || raw.productId === quizProductId || defaults.mode === 'quiz'
  const orderedQuestions = copyQuestions(isQuiz ? questionSet : orderQuestionsByCategory(questionSet))
  return {
    productId: raw.productId || defaults.productId || (isQuiz ? quizProductId : diagnosticProductId),
    gameTypeId: raw.gameTypeId || defaults.gameTypeId || (isQuiz ? quizGameTypeId : diagnosticGameTypeId),
    ...(isQuiz ? { mode: 'quiz' as const, ...(raw.difficulty ? { difficulty: raw.difficulty } : {}) } : { mode: 'diagnostic' as const }),
    packId: raw.packId || defaults.packId || diagnosticPackId,
    version: raw.version || raw.packVersion || defaults.version || defaults.packVersion || diagnosticPackVersion,
    packVersion: raw.packVersion || raw.version || defaults.packVersion || defaults.version || diagnosticPackVersion,
    status: normalizePackStatus(raw.status || defaults.status),
    ...(raw.sourcePackId || defaults.sourcePackId ? { sourcePackId: raw.sourcePackId || defaults.sourcePackId } : {}),
    templateOrigin: raw.templateOrigin || defaults.templateOrigin || 'system',
    title: isQuiz ? (typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : defaults.title || 'Библейская викторина') : normalizePackTitle(raw.title || defaults.title),
    description: raw.description || defaults.description || defaultPackDescription,
    questions: orderedQuestions,
    content: { questions: orderedQuestions },
    settings: copySettings(raw.settings || defaults.settings || { maxParticipants: 30, skippedAnswerScore: -1 }),
    ruleConfig: getGameModule(raw.gameTypeId || defaults.gameTypeId).normalizeRuleConfig(raw.ruleConfig || defaults.ruleConfig),
    contentSchemaVersion: raw.contentSchemaVersion || defaults.contentSchemaVersion || getGameModule(raw.gameTypeId || defaults.gameTypeId).contentSchemaVersion,
    ...(raw.workspaceId || defaults.workspaceId ? { workspaceId: raw.workspaceId || defaults.workspaceId } : {}),
    ...(raw.createdAt || defaults.createdAt ? { createdAt: raw.createdAt || defaults.createdAt } : {}),
    ...(raw.updatedAt || defaults.updatedAt ? { updatedAt: raw.updatedAt || defaults.updatedAt } : {}),
    ...(raw.createdBy || defaults.createdBy ? { createdBy: raw.createdBy || defaults.createdBy } : {}),
    ...(raw.sourcePackVersion || defaults.sourcePackVersion ? { sourcePackVersion: raw.sourcePackVersion || defaults.sourcePackVersion } : {}),
    ...(raw.copiedBy || defaults.copiedBy ? { copiedBy: raw.copiedBy || defaults.copiedBy } : {}),
    ...(raw.copiedAt || defaults.copiedAt ? { copiedAt: raw.copiedAt || defaults.copiedAt } : {}),
  }
}

const createTemplateSnapshot = (source: ContentPack): TemplateSnapshot => {
  const module = getGameModule(source.gameTypeId)
  const isQuiz = source.mode === 'quiz' || source.gameTypeId === quizGameTypeId
  const questions = copyQuestions(isQuiz ? source.questions : orderQuestionsByCategory(source.questions))
  return {
    ...source,
    mode: isQuiz ? 'quiz' : 'diagnostic',
    questions,
    content: { questions: copyQuestions(questions) },
    settings: copySettings(source.settings),
    ruleConfig: module.normalizeRuleConfig(source.ruleConfig),
    capturedAt: Date.now(),
  }
}

/** Resolves the selected source for a new room. Legacy fallback is intentionally not used here. */
export const resolveDiagnosticTemplate = async (workspaceId?: string, selection: TemplateSelection = defaultDiagnosticTemplateSelection): Promise<TemplateSnapshot> => {
  if (!db) return createDiagnosticTemplateSnapshot(builtInQuestions)
  const candidates: Array<{ path: string; defaults: Partial<ContentPack> }> = selection.templateSource === 'workspace' && workspaceId
    ? [
        { path: `workspaces/${workspaceId}/workspacePacks/${selection.selectedPackId}`, defaults: { workspaceId, packId: selection.selectedPackId, templateOrigin: 'workspace' } },
        // Read-only migration fallback. New data is never written to this root.
        { path: `workspacePacks/${workspaceId}/${selection.selectedPackId}`, defaults: { workspaceId, packId: selection.selectedPackId, templateOrigin: 'workspace' } },
      ]
    : [{ path: `globalPacks/${selection.selectedPackId}`, defaults: { packId: selection.selectedPackId, templateOrigin: 'system' } }]
  for (const candidate of candidates) {
    try {
      const snapshot = await get(ref(db, candidate.path))
      const pack = normalizeContentPack(snapshot.val(), [], candidate.defaults)
      if (pack?.status === 'published') {
        if (!pack.questions.length) throw new Error('В выбранном наборе нет вопросов.')
        return createDiagnosticTemplateSnapshot(pack.questions, pack)
      }
    } catch {
      // The selected source is unavailable. Do not silently switch pack origins.
    }
  }
  throw new Error('Выбранный набор недоступен или не активен. Выберите другой набор и попробуйте ещё раз.')
}

/** Resolves any selected pack without silently switching sources or modes. */
export const resolveRoomTemplate = async (workspaceId: string | undefined, selection: TemplateSelection, mode: RoomMode): Promise<TemplateSnapshot> => {
  if (!db) {
    if (mode === 'quiz') throw new Error('Для викторины нужен опубликованный набор вопросов.')
    return createDiagnosticTemplateSnapshot(builtInQuestions)
  }
  // Diagnostics use the published system material directly. Quiz packs are
  // deliberately resolved from a leader-owned workspace copy. Keeping this
  // decision here prevents a stale UI selection from mixing the two modes.
  const effectiveSelection = mode === 'diagnostic' ? defaultDiagnosticTemplateSelection : selection
  const path = effectiveSelection.templateSource === 'workspace' && workspaceId
    ? `workspaces/${workspaceId}/workspacePacks/${effectiveSelection.selectedPackId}`
    : `globalPacks/${effectiveSelection.selectedPackId}`
  const snapshot = await get(ref(db, path))
  const pack = normalizeContentPack(snapshot.val(), [], { packId: effectiveSelection.selectedPackId, templateOrigin: effectiveSelection.templateSource, workspaceId, mode })
  if (!pack || pack.status !== 'published') throw new Error('Выбранный набор недоступен или не опубликован.')
  const actualMode = pack.mode || (pack.gameTypeId === quizGameTypeId ? 'quiz' : 'diagnostic')
  if (actualMode !== mode) throw new Error('Выбранный набор не соответствует формату комнаты.')
  if (!pack.questions.length) throw new Error('В выбранном наборе нет вопросов.')
  return createTemplateSnapshot(pack)
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

/** Platform access is determined only by a Firebase-issued Custom Claim. */
export const isPlatformOwner = async () => {
  await authPersistence
  const user = auth?.currentUser
  if (!user || user.isAnonymous) return false
  await user.getIdToken(true)
  const token = await user.getIdTokenResult(true)
  return token.claims.platformAdmin === true
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

/** Owner-only catalogue subscription. Rules reject it for regular leaders. */
export const subscribePlatformProducts = (callback: (value: Record<string, ProductConfig>) => void, onError?: (error: Error) => void) => {
  if (!db) { callback({}); return () => undefined }
  return onValue(ref(db, 'products'), snapshot => callback((snapshot.val() || {}) as Record<string, ProductConfig>), error => onError?.(error))
}

/** Owner-only access matrix; it is never loaded by a leader dashboard. */
export const subscribePlatformWorkspaceProducts = (callback: (value: Record<string, Record<string, WorkspaceProduct>>) => void, onError?: (error: Error) => void) => {
  if (!db) { callback({}); return () => undefined }
  return onValue(ref(db, 'workspaceProducts'), snapshot => callback((snapshot.val() || {}) as Record<string, Record<string, WorkspaceProduct>>), error => onError?.(error))
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
      lastActiveAt: now,
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
    const diagnosticAccess = createPilotWorkspaceAccess(diagnosticProductId, user.uid, now)
    const quizAccess = createPilotWorkspaceAccess(quizProductId, user.uid, now)
    await update(ref(services.db), {
      [`users/${user.uid}`]: profile,
      [`workspaces/${workspaceId}`]: workspace,
      [`workspaceProducts/${workspaceId}/${diagnosticProductId}`]: diagnosticAccess,
      [`workspaceProducts/${workspaceId}/${quizProductId}`]: quizAccess,
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
  const credential = await signInWithEmailAndPassword(services.auth, email.trim(), password)
  const profileSnapshot = await get(ref(services.db, `users/${credential.user.uid}`))
  const profile = profileSnapshot.val() as LeaderProfile | null
  if (profile?.status === 'paused' || profile?.status === 'revoked') {
    await signOut(services.auth)
    throw new Error(profile.status === 'paused'
      ? 'Доступ к кабинету временно приостановлен владельцем платформы.'
      : 'Доступ к кабинету отозван владельцем платформы.')
  }
  if (profile) await update(ref(services.db, `users/${credential.user.uid}`), { lastActiveAt: Date.now(), updatedAt: Date.now() })
  return credential
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
  if (!db || !roomId) return () => undefined
  return onValue(ref(db, roomPath(roomId)), snapshot => callback(snapshot.val()), error => onError?.(error))
}

/** Join-safe metadata: it intentionally contains no questions, participants or answers. */
export const subscribeRoomLobby = (roomId: string, callback: (value: RoomLobby | null) => void, onError?: (error: Error) => void) => {
  if (!db) return () => undefined
  return onValue(ref(db, `roomLobbies/${roomId}`), snapshot => callback((snapshot.val() || null) as RoomLobby | null), error => onError?.(error))
}

/** Public room metadata used by every new room. It contains no ownership or answer data. */
export const subscribePublicRoom = (roomId: string, callback: (value: PublicRoom | null) => void, onError?: (error: Error) => void) => {
  if (!db || !roomId) return () => undefined
  return onValue(ref(db, publicRoomPath(roomId)), snapshot => callback((snapshot.val() || null) as PublicRoom | null), error => onError?.(error))
}

export const subscribeParticipantQuestionSet = (roomId: string, callback: (value: ParticipantQuestionSet | null) => void, onError?: (error: Error) => void) => {
  if (!db || !roomId) return () => undefined
  return onValue(ref(db, participantQuestionsPath(roomId)), snapshot => callback((snapshot.val() || null) as ParticipantQuestionSet | null), error => onError?.(error))
}

export const subscribeParticipantRecord = (roomId: string, participantId: string, callback: (value: Participant | null) => void, onError?: (error: Error) => void) => {
  if (!db || !roomId || !participantId) return () => undefined
  return onValue(ref(db, roomParticipantPath(roomId, participantId)), snapshot => callback((snapshot.val() || null) as Participant | null), error => onError?.(error))
}

export const subscribeParticipantQuizResult = (roomId: string, participantId: string, callback: (value: ParticipantQuizResult | null) => void, onError?: (error: Error) => void) => {
  if (!db || !roomId || !participantId) return () => undefined
  return onValue(ref(db, participantResultPath(roomId, participantId)), snapshot => callback((snapshot.val() || null) as ParticipantQuizResult | null), error => onError?.(error))
}

export const subscribeGlobalPack = (packId: string, callback: (value: ContentPack | null) => void, onError?: (error: Error) => void) => {
  if (!db) return () => undefined
  return onValue(ref(db, `globalPacks/${packId}`), snapshot => callback(normalizeContentPack(snapshot.val(), builtInQuestions, { packId, templateOrigin: 'system' })), error => onError?.(error))
}

/**
 * Leader-facing catalogue. The query is deliberately fixed to `status=published`;
 * the matching Rules deny an unfiltered collection read, so drafts and archives
 * never reach a regular leader's client.
 */
export const subscribePublishedGlobalPacks = (callback: (value: Record<string, ContentPack>) => void, onError?: (error: Error) => void) => {
  if (!db) { callback({}); return () => undefined }
  const toPacks = (snapshot: { val: () => unknown }) => {
    const raw = (snapshot.val() || {}) as Record<string, unknown>
    const packs = Object.fromEntries(Object.entries(raw).flatMap(([packId, value]) => {
      const pack = normalizeContentPack(value, [], { packId, templateOrigin: 'system' })
      return pack ? [[packId, pack]] : []
    })) as Record<string, ContentPack>
    callback(packs)
  }
  const publishedPacks = query(ref(db, 'globalPacks'), orderByChild('status'), equalTo('published'))
  let unsubscribeLegacy: () => void = () => undefined
  const subscribeLegacyActivePacks = () => {
    const legacyPacks = query(ref(db, 'globalPacks'), orderByChild('status'), equalTo('active'))
    unsubscribeLegacy = onValue(legacyPacks, toPacks, error => onError?.(error))
  }
  const unsubscribePublished = onValue(publishedPacks, snapshot => {
    if (snapshot.exists()) toPacks(snapshot)
    else callback({})
  }, error => {
    // Compatibility for the already deployed pilot Rules while the canonical
    // `published` status is being rolled out. New Rules never grant this read.
    if ((error as { code?: string }).code === 'PERMISSION_DENIED') subscribeLegacyActivePacks()
    else onError?.(error)
  })
  return () => { unsubscribePublished(); unsubscribeLegacy() }
}

export const subscribeWorkspacePack = (workspaceId: string, packId: string, callback: (value: ContentPack | null) => void, onError?: (error: Error) => void) => {
  if (!db || !workspaceId) return () => undefined
  const canonical = ref(db, `workspaces/${workspaceId}/workspacePacks/${packId}`)
  let stopLegacy: () => void = () => undefined
  const stopCanonical = onValue(canonical, snapshot => {
    const pack = normalizeContentPack(snapshot.val(), builtInQuestions, { workspaceId, packId, templateOrigin: 'workspace' })
    if (pack) { stopLegacy(); callback(pack); return }
    // Legacy root is read-only compatibility only. It is intentionally never
    // merged with canonical data, so duplicates cannot be created by a read.
    stopLegacy()
    stopLegacy = onValue(ref(db, `workspacePacks/${workspaceId}/${packId}`), legacy => callback(normalizeContentPack(legacy.val(), builtInQuestions, { workspaceId, packId, templateOrigin: 'workspace' })), error => onError?.(error))
  }, error => onError?.(error))
  return () => { stopCanonical(); stopLegacy() }
}

/** Quiz copies live under the workspace document, unlike the legacy diagnostic editor path. */
export const subscribeWorkspaceQuizPacks = (workspaceId: string, callback: (value: Record<string, ContentPack>) => void, onError?: (error: Error) => void) => {
  if (!db || !workspaceId) { callback({}); return () => undefined }
  return onValue(ref(db, `workspaces/${workspaceId}/workspacePacks`), snapshot => {
    const raw = (snapshot.val() || {}) as Record<string, unknown>
    const packs = Object.fromEntries(Object.entries(raw).flatMap(([packId, value]) => {
      const pack = normalizeContentPack(value, [], { packId, workspaceId, templateOrigin: 'workspace', mode: 'quiz' })
      return pack?.mode === 'quiz' ? [[packId, pack]] : []
    })) as Record<string, ContentPack>
    callback(packs)
  }, error => onError?.(error))
}

/** Creates an immutable workspace copy of a published quiz pack once per leader. */
export const copyQuizPackToWorkspace = async (workspaceId: string, sourcePackId: string) => {
  const services = requireFirebase()
  await authPersistence
  const user = services.auth.currentUser
  if (!user || user.isAnonymous) throw new Error('Войдите как ведущий, чтобы добавить набор в workspace.')
  const [profileSnapshot, workspaceSnapshot, sourceSnapshot, existingSnapshot] = await Promise.all([
    get(ref(services.db, `users/${user.uid}`)),
    get(ref(services.db, `workspaces/${workspaceId}`)),
    get(ref(services.db, `globalPacks/${sourcePackId}`)),
    get(ref(services.db, `workspaces/${workspaceId}/workspacePacks/${sourcePackId}`)),
  ])
  const profile = profileSnapshot.val() as LeaderProfile | null
  const workspace = workspaceSnapshot.val() as Workspace | null
  if (!profile || profile.workspaceId !== workspaceId || workspace?.ownerUid !== user.uid) throw new Error('Этот workspace не принадлежит текущему ведущему.')
  const source = normalizeContentPack(sourceSnapshot.val(), [], { packId: sourcePackId, templateOrigin: 'system', mode: 'quiz' })
  if (!source || source.status !== 'published' || source.mode !== 'quiz') throw new Error('Этот набор викторины недоступен для копирования.')
  const existing = existingSnapshot.exists()
    ? normalizeContentPack(existingSnapshot.val(), [], { packId: sourcePackId, workspaceId, templateOrigin: 'workspace', mode: 'quiz' })
    : null
  if (existing && existing.sourcePackVersion === source.packVersion) return existing
  const now = Date.now()
  const copy: ContentPack = {
    ...source,
    templateOrigin: 'workspace',
    workspaceId,
    sourcePackId: source.sourcePackId || source.packId,
    sourcePackVersion: source.packVersion,
    copiedBy: user.uid,
    copiedAt: now,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    createdBy: user.uid,
    questions: copyQuestions(source.questions),
    content: { questions: copyQuestions(source.questions) },
  }
  await set(ref(services.db, `workspaces/${workspaceId}/workspacePacks/${sourcePackId}`), copy)
  return copy
}

/**
 * Saves an already copied quiz pack. Global quiz packs remain read-only for
 * leaders: this function accepts only the current leader's workspace copy.
 */
export const saveWorkspaceQuizPack = async (workspaceId: string, candidate: ContentPack) => {
  const services = requireFirebase()
  await authPersistence
  const user = services.auth.currentUser
  if (!user || user.isAnonymous) throw new Error('Войдите как ведущий, чтобы изменить набор викторины.')
  if (!workspaceId || candidate.mode !== 'quiz' || candidate.templateOrigin !== 'workspace' || candidate.workspaceId !== workspaceId) {
    throw new Error('Можно редактировать только личную копию набора викторины.')
  }
  const packPath = `workspaces/${workspaceId}/workspacePacks/${candidate.packId}`
  const [profileSnapshot, workspaceSnapshot, existingSnapshot] = await Promise.all([
    get(ref(services.db, `users/${user.uid}`)),
    get(ref(services.db, `workspaces/${workspaceId}`)),
    get(ref(services.db, packPath)),
  ])
  const profile = profileSnapshot.val() as LeaderProfile | null
  const workspace = workspaceSnapshot.val() as Workspace | null
  if (!profile || profile.workspaceId !== workspaceId || workspace?.ownerUid !== user.uid) throw new Error('Этот workspace не принадлежит текущему ведущему.')
  const existing = normalizeContentPack(existingSnapshot.val(), [], { packId: candidate.packId, workspaceId, templateOrigin: 'workspace', mode: 'quiz' })
  if (!existing || existing.mode !== 'quiz') throw new Error('Сначала добавьте этот набор в свой workspace.')
  const now = Date.now()
  const version = Math.max(existing.version || existing.packVersion || 1, candidate.version || candidate.packVersion || 1) + 1
  const questions = copyQuestions(candidate.questions)
  const saved: ContentPack = {
    ...existing,
    ...candidate,
    productId: existing.productId,
    gameTypeId: existing.gameTypeId,
    mode: 'quiz',
    packId: existing.packId,
    templateOrigin: 'workspace',
    workspaceId,
    sourcePackId: existing.sourcePackId,
    sourcePackVersion: existing.sourcePackVersion,
    version,
    packVersion: version,
    status: existing.status || 'published',
    createdAt: existing.createdAt || now,
    createdBy: existing.createdBy || user.uid,
    copiedAt: existing.copiedAt,
    copiedBy: existing.copiedBy || user.uid,
    updatedAt: now,
    questions,
    content: { questions: copyQuestions(questions) },
  }
  await set(ref(services.db, packPath), saved)
  return saved
}

/** Platform-owner-only summary. Rules reject this subscription for ordinary leaders. */
export const subscribePlatformWorkspaces = (callback: (value: Record<string, Workspace>) => void, onError?: (error: Error) => void) => {
  if (!db) return () => undefined
  return onValue(ref(db, 'workspaces'), snapshot => callback((snapshot.val() || {}) as Record<string, Workspace>), error => onError?.(error))
}

/** The following subscriptions are owner-only; Realtime Database Rules enforce this. */
export const subscribePlatformLeaders = (callback: (value: Record<string, LeaderProfile>) => void, onError?: (error: Error) => void) => {
  if (!db) return () => undefined
  return onValue(ref(db, 'users'), snapshot => callback((snapshot.val() || {}) as Record<string, LeaderProfile>), error => onError?.(error))
}

export const subscribePlatformSessions = (callback: (value: Record<string, Session>) => void, onError?: (error: Error) => void) => {
  if (!db) return () => undefined
  return onValue(ref(db, 'sessions'), snapshot => callback((snapshot.val() || {}) as Record<string, Session>), error => onError?.(error))
}

export const subscribePlatformArchives = (callback: (value: Record<string, SessionArchive>) => void, onError?: (error: Error) => void) => {
  if (!db) return () => undefined
  return onValue(ref(db, 'sessionArchives'), snapshot => callback((snapshot.val() || {}) as Record<string, SessionArchive>), error => onError?.(error))
}

export const subscribePlatformGlobalPacks = (callback: (value: Record<string, ContentPack>) => void, onError?: (error: Error) => void) => {
  if (!db) return () => undefined
  return onValue(ref(db, 'globalPacks'), snapshot => {
    const raw = (snapshot.val() || {}) as Record<string, unknown>
    const packs = Object.fromEntries(Object.entries(raw).flatMap(([packId, value]) => {
      const pack = normalizeContentPack(value, builtInQuestions, { packId, templateOrigin: 'system' })
      // OwnerAdmin predates the canonical `published` value and exposes this
      // alias only inside its select control. saveGlobalPackAsOwner converts it
      // back to `published` before every database write.
      return pack ? [[packId, pack.status === 'published' ? { ...pack, status: 'active' as const } : pack]] : []
    })) as Record<string, ContentPack>
    callback(packs)
  }, error => onError?.(error))
}

export const subscribePlatformFeedback = (callback: (value: Record<string, FeedbackItem>) => void, onError?: (error: Error) => void) => {
  if (!db) return () => undefined
  return onValue(ref(db, 'feedback'), snapshot => callback((snapshot.val() || {}) as Record<string, FeedbackItem>), error => onError?.(error))
}

export const setLeaderStatusAsOwner = async (uid: string, status: UserStatus) => {
  const services = requireFirebase()
  await authPersistence
  if (!await isPlatformOwner()) throw new Error('Недостаточно прав владельца платформы.')
  const profileSnapshot = await get(ref(services.db, `users/${uid}`))
  const profile = profileSnapshot.val() as LeaderProfile | null
  if (!profile) throw new Error('Профиль лидера не найден.')
  const now = Date.now()
  const patch: Record<string, unknown> = {
    [`users/${uid}/status`]: status,
    [`users/${uid}/updatedAt`]: now,
  }
  // Paused/revoked leaders keep all history. Their open rooms are closed so
  // participants cannot continue writing answers to a disabled workspace.
  if (status === 'paused' || status === 'revoked') {
    const sessionsSnapshot = await get(ref(services.db, 'sessions'))
    const sessions = (sessionsSnapshot.val() || {}) as Record<string, Session>
    for (const session of Object.values(sessions).filter(session => session.hostUid === uid && session.phase !== 'closed')) {
      await ensureParticipantRoomData(session.roomId, session)
      const closed: SessionArchive = { ...session, phase: 'closed', closedAt: now, archivedAt: now }
      patch[`sessions/${session.roomId}/phase`] = 'closed'
      patch[`sessions/${session.roomId}/closedAt`] = now
      patch[`${publicRoomPath(session.roomId)}/phase`] = 'closed'
      patch[`${publicRoomPath(session.roomId)}/closedAt`] = now
      patch[`sessionArchives/${session.roomId}`] = closed
      if (session.workspaceId) patch[`workspaceArchives/${session.workspaceId}/${session.roomId}`] = closed
    }
  }
  await update(ref(services.db), patch)
}

/** Publishes operational product availability. Draft form state is local until this call. */
export const saveProductAsOwner = async (draft: ProductConfig) => {
  const services = requireFirebase()
  await authPersistence
  if (!await isPlatformOwner()) throw new Error('Недостаточно прав владельца платформы.')
  const now = Date.now()
  const currentSnapshot = await get(ref(services.db, `products/${draft.productId}`))
  const current = currentSnapshot.val() as ProductConfig | null
  const product: ProductConfig = {
    ...platformProductDefaults[draft.productId],
    ...current,
    ...draft,
    productId: draft.productId,
    name: draft.name.trim(),
    description: draft.description.trim(),
    maintenanceMessage: draft.maintenanceMessage?.trim() || '',
    version: Math.max(1, Number(current?.version || draft.version || 1) + 1),
    updatedAt: now,
    publishedAt: now,
  }
  if (!product.name || !product.description) throw new Error('Укажите название и описание продукта.')
  await set(ref(services.db, `products/${product.productId}`), product)
  return product
}

/** Owner-controlled access for one workspace. Existing leader history stays intact. */
export const saveWorkspaceProductAsOwner = async (workspaceId: string, productId: string, patch: Pick<WorkspaceProduct, 'enabled' | 'testing' | 'planId' | 'expiresAt'> & { plan?: string }) => {
  const services = requireFirebase()
  await authPersistence
  if (!await isPlatformOwner()) throw new Error('Недостаточно прав владельца платформы.')
  const [workspaceSnapshot, currentSnapshot] = await Promise.all([
    get(ref(services.db, `workspaces/${workspaceId}`)),
    get(ref(services.db, `workspaceProducts/${workspaceId}/${productId}`)),
  ])
  const workspace = workspaceSnapshot.val() as Workspace | null
  if (!workspace) throw new Error('Рабочее пространство не найдено.')
  const current = currentSnapshot.val() as WorkspaceProduct | null
  const now = Date.now()
  const next: WorkspaceProduct = {
    productId,
    ownerUid: workspace.ownerUid,
    enabled: patch.enabled,
    accessSource: current?.accessSource || 'manual',
    plan: patch.plan || patch.planId,
    planId: patch.planId,
    startsAt: current?.startsAt || now,
    expiresAt: Math.max(0, Number(patch.expiresAt) || 0),
    testing: patch.testing,
  }
  await set(ref(services.db, `workspaceProducts/${workspaceId}/${productId}`), next)
  return next
}

export const saveGlobalPackAsOwner = async (draft: ContentPack) => {
  const services = requireFirebase()
  await authPersistence
  if (!await isPlatformOwner()) throw new Error('Недостаточно прав владельца платформы.')
  const now = Date.now()
  const existingSnapshot = await get(ref(services.db, `globalPacks/${draft.packId}`))
  const existing = normalizeContentPack(existingSnapshot.val(), builtInQuestions, { packId: draft.packId, templateOrigin: 'system' })
  const nextVersion = Math.max(1, (existing?.version || existing?.packVersion || 0) + 1)
  const isQuiz = draft.mode === 'quiz' || draft.gameTypeId === quizGameTypeId || draft.productId === quizProductId
  const orderedQuestions = copyQuestions(isQuiz ? draft.content.questions : orderQuestionsByCategory(draft.content.questions))
  const module = getGameModule(isQuiz ? quizGameTypeId : (draft.gameTypeId || diagnosticGameTypeId))
  const pack: ContentPack = {
    ...draft,
    productId: draft.productId || (isQuiz ? quizProductId : diagnosticProductId),
    gameTypeId: draft.gameTypeId || (isQuiz ? quizGameTypeId : diagnosticGameTypeId),
    mode: isQuiz ? 'quiz' : 'diagnostic',
    packId: draft.packId,
    version: nextVersion,
    packVersion: nextVersion,
    status: normalizePackStatus(draft.status),
    templateOrigin: 'system',
    sourcePackId: draft.sourcePackId || draft.packId,
    content: { questions: orderedQuestions },
    questions: copyQuestions(orderedQuestions),
    description: draft.description.trim() || defaultPackDescription,
    settings: copySettings(draft.settings),
    ruleConfig: module.normalizeRuleConfig(draft.ruleConfig),
    contentSchemaVersion: draft.contentSchemaVersion || module.contentSchemaVersion,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    createdBy: existing?.createdBy || services.auth.currentUser?.uid,
  }
  await set(ref(services.db, `globalPacks/${pack.packId}`), pack)
  return pack
}

/** Owner-triggered, idempotent creation of the three published quiz starter packs. */
export const seedBibleQuizStarterPacks = async () => {
  const services = requireFirebase()
  await authPersistence
  if (!await isPlatformOwner()) throw new Error('Только владелец платформы может публиковать системные наборы.')
  const created: ContentPack[] = []
  for (const source of bibleQuizStarterPacks) {
    const snapshot = await get(ref(services.db, `globalPacks/${source.packId}`))
    if (snapshot.exists()) continue
    created.push(await saveGlobalPackAsOwner({ ...source, version: 1, packVersion: 1 }))
  }
  return created
}

/**
 * Explicit one-time seeding helper for the platform owner. It is never called
 * automatically for a leader, because leaders may read global packs but may
 * not modify them under the published Rules.
 */
export const seedDefaultGlobalPack = async () => {
  const services = requireFirebase()
  await authPersistence
  const user = services.auth.currentUser
  if (!user || user.isAnonymous) throw new Error('Для публикации системного набора нужен аккаунт владельца платформы.')
  const now = Date.now()
  const existingSnapshot = await get(ref(services.db, `globalPacks/${diagnosticPackId}`))
  const existingRaw = (existingSnapshot.val() || null) as Partial<ContentPack> | null
  const existingQuestions = existingRaw?.questions || existingRaw?.content?.questions
  const existingStatus = normalizePackStatus(existingRaw?.status)
  // Older deployments kept the system bank at /questionBank. Read it only for
  // a one-time owner migration, and only when the canonical pack has no usable
  // question list. The canonical global pack remains the sole source afterwards.
  const legacySnapshot = Array.isArray(existingQuestions) ? null : await get(ref(services.db, 'questionBank'))
  const legacyRaw = legacySnapshot?.val()
  const legacyQuestions = Array.isArray(legacyRaw)
    ? legacyRaw as Question[]
    : legacyRaw && typeof legacyRaw === 'object' && Array.isArray((legacyRaw as { questions?: unknown }).questions)
      ? (legacyRaw as { questions: Question[] }).questions
      : []
  const sourceQuestions = Array.isArray(existingQuestions) && existingQuestions.length
    ? existingQuestions
    : legacyQuestions.length
      ? legacyQuestions
      : builtInQuestions
  const version = Math.max(1, Number(existingRaw?.version || existingRaw?.packVersion || diagnosticPackVersion))
  const pack: ContentPack = {
    ...existingRaw,
    productId: diagnosticProductId,
    gameTypeId: diagnosticGameTypeId,
    packId: diagnosticPackId,
    version,
    packVersion: version,
    status: existingStatus,
    sourcePackId: diagnosticPackId,
    templateOrigin: 'system',
    title: normalizePackTitle(existingRaw?.title),
    description: existingRaw?.description?.trim() || defaultPackDescription,
    questions: copyQuestions(orderQuestionsByCategory(sourceQuestions)),
    content: { questions: copyQuestions(orderQuestionsByCategory(sourceQuestions)) },
    settings: copySettings(existingRaw?.settings || { maxParticipants: 30, skippedAnswerScore: -1 }),
    ruleConfig: diagnosticGameModule.normalizeRuleConfig(existingRaw?.ruleConfig),
    contentSchemaVersion: existingRaw?.contentSchemaVersion || diagnosticGameModule.contentSchemaVersion,
    createdAt: existingRaw?.createdAt || now,
    updatedAt: now,
    createdBy: existingRaw?.createdBy || user.uid,
  }
  await set(ref(services.db, `globalPacks/${diagnosticPackId}`), pack)
  return pack
}

const assertRoomCreationAccess = async (hostUid: string, workspaceId: string, productId = diagnosticProductId) => {
  const services = requireFirebase()
  const platformOwner = await isPlatformOwner()
  const [profileSnapshot, workspaceSnapshot, workspaceProductSnapshot, productSnapshot] = await Promise.all([
    get(ref(services.db, `users/${hostUid}`)),
    get(ref(services.db, `workspaces/${workspaceId}`)),
    get(ref(services.db, `workspaceProducts/${workspaceId}/${productId}`)),
    get(ref(services.db, `products/${productId}`)),
  ])
  const profile = profileSnapshot.val() as LeaderProfile | null
  const workspace = workspaceSnapshot.val() as Workspace | null
  if (profile?.workspaceId !== workspaceId || workspace?.ownerUid !== hostUid) {
    throw new Error('Рабочее пространство не принадлежит текущему ведущему. Обновите страницу или войдите в нужный аккаунт.')
  }
  const decision = canUseFeature(productId, 'create_room', {
    profile,
    workspace,
    workspaceProduct: workspaceProductSnapshot.val() as WorkspaceProduct | null,
    product: productSnapshot.val() as ProductConfig | null,
    isPlatformOwner: platformOwner,
  })
  if (!decision.allowed) throw new Error(decision.reason || 'Создание комнаты недоступно.')
}

export const defaultRoomTitle = (createdAt = Date.now()) => `Встреча молодёжки · ${new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(new Date(createdAt))}`

export const createSessionRecord = (roomId: string, hostUid: string, questionSet: Question[] = builtInQuestions, workspaceId?: string, templateSnapshot?: TemplateSnapshot, templateSelection?: TemplateSelection, roomTitle?: string, pilotDetails?: Partial<RoomPilotDetails>, scoringTemplateId: ScoringTemplateId = 'standard-v1'): Session => {
  const template = templateSnapshot || createDiagnosticTemplateSnapshot(questionSet)
  const selection = templateSelection || { selectedPackId: template.packId, templateSource: template.templateOrigin }
  const createdAt = Date.now()
  const cleanTitle = roomTitle?.trim().slice(0, 80) || defaultRoomTitle(createdAt)
  const details: RoomPilotDetails = {
    groupName: pilotDetails?.groupName?.trim() || '',
    city: pilotDetails?.city?.trim() || '',
    mode: pilotDetails?.mode || 'diagnostic',
    estimatedParticipants: Math.max(1, Math.min(30, Math.round(Number(pilotDetails?.estimatedParticipants) || 30))),
  }
  const isQuiz = template.mode === 'quiz' || template.gameTypeId === quizGameTypeId || details.mode === 'quiz'
  const mode: RoomMode = isQuiz ? 'quiz' : 'diagnostic'
  const scoring = getScoringTemplate(scoringTemplateId)
  const ruleConfig = isQuiz
    ? bibleQuizGameModule.normalizeRuleConfig(template.ruleConfig)
    : {
        ...(template.ruleConfig ? { ...template.ruleConfig } : diagnosticGameModule.defaultRuleConfig),
        scoringMode: scoring.scoringTemplateId === 'strict-v1' ? 'diagnostic-2-1-0-minus-1' as const : 'diagnostic-3-2-1-0' as const,
      }
  const createdEvent: SessionEvent = { id: 'room_created', type: 'room_created', roomId, ...(workspaceId ? { workspaceId } : {}), hostUid, createdAt }
  return {
    roomId,
    roomTitle: cleanTitle,
    displayCode: roomId,
    createdAt,
    phase: 'lobby',
    status: 'lobby',
    maxParticipants: 30,
    hostUid,
    createdBy: hostUid,
    ...(workspaceId ? { workspaceId } : {}),
    groupName: details.groupName,
    city: details.city,
    mode,
    ...(isQuiz ? { quizPackId: template.packId, quizPackVersion: template.packVersion, ...(template.difficulty ? { difficulty: template.difficulty } : {}) } : {}),
    estimatedParticipants: details.estimatedParticipants,
    participantCount: 0,
    completedCount: 0,
    selectedPackId: selection.selectedPackId,
    templateSource: selection.templateSource,
    productId: template.productId,
    gameTypeId: template.gameTypeId,
    packId: template.packId,
    packVersion: template.packVersion,
    ...(!isQuiz ? { scoringTemplateId: scoring.scoringTemplateId, scoringTemplateVersion: scoring.scoringTemplateVersion, scoringMap: { ...scoring.scoringMap } } : {}),
    sourcePackId: template.sourcePackId || template.packId,
    packUpdatedAt: template.updatedAt || template.capturedAt,
    packSnapshot: {
      title: template.title,
      description: template.description,
      questions: copyQuestions(template.questions),
      settings: copySettings(template.settings),
      ruleConfig,
      ...(!isQuiz ? { scoring: {
        scoringTemplateId: scoring.scoringTemplateId,
        scoringTemplateVersion: scoring.scoringTemplateVersion,
        scoringMap: { ...scoring.scoringMap },
        mode: ruleConfig.scoringMode,
        answerScores: { A: scoring.scoringMap.A, B: scoring.scoringMap.B, C: scoring.scoringMap.C, D: scoring.scoringMap.D },
        skippedAnswerScore: scoring.scoringMap.SKIP,
      } } : {}),
    },
    settings: { ...copySettings(template.settings), roomMode: mode, estimatedParticipants: details.estimatedParticipants, ...(isQuiz ? { quizScoring: 'correct-1-0' } : { scoringTemplateId: scoring.scoringTemplateId, scoringTemplateVersion: scoring.scoringTemplateVersion }) },
    templateOrigin: template.templateOrigin,
    templateSnapshot: template,
    questions: copyQuestions(template.content.questions),
    participants: {},
    events: { [createdEvent.id]: createdEvent },
  }
}

export const createSession = async (roomId: string, hostUid: string, questionSet?: Question[], workspaceId?: string, templateSelection: TemplateSelection = defaultDiagnosticTemplateSelection, roomTitle?: string, pilotDetails?: Partial<RoomPilotDetails>, scoringTemplateId: ScoringTemplateId = 'standard-v1') => {
  if (!db) throw new Error('Firebase не настроен')
  const services = requireFirebase()
  await authPersistence
  const currentUser = services.auth.currentUser
  if (!currentUser || currentUser.isAnonymous || currentUser.uid !== hostUid) throw new Error('Сеанс ведущего не подтверждён. Войдите в аккаунт ещё раз и повторите создание комнаты.')
  if (!workspaceId) throw new Error('Для создания комнаты нужно рабочее пространство.')
  const mode = pilotDetails?.mode || 'diagnostic'
  const effectiveSelection = mode === 'diagnostic' ? defaultDiagnosticTemplateSelection : templateSelection
  if (mode === 'quiz' && effectiveSelection.templateSource !== 'workspace') {
    throw new Error('Для викторины сначала добавьте опубликованный набор в свой workspace.')
  }
  await assertRoomCreationAccess(hostUid, workspaceId, mode === 'quiz' ? quizProductId : diagnosticProductId)
  // Refreshes only the leader's personal copy when the published source pack
  // received a newer version. Existing sessions never change: they use their
  // immutable templateSnapshot.
  if (mode === 'quiz') await copyQuizPackToWorkspace(workspaceId, effectiveSelection.selectedPackId)
  const template = await resolveRoomTemplate(workspaceId, effectiveSelection, mode)
  const session = createSessionRecord(roomId, hostUid, questionSet, workspaceId, template, effectiveSelection, roomTitle, pilotDetails, scoringTemplateId)
  // `sessions` is the canonical room record. Participant-facing data is written
  // immediately afterwards into separate, deliberately safe paths. We cannot
  // create both in one multi-location write because Rules must first verify that
  // this session belongs to the currently authenticated leader.
  try {
    await set(ref(db, roomPath(roomId)), session)
    await ensureParticipantRoomData(roomId, session)
  } catch (reason) {
    const code = typeof reason === 'object' && reason && 'code' in reason ? String(reason.code) : ''
    console.error('room creation was rejected by Firebase', { roomId, workspaceId, hostUid, packId: session.packId, code, reason })
    throw new Error(code === 'PERMISSION_DENIED' || /permission_denied/i.test(String(reason))
      ? 'Firebase отклонил создание комнаты. Проверьте опубликованные Rules, статус аккаунта и доступ к продукту.'
      : `Не удалось сохранить комнату в Firebase${code ? ` (${code})` : ''}.`)
  }
  return session
}

/**
 * Creates the participant-safe projection for a room once. It is also the
 * non-destructive compatibility bridge for legacy rooms created before the
 * public/private split. The full session remains host-only.
 */
export const ensureParticipantRoomData = async (roomId: string, knownSession?: Session) => {
  const services = requireFirebase()
  const session = knownSession || (await assertCurrentUserIsRoomHost(roomId)).session
  if (session.roomId !== roomId) throw new Error('Идентификатор комнаты не совпадает с данными сессии.')
  const [publicSnapshot, participantQuestionsSnapshot, privateQuestionsSnapshot] = await Promise.all([
    get(ref(services.db, publicRoomPath(roomId))),
    get(ref(services.db, participantQuestionsPath(roomId))),
    get(ref(services.db, privateQuestionsPath(roomId))),
  ])
  const patch: Record<string, unknown> = {}
  if (!publicSnapshot.exists()) patch[publicRoomPath(roomId)] = createPublicRoom(session)
  if (!participantQuestionsSnapshot.exists()) patch[participantQuestionsPath(roomId)] = createParticipantQuestionSet(session)
  if (!privateQuestionsSnapshot.exists()) patch[privateQuestionsPath(roomId)] = createPrivateQuestionSet(session)
  if (Object.keys(patch).length) await update(ref(services.db), patch)
}

export const joinSession = async (roomId: string, participant: Participant) => {
  const services = requireFirebase()
  await authPersistence
  if (!services.auth.currentUser) throw new Error('Firebase user is not ready.')
  if (services.auth.currentUser.uid !== participant.id) throw new Error('Participant identity does not match the current Firebase user.')
  if (!services.auth.currentUser.isAnonymous) throw new Error('Откройте ссылку участника в отдельном браузере или в режиме инкогнито.')
  const [publicRoomSnapshot, participantSnapshot] = await Promise.all([
    get(ref(services.db, publicRoomPath(roomId))),
    get(ref(services.db, roomParticipantPath(roomId, participant.id))),
  ])
  // Only read the legacy lobby if a safe projection does not exist. Rules
  // deliberately deny it once the projection is present, because it contains
  // host/workspace identifiers from the previous data model.
  const legacyLobbySnapshot = publicRoomSnapshot.exists() ? null : await get(ref(services.db, `roomLobbies/${roomId}`))
  const lobby = (publicRoomSnapshot.val() || legacyLobbySnapshot?.val()) as (PublicRoom | RoomLobby | null)
  if (!lobby) throw new Error('Комната не найдена или больше недоступна.')
  if (lobby.phase === 'closed') throw new Error('Сессия завершена ведущим. Подключение больше недоступно.')
  if (participantSnapshot.exists()) return
  try {
    await set(ref(services.db, `sessions/${roomId}/participants/${participant.id}`), participant)
    await recordParticipantEvent(roomId, participant.id, 'participant_joined')
  } catch (error) {
    console.error('participant join rejected', { roomId, participantId: participant.id, error })
    throw new Error('Не удалось подключиться к комнате. Возможно, она завершена или уже заполнена.')
  }
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
  const timestamp = Date.now()
  const participantCount = Object.keys(services.session.participants || {}).length
  const completedCount = Object.values(services.session.participants || {}).filter(participant => participant.status === 'finished').length
  const eventType: SessionEventType | null = phase === 'live' ? 'room_started' : phase === 'closed' ? 'room_closed' : null
  const event: SessionEvent | null = eventType ? { id: eventType, type: eventType, roomId, ...(services.session.workspaceId ? { workspaceId: services.session.workspaceId } : {}), hostUid: services.session.hostUid, createdAt: timestamp } : null
  await ensureParticipantRoomData(roomId, services.session)
  const quizResultPatch: Record<string, ParticipantQuizResult> = {}
  if (phase === 'resultsIntro' && (services.session.mode === 'quiz' || services.session.gameTypeId === quizGameTypeId)) {
    const privateQuestions = getSessionQuestions(services.session, [])
    for (const participant of Object.values(services.session.participants || {})) {
      if (participant.status !== 'finished') continue
      const scored = bibleQuizGameModule.score(participant.answers || {}, privateQuestions, services.session)
      quizResultPatch[participantResultPath(roomId, participant.id)] = {
        participantId: participant.id,
        correct: Math.round(scored.points || 0),
        total: privateQuestions.length,
        percentage: Math.round(scored.total),
        releasedAt: timestamp,
      }
    }
  }
  const patch: Record<string, unknown> = phase === 'resultsIntro'
    ? { [`sessions/${roomId}/phase`]: phase, [`sessions/${roomId}/resultsIntroStartedAt`]: timestamp, [`${publicRoomPath(roomId)}/phase`]: phase }
    : phase === 'closed'
      ? { [`sessions/${roomId}/phase`]: 'closed', [`sessions/${roomId}/closedAt`]: timestamp, [`sessions/${roomId}/participantCount`]: participantCount, [`sessions/${roomId}/completedCount`]: completedCount, [`sessions/${roomId}/events/${event?.id}`]: event, [`${publicRoomPath(roomId)}/phase`]: 'closed', [`${publicRoomPath(roomId)}/closedAt`]: timestamp }
      : phase === 'live'
        ? { [`sessions/${roomId}/phase`]: phase, [`sessions/${roomId}/startedAt`]: services.session.startedAt || timestamp, [`sessions/${roomId}/participantCount`]: participantCount, [`sessions/${roomId}/completedCount`]: completedCount, [`sessions/${roomId}/events/${event?.id}`]: event, [`${publicRoomPath(roomId)}/phase`]: phase }
        : { [`sessions/${roomId}/phase`]: phase, [`${publicRoomPath(roomId)}/phase`]: phase }
  Object.assign(patch, quizResultPatch)
  await update(ref(services.db), patch)
}

/** Keeps aggregate pilot counters current without exposing answers or participant names. */
export const updateSessionPilotCounts = async (roomId: string, expectedHostUid?: string) => {
  const services = await assertCurrentUserIsRoomHost(roomId, expectedHostUid)
  const participantCount = Object.keys(services.session.participants || {}).length
  const completedCount = Object.values(services.session.participants || {}).filter(participant => participant.status === 'finished').length
  if (services.session.participantCount === participantCount && services.session.completedCount === completedCount) return
  await update(ref(services.db), { [`sessions/${roomId}/participantCount`]: participantCount, [`sessions/${roomId}/completedCount`]: completedCount })
}

/** The title is editable only while the room is still waiting for participants. */
export const updateRoomTitle = async (roomId: string, roomTitle: string, expectedHostUid?: string) => {
  const services = await assertCurrentUserIsRoomHost(roomId, expectedHostUid)
  if (services.session.phase !== 'lobby') throw new Error('После запуска диагностики название комнаты изменить нельзя.')
  const cleanTitle = roomTitle.trim().slice(0, 80)
  if (!cleanTitle) throw new Error('Введите название комнаты.')
  await ensureParticipantRoomData(roomId, services.session)
  await update(ref(services.db), { [`sessions/${roomId}/roomTitle`]: cleanTitle, [`${publicRoomPath(roomId)}/roomTitle`]: cleanTitle })
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
  const patch: Record<string, SessionArchive> = { [`sessionArchives/${session.roomId}`]: archived }
  if (archived.workspaceId) patch[`workspaceArchives/${archived.workspaceId}/${session.roomId}`] = archived
  await update(ref(services.db), patch)
  return archived
}

export const subscribeSessionArchives = (workspaceId: string, callback: (value: Record<string, SessionArchive>) => void, onError?: (error: Error) => void) => {
  if (!db || !workspaceId) return () => undefined
  return onValue(ref(db, `workspaceArchives/${workspaceId}`), snapshot => callback((snapshot.val() || {}) as Record<string, SessionArchive>), error => onError?.(error))
}

export const saveWorkspacePack = async (workspaceId: string, questionSet: Question[], title = 'Диагностика атмосферы молодёжи') => {
  const services = requireFirebase()
  await authPersistence
  const user = services.auth.currentUser
  if (!user || user.isAnonymous) throw new Error('Для сохранения вопросов войдите в аккаунт ведущего.')
  if (!workspaceId) throw new Error('Не найдено рабочее пространство ведущего.')
  // Canonical personal-pack path. The legacy root remains read-only fallback.
  const packPath = `workspaces/${workspaceId}/workspacePacks/${diagnosticPackId}`
  const currentSnapshot = await get(ref(services.db, packPath))
  const current = normalizeContentPack(currentSnapshot.val(), builtInQuestions, { workspaceId, packId: diagnosticPackId, templateOrigin: 'workspace' })
  const now = Date.now()
  const pack: ContentPack = {
    productId: diagnosticProductId,
    gameTypeId: diagnosticGameTypeId,
    mode: 'diagnostic',
    packId: diagnosticPackId,
    version: Math.max(diagnosticPackVersion, (current?.version || current?.packVersion || diagnosticPackVersion - 1) + 1),
    packVersion: Math.max(diagnosticPackVersion, (current?.version || current?.packVersion || diagnosticPackVersion - 1) + 1),
    status: 'published',
    sourcePackId: current?.sourcePackId || diagnosticPackId,
    templateOrigin: 'workspace',
    workspaceId,
    title: current?.title || title,
    description: current?.description || defaultPackDescription,
    questions: copyQuestions(orderQuestionsByCategory(questionSet)),
    content: { questions: copyQuestions(orderQuestionsByCategory(questionSet)) },
    settings: copySettings(current?.settings || { maxParticipants: 30, skippedAnswerScore: -1 }),
    ruleConfig: diagnosticGameModule.normalizeRuleConfig(current?.ruleConfig),
    contentSchemaVersion: current?.contentSchemaVersion || diagnosticGameModule.contentSchemaVersion,
    createdAt: current?.createdAt || now,
    updatedAt: now,
    createdBy: current?.createdBy || user.uid,
  }
  await set(ref(services.db, packPath), pack)
  return pack
}

export const saveSessionQuestions = async (roomId: string, questionSet: Question[]) => {
  void roomId; void questionSet
  throw new Error('Снимок вопросов комнаты неизменяем после создания. Измените набор и создайте новую комнату.')
}

/** @deprecated Legacy questionBank is intentionally no longer read by the host UI. */
export const saveQuestionBank = async () => { throw new Error('questionBank is deprecated; save a workspace pack instead.') }
/** @deprecated Legacy questionBank is intentionally no longer read by the host UI. */
export const subscribeQuestionBank = (_callback: (value: Question[] | null) => void) => () => undefined

export const saveAnswer = async (roomId: string, participant: Participant, questionId: string, answer: ResponseValue, nextIndex: number, totalQuestions = 16) => {
  const services = requireFirebase()
  await authPersistence
  const currentUser = services.auth.currentUser
  if (!currentUser || currentUser.uid !== participant.id) throw new Error('Participant identity does not match the current Firebase user.')
  const [publicSnapshot, participantSnapshot] = await Promise.all([
    get(ref(services.db, publicRoomPath(roomId))),
    get(ref(services.db, roomParticipantPath(roomId, participant.id))),
  ])
  const publicRoom = publicSnapshot.val() as PublicRoom | null
  if (!publicRoom) throw new Error('Безопасные данные комнаты ещё не подготовлены. Попросите ведущего обновить комнату.')
  if (publicRoom.phase !== 'live') throw new Error(publicRoom.phase === 'closed' ? 'Сессия завершена ведущим. Ответы больше не принимаются.' : 'Диагностика ещё не запущена.')
  const storedParticipant = participantSnapshot.val() as Participant | null
  if (!storedParticipant) throw new Error('Участник не найден в комнате. Подключитесь заново.')
  if (storedParticipant.id !== currentUser.uid) throw new Error('Participant record does not belong to the current Firebase user.')
  const finished = nextIndex >= totalQuestions
  const next: Participant = {
    ...storedParticipant,
    answers: { ...storedParticipant.answers, [questionId]: answer }, currentQuestionIndex: nextIndex,
    status: finished ? 'finished' : 'answering', ...(finished ? { completedAt: Date.now() } : {})
  }
  // Write the owned leaves directly. The Rules grant a participant access only
  // to their own answer/status fields, never the participant collection.
  await update(ref(services.db), {
    [`sessions/${roomId}/participants/${participant.id}/answers/${questionId}`]: answer,
    [`sessions/${roomId}/participants/${participant.id}/currentQuestionIndex`]: next.currentQuestionIndex,
    [`sessions/${roomId}/participants/${participant.id}/status`]: next.status,
    ...(next.completedAt ? { [`sessions/${roomId}/participants/${participant.id}/completedAt`]: next.completedAt } : {})
  })
  if (finished) await recordParticipantEvent(roomId, participant.id, 'participant_finished')
  return next
}

const recordParticipantEvent = async (roomId: string, participantId: string, type: Extract<SessionEventType, 'participant_joined' | 'participant_finished' | 'report_viewed'>) => {
  try {
    const services = requireFirebase()
    const [publicSnapshot, participantSnapshot] = await Promise.all([
      get(ref(services.db, publicRoomPath(roomId))),
      get(ref(services.db, roomParticipantPath(roomId, participantId))),
    ])
    if (!publicSnapshot.exists() || !participantSnapshot.exists()) return
    const id = `${type}-${participantId}`
    const event: SessionEvent = { id, type, roomId, participantId, createdAt: Date.now() }
    await set(ref(services.db, `sessions/${roomId}/events/${id}`), event)
  } catch (error) {
    // Analytics must never roll back a successful participant action.
    console.warn('pilot event was not saved', { roomId, participantId, type, error })
  }
}

export const markPersonalViewed = async (roomId: string, participantId: string) => {
  const services = requireFirebase()
  await authPersistence
  if (!services.auth.currentUser || services.auth.currentUser.uid !== participantId) throw new Error('Participant identity does not match the current Firebase user.')
  await set(ref(services.db, `sessions/${roomId}/participants/${participantId}/personalViewedAt`), Date.now())
  await recordParticipantEvent(roomId, participantId, 'report_viewed')
}
