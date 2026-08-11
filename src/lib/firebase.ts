import { initializeApp } from 'firebase/app'
import { browserLocalPersistence, createUserWithEmailAndPassword, deleteUser, getAuth, onAuthStateChanged, setPersistence, signInAnonymously, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth'
import { get, getDatabase, onValue, push, ref, set, update } from 'firebase/database'
import { questions as builtInQuestions } from '../data/questions'
import { canUseFeature } from './access'
import { diagnosticGameModule, getGameModule } from './gameRegistry'
import { orderQuestionsByCategory } from './questionOrder'
import type { Answer, ContentPack, FeedbackItem, Invite, LeaderProfile, Participant, ProductConfig, Question, ResponseValue, RoomLobby, Session, SessionArchive, SessionPhase, TemplateSelection, TemplateSnapshot, UserStatus, Workspace, WorkspaceProduct } from '../types'

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

const createRoomLobby = (session: Session): RoomLobby => ({
  roomId: session.roomId,
  ...(session.roomTitle ? { roomTitle: session.roomTitle } : {}),
  ...(session.displayCode ? { displayCode: session.displayCode } : {}),
  hostUid: session.hostUid,
  workspaceId: session.workspaceId || '',
  phase: session.phase,
  maxParticipants: session.maxParticipants,
  createdAt: session.createdAt,
  ...(session.closedAt ? { closedAt: session.closedAt } : {}),
})

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
  version: source?.version || source?.packVersion || diagnosticPackVersion,
  packVersion: source?.packVersion || source?.version || diagnosticPackVersion,
  status: source?.status || 'active',
  ...(source?.sourcePackId ? { sourcePackId: source.sourcePackId } : {}),
  templateOrigin: source?.templateOrigin || 'system',
  title: source?.title || 'Диагностика атмосферы молодёжи',
  content: { questions: copyQuestions(orderQuestionsByCategory(source?.content?.questions?.length ? source.content.questions : questionSet)) },
  settings: copySettings(source?.settings || { maxParticipants: 30, skippedAnswerScore: -1 }),
  ruleConfig: getGameModule(source?.gameTypeId).normalizeRuleConfig(source?.ruleConfig),
  contentSchemaVersion: source?.contentSchemaVersion || getGameModule(source?.gameTypeId).contentSchemaVersion,
  ...(source?.workspaceId ? { workspaceId: source.workspaceId } : {}),
  ...(source?.updatedAt ? { updatedAt: source.updatedAt } : {}),
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
    version: raw.version || raw.packVersion || defaults.version || defaults.packVersion || diagnosticPackVersion,
    packVersion: raw.packVersion || raw.version || defaults.packVersion || defaults.version || diagnosticPackVersion,
    status: raw.status || defaults.status || 'active',
    ...(raw.sourcePackId || defaults.sourcePackId ? { sourcePackId: raw.sourcePackId || defaults.sourcePackId } : {}),
    templateOrigin: raw.templateOrigin || defaults.templateOrigin || 'system',
    title: raw.title || defaults.title || 'Диагностика атмосферы молодёжи',
    content: { questions: copyQuestions(orderQuestionsByCategory(questionSet.length ? questionSet : fallbackQuestions)) },
    settings: copySettings(raw.settings || defaults.settings || { maxParticipants: 30, skippedAnswerScore: -1 }),
    ruleConfig: getGameModule(raw.gameTypeId || defaults.gameTypeId).normalizeRuleConfig(raw.ruleConfig || defaults.ruleConfig),
    contentSchemaVersion: raw.contentSchemaVersion || defaults.contentSchemaVersion || getGameModule(raw.gameTypeId || defaults.gameTypeId).contentSchemaVersion,
    ...(raw.workspaceId || defaults.workspaceId ? { workspaceId: raw.workspaceId || defaults.workspaceId } : {}),
    ...(raw.createdAt || defaults.createdAt ? { createdAt: raw.createdAt || defaults.createdAt } : {}),
    ...(raw.updatedAt || defaults.updatedAt ? { updatedAt: raw.updatedAt || defaults.updatedAt } : {}),
    ...(raw.createdBy || defaults.createdBy ? { createdBy: raw.createdBy || defaults.createdBy } : {}),
  }
}

