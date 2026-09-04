import { createUserWithEmailAndPassword, deleteUser, onAuthStateChanged, signInAnonymously, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth'
import { equalTo, get, onValue, orderByChild, push, query, ref, set, update } from 'firebase/database'
import { httpsCallable } from 'firebase/functions'
import { questions as builtInQuestions } from '../data/questions'
import { canUseFeature } from './access'
import { bibleQuizGameModule, diagnosticGameModule, getGameModule } from './gameRegistry'
import { getScoringTemplate } from './scoring'
import { orderQuestionsByCategory } from './questionOrder'
import { participantQuestionsPath, participantResultPath, publicRoomPath, roomParticipantPath, roomParticipantResultsPath, roomPath } from '../core/roomService'
import { normalizeQuestionsForMode, resolveCanonicalPackQuestions } from '../modes/contentPackAdapter'
import { resolveRegisteredRoomMode } from '../modes/modeRegistry'
import { firebaseAuth as auth, firebaseAuthPersistence as authPersistence, firebaseDb as db, firebaseFunctions as functions, firebaseReady } from '../repositories/firebaseClient'
import { getSessionQuestions, type Answer, type ContentPack, type FeedbackItem, type Invite, type LeaderProfile, type Participant, type ParticipantQuestion, type ParticipantQuestionSet, type ParticipantQuizResult, type ProductConfig, type PublicRoom, type Question, type ResponseValue, type RoomLobby, type RoomMode, type ScoringTemplateId, type Session, type SessionArchive, type SessionEvent, type SessionEventType, type SessionPhase, type TemplateSelection, type TemplateSnapshot, type UserStatus, type Workspace, type WorkspaceProduct } from '../types'

export { firebaseReady }
export const diagnosticProductId = diagnosticGameModule.productId
export const diagnosticGameTypeId = diagnosticGameModule.gameTypeId
export const quizProductId = bibleQuizGameModule.productId
export const quizGameTypeId = bibleQuizGameModule.gameTypeId
export const diagnosticPackId = 'youth-atmosphere-diagnostic'
export const diagnosticPackVersion = 1
export const defaultDiagnosticTemplateSelection: TemplateSelection = { selectedPackId: diagnosticPackId, templateSource: 'system' }
export const pilotPlanId = 'pilot-free'
export const pilotAccessSource = 'pilot' as const

// The diagnostic product was originally persisted under this short key.  New
// workspaces use the module's canonical `youth-atmosphere` product ID, while
// this alias lets already provisioned pilot workspaces retain their explicitly
// granted access without writing a second entitlement from the browser.
const legacyDiagnosticProductId = 'diagnostic'

/**
 * A stable catalogue used by the owner UI. Values in `products/{productId}`
 * override these defaults after the owner explicitly publishes a setting.
 */
export const platformProductDefaults: Record<string, ProductConfig> = {
  [diagnosticProductId]: {
    productId: diagnosticProductId,
    name: 'Проверь себя',
    description: 'Интерактивный формат «Проверь себя» для молодёжных групп.',
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
let pendingAnonymousSignIn: Promise<NonNullable<typeof auth>['currentUser']> | null = null

export interface RegisterLeaderInput { fullName: string; phone: string; email: string; password: string; workspaceName: string; city: string; inviteCode?: string }
export interface RoomPilotDetails {
  groupName: string
  city: string
  mode: RoomMode
  estimatedParticipants: number
}

const copyQuestions = (questionSet: Question[]) => questionSet.map(question => ({ ...question, options: { ...question.options } }))
const copySettings = (settings: Record<string, boolean | number | string | null>) => ({ ...settings })
/** All browser-facing packs contain only playable material. Quiz keys remain server-only. */
const toParticipantQuestions = (questionSet: Question[]): ParticipantQuestion[] => questionSet.map(question => ({
  id: question.id,
  ...('category' in question && typeof question.category === 'string' ? { category: question.category } : {}),
  ...('categoryOrder' in question && question.categoryOrder !== undefined ? { categoryOrder: question.categoryOrder } : {}),
  title: question.title,
  options: { ...question.options },
}) as ParticipantQuestion)
const buildPublishedPack = (pack: ContentPack): ContentPack => {
  const questions = toParticipantQuestions(pack.content.questions) as Question[]
  // Never spread private pack material into the leader-facing catalogue. In
  // particular, a server-imported quiz can carry `privateContent` with answer
  // keys even though the TypeScript ContentPack contract deliberately does not.
  const { privateContent: _privateContent, ...safePack } = pack as ContentPack & { privateContent?: unknown }
  return {
    ...safePack,
    questions,
    content: { questions: copyQuestions(questions) },
    publicContent: { questions: toParticipantQuestions(pack.content.questions) },
  }
}
const systemDiagnosticPackTitle = 'Проверь себя'
const normalizePackTitle = (title: unknown) => {
  const value = typeof title === 'string' ? title.trim() : ''
  return value && !/^\?+$/.test(value) ? value : systemDiagnosticPackTitle
}
const defaultPackDescription = 'Интерактивный формат «Проверь себя» для молодёжных групп.'
const normalizePackStatus = (status: unknown): ContentPack['status'] => status === 'draft' || status === 'archived' ? status : 'published'

/**
 * Public projections must always carry an explicit mode. The diagnostic value
 * here is a one-time compatibility conversion for records created before
 * modes existed; participant rendering never uses it as an unloaded fallback.
 */
const roomModeForPublicProjection = (session: Pick<Session, 'mode' | 'gameTypeId'>): RoomMode => {
  return resolveRegisteredRoomMode(session.mode || session.gameTypeId) || 'diagnostic'
}

/** Safe metadata for a participant: no host UID, workspace ID, answers or settings. */
const createPublicRoom = (session: Session): PublicRoom => {
  const mode = roomModeForPublicProjection(session)
  return {
    roomId: session.roomId,
    ...(session.roomTitle ? { roomTitle: session.roomTitle } : {}),
    ...(session.displayCode ? { displayCode: session.displayCode } : {}),
    phase: session.phase,
    maxParticipants: session.maxParticipants,
    createdAt: session.createdAt,
    ...(session.lastActivityAt ? { lastActivityAt: session.lastActivityAt } : {}),
    ...(session.closedAt ? { closedAt: session.closedAt } : {}),
    ...(session.endedAt ? { endedAt: session.endedAt } : {}),
    mode,
    ...(session.productId ? { productId: session.productId } : {}),
    ...(session.gameTypeId ? { gameTypeId: session.gameTypeId } : {}),
    ...(session.packId ? { packId: session.packId } : {}),
    ...(session.packSnapshot?.title ? { packTitle: session.packSnapshot.title } : {}),
    ...(session.difficulty ? { difficulty: session.difficulty } : {}),
    ...(session.scoringTemplateId ? { scoringTemplateId: session.scoringTemplateId } : {}),
    ...(mode === 'wheel' && session.wheel ? {
      wheel: {
        inputMode: session.wheel.config.inputMode,
        drawOrder: session.wheel.config.drawOrder,
        phase: session.wheel.phase === 'collecting' || session.wheel.phase === 'ready' || session.wheel.phase === 'completed'
          ? session.wheel.phase
          : 'collecting',
        nameCount: Object.keys(session.wheel.pools?.names || {}).length,
        taskCount: Object.keys(session.wheel.pools?.tasks || {}).length,
        submissionCount: Object.keys(session.wheel.participants || {}).length,
      },
    } : {}),
  }
}

const toParticipantQuestion = (question: Question): ParticipantQuestion => ({
  id: question.id,
  ...(question.category ? { category: question.category } : {}),
  ...('categoryOrder' in question && question.categoryOrder !== undefined ? { categoryOrder: question.categoryOrder } : {}),
  title: question.title,
  options: { ...question.options },
})

type ParticipantQuestionSetRecord = Omit<ParticipantQuestionSet, 'questions'> & {
  questions: Record<string, ParticipantQuestion>
}

const createParticipantQuestionSet = (session: Session): ParticipantQuestionSetRecord => {
  const questionSet = getSessionQuestions(session, builtInQuestions)
  const mode = roomModeForPublicProjection(session)
  return {
    roomId: session.roomId,
    createdAt: session.createdAt,
    mode,
    ...(session.productId ? { productId: session.productId } : {}),
    ...(session.gameTypeId ? { gameTypeId: session.gameTypeId } : {}),
    ...(session.packId ? { packId: session.packId } : {}),
    ...(session.packSnapshot?.title ? { packTitle: session.packSnapshot.title } : {}),
    ...(session.scoringTemplateId ? { scoringTemplateId: session.scoringTemplateId } : {}),
    // RTDB Rules validate each storage key against its immutable `id`. Arrays
    // become numeric keys (`0`, `1`) in RTDB and therefore cannot pass that
    // check, even though the data itself is otherwise participant-safe.
    questions: Object.fromEntries(questionSet.map(question => {
      const participantQuestion = toParticipantQuestion(question)
      return [participantQuestion.id, participantQuestion]
    })),
  }
}

const normalizeParticipantQuestionSet = (value: unknown): ParticipantQuestionSet | null => {
  if (!value || typeof value !== 'object') return null
  const raw = value as Omit<ParticipantQuestionSet, 'questions'> & { questions?: ParticipantQuestion[] | Record<string, ParticipantQuestion> }
  return { ...raw, questions: Array.isArray(raw.questions) ? raw.questions : Object.values(raw.questions || {}) }
}

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

/**
 * Realtime Database normally restores arrays as arrays, but older packs may
 * have been written as a keyed object.  Treat both representations as the
 * same immutable pack content so a valid published pack never appears empty.
 */
const normalizeContentPack = (value: unknown, _fallbackQuestions: Question[], defaults: Partial<ContentPack>): ContentPack | null => {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<ContentPack> & { questions?: Question[] }
  const publicQuestionSet = resolveCanonicalPackQuestions({ questions: raw.publicContent?.questions })
  const legacyQuestionSet = resolveCanonicalPackQuestions({ questions: raw.questions, legacyContentQuestions: raw.content?.questions, legacyPublicQuestions: raw.publicContent?.questions })
  if (!legacyQuestionSet.length && raw.questions == null && raw.content?.questions == null && raw.publicContent?.questions == null) return null
  const isQuiz = raw.mode === 'quiz' || raw.gameTypeId === quizGameTypeId || raw.productId === quizProductId || defaults.mode === 'quiz'
  const resolvedGameTypeId = raw.gameTypeId || defaults.gameTypeId || (isQuiz ? quizGameTypeId : diagnosticGameTypeId)
  let module
  try { module = getGameModule(resolvedGameTypeId) } catch { return null }
  const orderedQuestions = copyQuestions(normalizeQuestionsForMode(isQuiz ? 'quiz' : 'diagnostic', legacyQuestionSet))
  return {
    productId: raw.productId || defaults.productId || (isQuiz ? quizProductId : diagnosticProductId),
    gameTypeId: resolvedGameTypeId,
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
    ...(publicQuestionSet.length ? { publicContent: { questions: toParticipantQuestions(publicQuestionSet) } } : {}),
    settings: copySettings(raw.settings || defaults.settings || { maxParticipants: 30, skippedAnswerScore: -1 }),
    ruleConfig: module.normalizeRuleConfig(raw.ruleConfig || defaults.ruleConfig),
    contentSchemaVersion: raw.contentSchemaVersion || defaults.contentSchemaVersion || module.contentSchemaVersion,
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
  const questions = copyQuestions(normalizeQuestionsForMode(isQuiz ? 'quiz' : 'diagnostic', source.questions))
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
    : [{ path: `publishedPacks/${selection.selectedPackId}`, defaults: { packId: selection.selectedPackId, templateOrigin: 'system' } }]
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
  const effectiveSelection = selection
  if (!effectiveSelection.selectedPackId) throw new Error('Выберите набор вопросов перед созданием комнаты.')
  if (mode === 'quiz' && effectiveSelection.templateSource !== 'workspace') {
    throw new Error('Для викторины сначала добавьте опубликованный набор в свой workspace.')
  }
  const path = effectiveSelection.templateSource === 'workspace' && workspaceId
    ? (mode === 'quiz'
        ? `workspaces/${workspaceId}/workspacePackPublics/${effectiveSelection.selectedPackId}`
        : `workspaces/${workspaceId}/workspacePacks/${effectiveSelection.selectedPackId}`)
    : `publishedPacks/${effectiveSelection.selectedPackId}`
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
  const currentAuth = auth
  let active = true
  let unsubscribe: () => void = () => undefined
  void authPersistence.then(() => {
    if (active) unsubscribe = onAuthStateChanged(currentAuth, callback)
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
    // The workspace must exist before product access is created. Keeping the
    // two atomic writes separate lets RTDB Rules verify real ownership without
    // granting a broad bootstrap exception to arbitrary workspaceProducts.
    await update(ref(services.db), {
      [`users/${user.uid}`]: profile,
      [`workspaces/${workspaceId}`]: workspace,
    })
    await update(ref(services.db), {
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
  return onValue(ref(db, participantQuestionsPath(roomId)), snapshot => callback(normalizeParticipantQuestionSet(snapshot.val())), error => onError?.(error))
}

export const subscribeParticipantRecord = (roomId: string, participantId: string, callback: (value: Participant | null) => void, onError?: (error: Error) => void) => {
  if (!db || !roomId || !participantId) return () => undefined
  return onValue(ref(db, roomParticipantPath(roomId, participantId)), snapshot => callback((snapshot.val() || null) as Participant | null), error => onError?.(error))
}

export const subscribeParticipantQuizResult = (roomId: string, participantId: string, callback: (value: ParticipantQuizResult | null) => void, onError?: (error: Error) => void) => {
  if (!db || !roomId || !participantId) return () => undefined
  return onValue(ref(db, participantResultPath(roomId, participantId)), snapshot => callback((snapshot.val() || null) as ParticipantQuizResult | null), error => onError?.(error))
}

/** Host-only aggregate read. The Rules deny this root to participants. */
export const subscribeRoomQuizResults = (roomId: string, callback: (value: Record<string, ParticipantQuizResult>) => void, onError?: (error: Error) => void) => {
  if (!db || !roomId) { callback({}); return () => undefined }
  return onValue(ref(db, roomParticipantResultsPath(roomId)), snapshot => callback((snapshot.val() || {}) as Record<string, ParticipantQuizResult>), error => onError?.(error))
}

export const subscribeGlobalPack = (packId: string, callback: (value: ContentPack | null) => void, onError?: (error: Error) => void) => {
  if (!db) return () => undefined
  return onValue(ref(db, `publishedPacks/${packId}`), snapshot => callback(normalizeContentPack(snapshot.val(), builtInQuestions, { packId, templateOrigin: 'system' })), error => onError?.(error))
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
  const publishedPacks = query(ref(db, 'publishedPacks'), orderByChild('status'), equalTo('published'))
  const unsubscribePublished = onValue(publishedPacks, snapshot => {
    if (snapshot.exists()) toPacks(snapshot)
    else callback({})
  }, error => onError?.(error))
  return () => unsubscribePublished()
}

export const subscribeWorkspacePack = (workspaceId: string, packId: string, callback: (value: ContentPack | null) => void, onError?: (error: Error) => void) => {
  if (!db || !workspaceId) return () => undefined
  const currentDb = db
  const canonical = ref(currentDb, `workspaces/${workspaceId}/workspacePacks/${packId}`)
  let stopLegacy: () => void = () => undefined
  const stopCanonical = onValue(canonical, snapshot => {
    const pack = normalizeContentPack(snapshot.val(), builtInQuestions, { workspaceId, packId, templateOrigin: 'workspace' })
    if (pack) { stopLegacy(); callback(pack); return }
    // Legacy root is read-only compatibility only. It is intentionally never
    // merged with canonical data, so duplicates cannot be created by a read.
    stopLegacy()
    stopLegacy = onValue(ref(currentDb, `workspacePacks/${workspaceId}/${packId}`), legacy => callback(normalizeContentPack(legacy.val(), builtInQuestions, { workspaceId, packId, templateOrigin: 'workspace' })), error => onError?.(error))
  }, error => onError?.(error))
  return () => { stopCanonical(); stopLegacy() }
}

/** Quiz copies live under the workspace document, unlike the legacy diagnostic editor path. */
export const subscribeWorkspaceQuizPacks = (workspaceId: string, callback: (value: Record<string, ContentPack>) => void, onError?: (error: Error) => void) => {
  if (!db || !workspaceId) { callback({}); return () => undefined }
  return onValue(ref(db, `workspaces/${workspaceId}/workspacePackPublics`), snapshot => {
    const raw = (snapshot.val() || {}) as Record<string, unknown>
    const packs = Object.fromEntries(Object.entries(raw).flatMap(([packId, value]) => {
      const pack = normalizeContentPack(value, [], { packId, workspaceId, templateOrigin: 'workspace', mode: 'quiz' })
      return pack?.mode === 'quiz' ? [[packId, pack]] : []
    })) as Record<string, ContentPack>
    callback(packs)
  }, error => onError?.(error))
}

export type QuizPackCopyResult = {
  pack: ContentPack
  /** `existing` is a successful, idempotent result — never an error. */
  outcome: 'copied' | 'existing'
}

const quizCopyError = (error: unknown) => {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''
  if (code.includes('unauthenticated')) return new Error('Сеанс ведущего истёк. Войдите снова и повторите добавление набора.')
  if (code.includes('permission')) return new Error('Firebase отклонил добавление: этот workspace не принадлежит текущему активному ведущему.')
  if (code.includes('failed-precondition')) return new Error('Опубликованный набор викторины недоступен или неполный.')
  return error instanceof Error && error.message
    ? new Error(`Не удалось добавить набор в workspace: ${error.message}`)
    : new Error('Не удалось добавить набор в workspace. Повторите попытку.')
}

const quizRoomError = (error: unknown) => {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''
  if (code.includes('unauthenticated')) return new Error('Сеанс ведущего истёк. Войдите снова и повторите создание викторины.')
  if (code.includes('permission')) return new Error('Firebase отклонил создание викторины: workspace не принадлежит текущему активному ведущему.')
  if (code.includes('already-exists')) return new Error('Комната с этим кодом уже создана. Обновите страницу, чтобы открыть её.')
  if (code.includes('failed-precondition')) return new Error('Выбранный набор викторины недоступен, не опубликован или не содержит серверных ключей ответов.')
  return error instanceof Error && error.message
    ? new Error(`Не удалось безопасно создать комнату викторины: ${error.message}`)
    : new Error('Не удалось безопасно создать комнату викторины. Повторите попытку.')
}

/** Creates an immutable workspace copy of a published quiz pack once per leader. */
export const copyQuizPackToWorkspace = async (workspaceId: string, sourcePackId: string): Promise<QuizPackCopyResult> => {
  const services = requireFirebase()
  await authPersistence
  const user = services.auth.currentUser
  if (!user || user.isAnonymous) throw new Error('Войдите как ведущий, чтобы добавить набор в workspace.')
  const [profileSnapshot, workspaceSnapshot, existingSnapshot] = await Promise.all([
    get(ref(services.db, `users/${user.uid}`)),
    get(ref(services.db, `workspaces/${workspaceId}`)),
    get(ref(services.db, `workspaces/${workspaceId}/workspacePackPublics/${sourcePackId}`)),
  ])
  const profile = profileSnapshot.val() as LeaderProfile | null
  const workspace = workspaceSnapshot.val() as Workspace | null
  if (!profile || profile.workspaceId !== workspaceId || workspace?.ownerUid !== user.uid) throw new Error('Этот workspace не принадлежит текущему ведущему.')
  const existing = existingSnapshot.exists()
    ? normalizeContentPack(existingSnapshot.val(), [], { packId: sourcePackId, workspaceId, templateOrigin: 'workspace', mode: 'quiz' })
    : null
  // A personal copy is never silently overwritten by an upstream global update.
  if (existing) return { pack: existing, outcome: 'existing' }
  if (!functions) throw new Error('Сервис безопасного копирования викторины недоступен.')
  try {
    const result = await httpsCallable(functions, 'copyQuizPackToWorkspace')({ workspaceId, sourcePackId })
    const copiedSnapshot = await get(ref(services.db, `workspaces/${workspaceId}/workspacePackPublics/${sourcePackId}`))
    const copied = normalizeContentPack(copiedSnapshot.val(), [], { packId: sourcePackId, workspaceId, templateOrigin: 'workspace', mode: 'quiz' })
    if (!copied) throw new Error('Копия набора не появилась в рабочем пространстве.')
    const outcome = result.data && typeof result.data === 'object' && 'copied' in result.data && result.data.copied === false
      ? 'existing'
      : 'copied'
    return { pack: copied, outcome }
  } catch (error) {
    // A response can be lost after the callable has atomically created the
    // copy. Re-read the safe projection before reporting failure, so retrying
    // never creates a misleading error or a duplicate workspace pack.
    const reconciledSnapshot = await get(ref(services.db, `workspaces/${workspaceId}/workspacePackPublics/${sourcePackId}`)).catch(() => null)
    const reconciled = reconciledSnapshot && normalizeContentPack(reconciledSnapshot.val(), [], { packId: sourcePackId, workspaceId, templateOrigin: 'workspace', mode: 'quiz' })
    if (reconciled) return { pack: reconciled, outcome: 'existing' }
    console.error('quiz pack copy rejected', { workspaceId, sourcePackId, uid: user.uid, error })
    throw quizCopyError(error)
  }
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
  const editingUnavailable = 'Редактирование вопросов будет доступно после выпуска полноценного приложения.'
  if (!existing) throw new Error(editingUnavailable)
  const existingQuestions = existing.questions?.length ? existing.questions : existing.content.questions
  const draftQuestions = draft.questions?.length ? draft.questions : draft.content.questions
  if (JSON.stringify(existingQuestions) !== JSON.stringify(draftQuestions)) throw new Error(editingUnavailable)
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
  // The private source is owner-only. Leaders receive the separate sanitized
  // projection from /publishedPacks and therefore never download quiz keys.
  await update(ref(services.db), {
    [`globalPacks/${pack.packId}`]: pack,
    [`publishedPacks/${pack.packId}`]: buildPublishedPack(pack),
  })
  return pack
}

/** Publishes safe leader-facing projections after protected quiz-pack import.
 * It never creates starter content in the browser and never exposes answer keys. */
export const publishSafePackCatalogueAsOwner = async () => {
  const services = requireFirebase()
  await authPersistence
  if (!services.auth.currentUser || services.auth.currentUser.isAnonymous || !await isPlatformOwner()) {
    throw new Error('Недостаточно прав владельца платформы.')
  }
  if (!functions) throw new Error('Сервис безопасной публикации каталога недоступен.')
  try {
    const result = await httpsCallable<unknown, { synchronized?: number }>(functions, 'syncPublishedPacks')()
    return Math.max(0, Number(result.data?.synchronized) || 0)
  } catch (reason) {
    const code = typeof reason === 'object' && reason && 'code' in reason ? String(reason.code) : ''
    console.error('safe pack catalogue publication rejected', { uid: services.auth.currentUser.uid, code, reason })
    throw new Error(code.includes('permission')
      ? 'Firebase отклонил публикацию каталога: требуется Custom Claim platformAdmin: true.'
      : 'Не удалось опубликовать безопасные версии наборов. Повторите попытку.')
  }
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
  await update(ref(services.db), {
    [`globalPacks/${diagnosticPackId}`]: pack,
    [`publishedPacks/${diagnosticPackId}`]: buildPublishedPack(pack),
  })
  return pack
}

const assertRoomCreationAccess = async (hostUid: string, workspaceId: string, productId = diagnosticProductId) => {
  const services = requireFirebase()
  const platformOwner = await isPlatformOwner()
  const needsLegacyDiagnosticAccess = productId === diagnosticProductId
  const [profileSnapshot, workspaceSnapshot, workspaceProductSnapshot, legacyWorkspaceProductSnapshot, productSnapshot] = await Promise.all([
    get(ref(services.db, `users/${hostUid}`)),
    get(ref(services.db, `workspaces/${workspaceId}`)),
    get(ref(services.db, `workspaceProducts/${workspaceId}/${productId}`)),
    needsLegacyDiagnosticAccess
      ? get(ref(services.db, `workspaceProducts/${workspaceId}/${legacyDiagnosticProductId}`))
      : Promise.resolve(null),
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
    workspaceProduct: (workspaceProductSnapshot.val() || legacyWorkspaceProductSnapshot?.val()) as WorkspaceProduct | null,
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
    lastActivityAt: createdAt,
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
    snapshotId: `${template.templateOrigin}:${template.packId}:v${template.packVersion}:${createdAt}`,
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
  const effectiveSelection = templateSelection
  if (mode === 'quiz' && effectiveSelection.templateSource !== 'workspace') {
    throw new Error('Для викторины сначала добавьте опубликованный набор в свой workspace.')
  }
  await assertRoomCreationAccess(hostUid, workspaceId, mode === 'quiz' ? quizProductId : diagnosticProductId)
  if (mode === 'quiz') {
    if (!functions) throw new Error('Сервис безопасного создания викторины недоступен.')
    try {
      await httpsCallable(functions, 'createQuizRoom')({
        roomId,
        workspaceId,
        packId: effectiveSelection.selectedPackId,
        roomTitle,
        pilotDetails: { ...pilotDetails, mode: 'quiz' },
      })
      const created = await get(ref(services.db, roomPath(roomId)))
      if (!created.exists()) throw new Error('Сервер не вернул созданную комнату викторины.')
      return created.val() as Session
    } catch (reason) {
      const code = typeof reason === 'object' && reason && 'code' in reason ? String(reason.code) : ''
      console.error('secure quiz room creation rejected', { roomId, workspaceId, packId: effectiveSelection.selectedPackId, code, reason })
      throw quizRoomError(reason)
    }
  }
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
  const [publicSnapshot, participantQuestionsSnapshot] = await Promise.all([
    get(ref(services.db, publicRoomPath(roomId))),
    get(ref(services.db, participantQuestionsPath(roomId))),
  ])
  const patch: Record<string, unknown> = {}
  const existingPublicRoom = publicSnapshot.val() as PublicRoom | null
  const publicMode = resolveRegisteredRoomMode(existingPublicRoom?.mode || existingPublicRoom?.gameTypeId)
  if (!publicSnapshot.exists()) patch[publicRoomPath(roomId)] = createPublicRoom(session)
  else if (!publicMode) patch[`${publicRoomPath(roomId)}/mode`] = roomModeForPublicProjection(session)
  // Wheel rooms do not use question packs. Writing an empty participant question
  // set would be rejected by the immutable question-set rules and is unnecessary.
  if (roomModeForPublicProjection(session) !== 'wheel' && !participantQuestionsSnapshot.exists()) patch[participantQuestionsPath(roomId)] = createParticipantQuestionSet(session)
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
    await set(ref(services.db, `sessions/${roomId}/lastActivityAt`), Date.now())
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
  if (services.session.phase === 'closed') {
    if (phase === 'closed') return
    throw new Error('Завершённую сессию нельзя запустить повторно.')
  }
  const timestamp = Date.now()
  const participantCount = Object.keys(services.session.participants || {}).length
  const completedCount = Object.values(services.session.participants || {}).filter(participant => participant.status === 'finished').length
  const eventType: SessionEventType | null = phase === 'live' ? 'room_started' : phase === 'closed' ? 'room_closed' : null
  const event: SessionEvent | null = eventType ? { id: eventType, type: eventType, roomId, ...(services.session.workspaceId ? { workspaceId: services.session.workspaceId } : {}), hostUid: services.session.hostUid, createdAt: timestamp } : null
  await ensureParticipantRoomData(roomId, services.session)
  const activityPatch = { [`sessions/${roomId}/lastActivityAt`]: timestamp, [`${publicRoomPath(roomId)}/lastActivityAt`]: timestamp }
  const patch: Record<string, unknown> = phase === 'resultsIntro'
    ? { ...activityPatch, [`sessions/${roomId}/phase`]: phase, [`sessions/${roomId}/status`]: phase, [`sessions/${roomId}/resultsIntroStartedAt`]: timestamp, [`${publicRoomPath(roomId)}/phase`]: phase }
    : phase === 'closed'
      ? { ...activityPatch, [`sessions/${roomId}/phase`]: 'closed', [`sessions/${roomId}/status`]: 'closed', [`sessions/${roomId}/closedAt`]: timestamp, [`sessions/${roomId}/endedAt`]: timestamp, [`sessions/${roomId}/participantCount`]: participantCount, [`sessions/${roomId}/completedCount`]: completedCount, [`sessions/${roomId}/events/${event?.id}`]: event, [`${publicRoomPath(roomId)}/phase`]: 'closed', [`${publicRoomPath(roomId)}/closedAt`]: timestamp, [`${publicRoomPath(roomId)}/endedAt`]: timestamp }
      : phase === 'live'
        ? { ...activityPatch, [`sessions/${roomId}/phase`]: phase, [`sessions/${roomId}/status`]: phase, [`sessions/${roomId}/startedAt`]: services.session.startedAt || timestamp, [`sessions/${roomId}/participantCount`]: participantCount, [`sessions/${roomId}/completedCount`]: completedCount, [`sessions/${roomId}/events/${event?.id}`]: event, [`${publicRoomPath(roomId)}/phase`]: phase }
        : { ...activityPatch, [`sessions/${roomId}/phase`]: phase, [`sessions/${roomId}/status`]: phase, [`${publicRoomPath(roomId)}/phase`]: phase }
  await update(ref(services.db), patch)
}

/** A deliberate host operation extends a room. Passive page views never call this. */
export const touchSessionActivity = async (roomId: string, expectedHostUid?: string) => {
  const services = await assertCurrentUserIsRoomHost(roomId, expectedHostUid)
  if (services.session.phase === 'closed') return
  const timestamp = Date.now()
  await update(ref(services.db), {
    [`sessions/${roomId}/lastActivityAt`]: timestamp,
    [`${publicRoomPath(roomId)}/lastActivityAt`]: timestamp,
  })
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
  if (services.session.phase !== 'lobby') throw new Error('После запуска режима название комнаты изменить нельзя.')
  const cleanTitle = roomTitle.trim().slice(0, 80)
  if (!cleanTitle) throw new Error('Введите название комнаты.')
  await ensureParticipantRoomData(roomId, services.session)
  const timestamp = Date.now()
  await update(ref(services.db), { [`sessions/${roomId}/roomTitle`]: cleanTitle, [`${publicRoomPath(roomId)}/roomTitle`]: cleanTitle, [`sessions/${roomId}/lastActivityAt`]: timestamp, [`${publicRoomPath(roomId)}/lastActivityAt`]: timestamp })
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

export const saveWorkspacePack = async (_workspaceId: string, _questionSet: Question[], _title = 'Проверь себя') => {
  throw new Error('Редактирование вопросов будет доступно после выпуска полноценного приложения.')
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
  if (publicRoom.phase !== 'live') throw new Error(publicRoom.phase === 'closed' ? 'Сессия завершена ведущим. Ответы больше не принимаются.' : 'Режим ещё не запущен.')
  const storedParticipant = participantSnapshot.val() as Participant | null
  if (!storedParticipant) throw new Error('Участник не найден в комнате. Подключитесь заново.')
  if (storedParticipant.id !== currentUser.uid) throw new Error('Participant record does not belong to the current Firebase user.')
  if (publicRoom.mode === 'quiz') {
    if (answer === 'SKIP') throw new Error('В викторине нельзя пропустить вопрос.')
    if (!functions) throw new Error('Проверка викторины временно недоступна.')
    try {
      const result = await httpsCallable(functions, 'submitQuizAnswer')({ roomId, questionId, answer })
      const data = result.data as { nextIndex?: number; status?: Participant['status'] }
      const refreshed = await get(ref(services.db, roomParticipantPath(roomId, participant.id)))
      const next = refreshed.val() as Participant | null
      if (!next || next.currentQuestionIndex !== data.nextIndex) throw new Error('Ответ не был подтверждён сервером.')
      return next
    } catch (error) {
      console.error('quiz answer rejected by trusted handler', { roomId, participantId: participant.id, questionId, error })
      throw new Error('Ответ не сохранён. Проверьте подключение к викторине и попробуйте ещё раз.')
    }
  }
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
    ...(next.completedAt ? { [`sessions/${roomId}/participants/${participant.id}/completedAt`]: next.completedAt } : {}),
    [`sessions/${roomId}/lastActivityAt`]: Date.now(),
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