/** Resolves the selected source for a new room. Legacy fallback is intentionally not used here. */
export const resolveDiagnosticTemplate = async (workspaceId?: string, selection: TemplateSelection = defaultDiagnosticTemplateSelection): Promise<TemplateSnapshot> => {
  if (!db) return createDiagnosticTemplateSnapshot(builtInQuestions)
  const candidates: Array<{ path: string; defaults: Partial<ContentPack> }> = selection.templateSource === 'workspace' && workspaceId
    ? [{ path: `workspacePacks/${workspaceId}/${selection.selectedPackId}`, defaults: { workspaceId, packId: selection.selectedPackId, templateOrigin: 'workspace' } }]
    : [{ path: `globalPacks/${selection.selectedPackId}`, defaults: { packId: selection.selectedPackId, templateOrigin: 'system' } }]
  for (const candidate of candidates) {
    try {
      const snapshot = await get(ref(db, candidate.path))
      const pack = normalizeContentPack(snapshot.val(), [], candidate.defaults)
      if (pack?.status === 'active') return createDiagnosticTemplateSnapshot(pack.content.questions, pack)
    } catch {
      // The selected source is unavailable. Do not silently switch pack origins.
    }
  }
  throw new Error('Выбранный набор недоступен или не активен. Выберите другой набор и попробуйте ещё раз.')
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
  if (!db) return () => undefined
  return onValue(ref(db, `sessions/${roomId}`), snapshot => callback(snapshot.val()), error => onError?.(error))
}

/** Join-safe metadata: it intentionally contains no questions, participants or answers. */
export const subscribeRoomLobby = (roomId: string, callback: (value: RoomLobby | null) => void, onError?: (error: Error) => void) => {
  if (!db) return () => undefined
  return onValue(ref(db, `roomLobbies/${roomId}`), snapshot => callback((snapshot.val() || null) as RoomLobby | null), error => onError?.(error))
}

export const subscribeGlobalPack = (packId: string, callback: (value: ContentPack | null) => void, onError?: (error: Error) => void) => {
  if (!db) return () => undefined
  return onValue(ref(db, `globalPacks/${packId}`), snapshot => callback(normalizeContentPack(snapshot.val(), builtInQuestions, { packId, templateOrigin: 'system' })), error => onError?.(error))
}

export const subscribeWorkspacePack = (workspaceId: string, packId: string, callback: (value: ContentPack | null) => void, onError?: (error: Error) => void) => {
  if (!db || !workspaceId) return () => undefined
  return onValue(ref(db, `workspacePacks/${workspaceId}/${packId}`), snapshot => callback(normalizeContentPack(snapshot.val(), builtInQuestions, { workspaceId, packId, templateOrigin: 'workspace' })), error => onError?.(error))
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
      return pack ? [[packId, pack]] : []
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
    Object.values(sessions).filter(session => session.hostUid === uid && session.phase !== 'closed').forEach(session => {
      const closed: SessionArchive = { ...session, phase: 'closed', closedAt: now, archivedAt: now }
      patch[`sessions/${session.roomId}/phase`] = 'closed'
      patch[`sessions/${session.roomId}/closedAt`] = now
      patch[`roomLobbies/${session.roomId}/phase`] = 'closed'
      patch[`roomLobbies/${session.roomId}/closedAt`] = now
      patch[`sessionArchives/${session.roomId}`] = closed
      if (session.workspaceId) patch[`workspaceArchives/${session.workspaceId}/${session.roomId}`] = closed
    })
  }
  await update(ref(services.db), patch)
}

export const saveGlobalPackAsOwner = async (draft: ContentPack) => {
  const services = requireFirebase()
  await authPersistence
  if (!await isPlatformOwner()) throw new Error('Недостаточно прав владельца платформы.')
  const now = Date.now()
  const existingSnapshot = await get(ref(services.db, `globalPacks/${draft.packId}`))
  const existing = normalizeContentPack(existingSnapshot.val(), builtInQuestions, { packId: draft.packId, templateOrigin: 'system' })
  const nextVersion = Math.max(1, (existing?.version || existing?.packVersion || 0) + 1)
  const pack: ContentPack = {
    ...draft,
    productId: draft.productId || diagnosticProductId,
    gameTypeId: draft.gameTypeId || diagnosticGameTypeId,
    packId: draft.packId,
    version: nextVersion,
    packVersion: nextVersion,
    templateOrigin: 'system',
    content: { questions: copyQuestions(orderQuestionsByCategory(draft.content.questions)) },
    settings: copySettings(draft.settings),
    ruleConfig: getGameModule(draft.gameTypeId || diagnosticGameTypeId).normalizeRuleConfig(draft.ruleConfig),
    contentSchemaVersion: draft.contentSchemaVersion || diagnosticGameModule.contentSchemaVersion,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    createdBy: existing?.createdBy || services.auth.currentUser?.uid,
  }
  await set(ref(services.db, `globalPacks/${pack.packId}`), pack)
  return pack
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
  const pack: ContentPack = {
    productId: diagnosticProductId,
    gameTypeId: diagnosticGameTypeId,
    packId: diagnosticPackId,
    version: diagnosticPackVersion,
    packVersion: diagnosticPackVersion,
    status: 'active',
    templateOrigin: 'system',
    title: 'Диагностика атмосферы молодёжи',
    content: { questions: copyQuestions(builtInQuestions) },
    settings: { maxParticipants: 30, skippedAnswerScore: -1 },
    ruleConfig: diagnosticGameModule.defaultRuleConfig,
    contentSchemaVersion: diagnosticGameModule.contentSchemaVersion,
    createdAt: now,
    updatedAt: now,
    createdBy: user.uid,
  }
  await set(ref(services.db, `globalPacks/${diagnosticPackId}`), pack)
  return pack
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

export const defaultRoomTitle = (createdAt = Date.now()) => `Встреча молодёжки · ${new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(new Date(createdAt))}`

export const createSessionRecord = (roomId: string, hostUid: string, questionSet: Question[] = builtInQuestions, workspaceId?: string, templateSnapshot?: TemplateSnapshot, templateSelection?: TemplateSelection, roomTitle?: string): Session => {
  const template = templateSnapshot || createDiagnosticTemplateSnapshot(questionSet)
  const selection = templateSelection || { selectedPackId: template.packId, templateSource: template.templateOrigin }
  const createdAt = Date.now()
  const cleanTitle = roomTitle?.trim().slice(0, 80) || defaultRoomTitle(createdAt)
  return {
    roomId,
    roomTitle: cleanTitle,
    displayCode: roomId,
    createdAt,
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

export const createSession = async (roomId: string, hostUid: string, questionSet?: Question[], workspaceId?: string, templateSelection: TemplateSelection = defaultDiagnosticTemplateSelection, roomTitle?: string) => {
  if (!db) throw new Error('Firebase не настроен')
  if (!workspaceId) throw new Error('Для создания комнаты нужно рабочее пространство.')
  await assertRoomCreationAccess(hostUid, workspaceId)
  const template = await resolveDiagnosticTemplate(workspaceId, templateSelection)
  const session = createSessionRecord(roomId, hostUid, questionSet, workspaceId, template, templateSelection, roomTitle)
  // The lobby is the only pre-join readable record. It contains no questions,
  // participants, or answers from another workspace.
  await update(ref(db), {
    [`sessions/${roomId}`]: session,
    [`roomLobbies/${roomId}`]: createRoomLobby(session),
  })
  return session
}

export const joinSession = async (roomId: string, participant: Participant) => {
  const services = requireFirebase()
  await authPersistence
  if (!services.auth.currentUser) throw new Error('Firebase user is not ready.')
  if (services.auth.currentUser.uid !== participant.id) throw new Error('Participant identity does not match the current Firebase user.')
  if (!services.auth.currentUser.isAnonymous) throw new Error('Откройте ссылку участника в отдельном браузере или в режиме инкогнито.')
  const [lobbySnapshot, participantSnapshot] = await Promise.all([
    get(ref(services.db, `roomLobbies/${roomId}`)),
    get(ref(services.db, `sessions/${roomId}/participants/${participant.id}`)),
  ])
  const lobby = lobbySnapshot.val() as RoomLobby | null
  if (!lobby) throw new Error('Комната не найдена или больше недоступна.')
  if (lobby.phase === 'closed') throw new Error('Сессия завершена ведущим. Подключение больше недоступно.')
  if (participantSnapshot.exists()) return
  try {
    await set(ref(services.db, `sessions/${roomId}/participants/${participant.id}`), participant)
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
  const patch = phase === 'resultsIntro'
    ? { [`sessions/${roomId}/phase`]: phase, [`sessions/${roomId}/resultsIntroStartedAt`]: timestamp, [`roomLobbies/${roomId}/phase`]: phase }
    : phase === 'closed'
      ? { [`sessions/${roomId}/phase`]: 'closed', [`sessions/${roomId}/closedAt`]: timestamp, [`roomLobbies/${roomId}/phase`]: 'closed', [`roomLobbies/${roomId}/closedAt`]: timestamp }
      : { [`sessions/${roomId}/phase`]: phase, [`roomLobbies/${roomId}/phase`]: phase }
  await update(ref(services.db), patch)
}

/** The title is editable only while the room is still waiting for participants. */
export const updateRoomTitle = async (roomId: string, roomTitle: string, expectedHostUid?: string) => {
  const services = await assertCurrentUserIsRoomHost(roomId, expectedHostUid)
  if (services.session.phase !== 'lobby') throw new Error('После запуска диагностики название комнаты изменить нельзя.')
  const cleanTitle = roomTitle.trim().slice(0, 80)
  if (!cleanTitle) throw new Error('Введите название комнаты.')
  await update(ref(services.db), { [`sessions/${roomId}/roomTitle`]: cleanTitle, [`roomLobbies/${roomId}/roomTitle`]: cleanTitle })
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
  const packPath = `workspacePacks/${workspaceId}/${diagnosticPackId}`
  const currentSnapshot = await get(ref(services.db, packPath))
  const current = normalizeContentPack(currentSnapshot.val(), builtInQuestions, { workspaceId, packId: diagnosticPackId, templateOrigin: 'workspace' })
  const now = Date.now()
  const pack: ContentPack = {
    productId: diagnosticProductId,
    gameTypeId: diagnosticGameTypeId,
    packId: diagnosticPackId,
    version: Math.max(diagnosticPackVersion, (current?.version || current?.packVersion || diagnosticPackVersion - 1) + 1),
    packVersion: Math.max(diagnosticPackVersion, (current?.version || current?.packVersion || diagnosticPackVersion - 1) + 1),
    status: 'active',
    sourcePackId: current?.sourcePackId || diagnosticPackId,
    templateOrigin: 'workspace',
    workspaceId,
    title: current?.title || title,
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
  if (!db) throw new Error('Firebase is not configured')
  const services = await assertCurrentUserIsRoomHost(roomId)
  const snapshot = createDiagnosticTemplateSnapshot(questionSet, services.session.templateSnapshot)
  await update(ref(db, `sessions/${roomId}`), { questions: copyQuestions(questionSet), templateSnapshot: snapshot, packVersion: snapshot.packVersion })
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
  // Write the owned leaves directly. The Rules grant a participant access only
  // to their own answer/status fields, never the participant collection.
  await update(ref(services.db), {
    [`sessions/${roomId}/participants/${participant.id}/answers/${questionId}`]: answer,
    [`sessions/${roomId}/participants/${participant.id}/currentQuestionIndex`]: next.currentQuestionIndex,
    [`sessions/${roomId}/participants/${participant.id}/status`]: next.status,
    ...(next.completedAt ? { [`sessions/${roomId}/participants/${participant.id}/completedAt`]: next.completedAt } : {})
  })
  return next
}

export const markPersonalViewed = async (roomId: string, participantId: string) => {
  const services = requireFirebase()
  await authPersistence
  if (!services.auth.currentUser || services.auth.currentUser.uid !== participantId) throw new Error('Participant identity does not match the current Firebase user.')
  await set(ref(services.db, `sessions/${roomId}/participants/${participantId}/personalViewedAt`), Date.now())
}
