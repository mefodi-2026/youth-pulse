const { initializeApp, getApps } = require('firebase-admin/app')
const { getDatabase } = require('firebase-admin/database')
const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { logger } = require('firebase-functions')
const { setGlobalOptions } = require('firebase-functions/v2')
const { existingQuizAnswer } = require('./quizAnswerPolicy')

const ROOM_DATABASE_URL = 'https://molodeh-c523e-default-rtdb.europe-west1.firebasedatabase.app'
const ROOM_DATABASE_APP = 'room-data'

// The Functions runtime can initialize its own default Admin app before this
// module loads.  Never reuse that opaque instance for room data: it may be
// configured for another database endpoint.  A named app binds every callable
// in this module to the same regional RTDB as the published browser.
const roomDatabaseApp = getApps().find(app => app.name === ROOM_DATABASE_APP)
  || initializeApp({ databaseURL: ROOM_DATABASE_URL }, ROOM_DATABASE_APP)
setGlobalOptions({ region: 'europe-west1', maxInstances: 10 })

const db = getDatabase(roomDatabaseApp)
const asObject = value => value && typeof value === 'object' ? value : {}
const publicQuestions = questions => Object.values(asObject(questions)).map(question => ({
  id: question.id,
  category: question.category,
  ...(question.categoryOrder != null ? { categoryOrder: question.categoryOrder } : {}),
  title: question.title,
  options: question.options,
}))
const privateQuestions = questions => Object.values(asObject(questions)).map(question => ({
  id: question.id,
  ...(question.correctAnswer ? { correctAnswer: question.correctAnswer } : {}),
  ...(question.explanation ? { explanation: question.explanation } : {}),
}))
const byQuestionId = (questions, questionId) => Object.values(asObject(questions)).find(question => question?.id === questionId)
const ROOM_INACTIVITY_MS = 10 * 60 * 1000
const roomActivityAt = room => Number(room?.lastActivityAt || room?.createdAt || 0)
const isExpiredRoom = (room, at = Date.now()) => at - roomActivityAt(room) >= ROOM_INACTIVITY_MS
const publicPack = source => {
  const sourceQuestions = source.questions || source.content?.questions || source.publicContent?.questions || {}
  const questions = publicQuestions(sourceQuestions)
  return {
    productId: source.productId || 'bible-quiz', gameTypeId: 'quiz', mode: 'quiz',
    packId: source.packId, version: source.version || source.packVersion || 1,
    packVersion: source.packVersion || source.version || 1, status: source.status || 'published',
    templateOrigin: 'workspace', sourcePackId: source.sourcePackId || source.packId,
    title: source.title || 'Библейская викторина', description: source.description || '',
    questions, content: { questions }, publicContent: { questions },
    settings: source.settings || {}, ruleConfig: source.ruleConfig || {},
    contentSchemaVersion: source.contentSchemaVersion || 1, workspaceId: source.workspaceId,
    createdAt: source.createdAt, updatedAt: source.updatedAt,
    sourcePackVersion: source.sourcePackVersion, copiedBy: source.copiedBy, copiedAt: source.copiedAt,
  }
}

/** Copy a published quiz into the caller's own workspace without exposing
 * correct answers to the leader browser. Existing copies are never overwritten. */
exports.copyQuizPackToWorkspace = onCall(async request => {
  const uid = request.auth?.uid
  const { workspaceId, sourcePackId } = request.data || {}
  if (!uid) throw new HttpsError('unauthenticated', 'Требуется вход ведущего.')
  if (!workspaceId || !sourcePackId) throw new HttpsError('invalid-argument', 'Не указан workspace или набор.')
  const [userSnap, workspaceSnap, sourceSnap, existingSnap] = await Promise.all([
    db.ref(`users/${uid}`).once('value'),
    db.ref(`workspaces/${workspaceId}`).once('value'),
    db.ref(`globalPacks/${sourcePackId}`).once('value'),
    db.ref(`workspaces/${workspaceId}/workspacePacks/${sourcePackId}`).once('value'),
  ])
  const user = userSnap.val()
  const workspace = workspaceSnap.val()
  const source = sourceSnap.val()
  if (!user || user.status !== 'active' || user.workspaceId !== workspaceId || !workspace || workspace.ownerUid !== uid) {
    throw new HttpsError('permission-denied', 'Этот workspace недоступен текущему ведущему.')
  }
  if (!source || source.status !== 'published' || source.mode !== 'quiz') {
    throw new HttpsError('failed-precondition', 'Опубликованный набор викторины не найден.')
  }
  if (existingSnap.exists()) {
    const existing = existingSnap.val()
    await db.ref(`workspaces/${workspaceId}/workspacePackPublics/${sourcePackId}`).set(publicPack(existing))
    return { copied: false, packId: sourcePackId }
  }
  const sourceQuestions = source.questions || source.content?.questions
  if (!sourceQuestions || !Object.keys(sourceQuestions).length) throw new HttpsError('failed-precondition', 'В наборе нет вопросов.')
  const now = Date.now()
  const copy = {
    ...source,
    workspaceId,
    templateOrigin: 'workspace',
    sourcePackId: source.sourcePackId || source.packId,
    sourcePackVersion: source.packVersion || source.version || 1,
    copiedBy: uid,
    copiedAt: now,
    createdBy: uid,
    createdAt: now,
    updatedAt: now,
    publicContent: { questions: publicQuestions(sourceQuestions) },
    privateContent: { questions: privateQuestions(sourceQuestions) },
  }
  // The private server copy and the leader-facing projection form one
  // operation. A single multi-location write prevents a transient half-copy
  // from being interpreted as a successful workspace addition.
  await db.ref().update({
    [`workspaces/${workspaceId}/workspacePacks/${sourcePackId}`]: copy,
    [`workspaces/${workspaceId}/workspacePackPublics/${sourcePackId}`]: publicPack(copy),
  })
  return { copied: true, packId: sourcePackId }
})

/** Creates a quiz room and its private grading material atomically. The
 * browser only supplies a pack identifier and receives the safe room record. */
exports.createQuizRoom = onCall(async request => {
  const uid = request.auth?.uid
  const { roomId, workspaceId, packId, roomTitle, pilotDetails } = request.data || {}
  if (!uid) throw new HttpsError('unauthenticated', 'Требуется вход ведущего.')
  if (!roomId || !workspaceId || !packId) throw new HttpsError('invalid-argument', 'Не указаны параметры комнаты.')
  const [userSnap, workspaceSnap, packSnap, roomSnap] = await Promise.all([
    db.ref(`users/${uid}`).once('value'),
    db.ref(`workspaces/${workspaceId}`).once('value'),
    db.ref(`workspaces/${workspaceId}/workspacePacks/${packId}`).once('value'),
    db.ref(`sessions/${roomId}`).once('value'),
  ])
  const user = userSnap.val(); const workspace = workspaceSnap.val(); const source = packSnap.val()
  if (!user || user.status !== 'active' || user.workspaceId !== workspaceId || !workspace || workspace.ownerUid !== uid) {
    throw new HttpsError('permission-denied', 'Этот workspace недоступен текущему ведущему.')
  }
  if (roomSnap.exists()) throw new HttpsError('already-exists', 'Комната с таким кодом уже существует.')
  if (!source || source.mode !== 'quiz' || source.status !== 'published') throw new HttpsError('failed-precondition', 'Личная копия набора викторины недоступна.')
  const publicCopy = publicPack(source)
  if (!publicCopy.questions.length) throw new HttpsError('failed-precondition', 'В выбранном наборе нет вопросов.')
  const sourceQuestions = source.questions || source.content?.questions || {}
  const keys = source.privateContent?.questions?.length ? source.privateContent.questions : privateQuestions(sourceQuestions)
  if (!keys.length) throw new HttpsError('failed-precondition', 'Для набора не настроены серверные ключи ответов.')
  const now = Date.now()
  const details = asObject(pilotDetails)
  const estimatedParticipants = Math.max(1, Math.min(30, Math.round(Number(details.estimatedParticipants) || 30)))
  const event = { id: 'room_created', type: 'room_created', roomId, workspaceId, hostUid: uid, createdAt: now }
  const session = {
    roomId, roomTitle: String(roomTitle || '').trim().slice(0, 80) || `Встреча молодёжки · ${new Date(now).toLocaleDateString('ru-RU')}`,
    displayCode: roomId, createdAt: now, lastActivityAt: now, phase: 'lobby', status: 'lobby', maxParticipants: 30,
    hostUid: uid, createdBy: uid, workspaceId, groupName: String(details.groupName || workspace.name || ''), city: String(details.city || workspace.city || ''),
    mode: 'quiz', quizPackId: publicCopy.packId, quizPackVersion: publicCopy.packVersion,
    ...(source.difficulty ? { difficulty: source.difficulty } : {}),
    estimatedParticipants, participantCount: 0, completedCount: 0,
    selectedPackId: publicCopy.packId, templateSource: 'workspace', productId: publicCopy.productId,
    gameTypeId: 'quiz', packId: publicCopy.packId, packVersion: publicCopy.packVersion,
    sourcePackId: publicCopy.sourcePackId || publicCopy.packId, packUpdatedAt: publicCopy.updatedAt || now,
    snapshotId: `workspace:${publicCopy.packId}:v${publicCopy.packVersion}:${now}`,
    packSnapshot: { title: publicCopy.title, description: publicCopy.description, questions: publicCopy.questions, settings: publicCopy.settings, ruleConfig: publicCopy.ruleConfig },
    settings: { ...publicCopy.settings, roomMode: 'quiz', estimatedParticipants, quizScoring: 'correct-1-0' },
    templateOrigin: 'workspace', templateSnapshot: { ...publicCopy, capturedAt: now }, questions: publicCopy.questions,
    participants: {}, events: { [event.id]: event },
  }
  const publicRoom = { roomId, roomTitle: session.roomTitle, displayCode: roomId, phase: 'lobby', maxParticipants: 30, createdAt: now, lastActivityAt: now, mode: 'quiz', productId: publicCopy.productId, gameTypeId: 'quiz', packId: publicCopy.packId, packTitle: publicCopy.title, ...(source.difficulty ? { difficulty: source.difficulty } : {}) }
  const participantSet = { roomId, createdAt: now, mode: 'quiz', productId: publicCopy.productId, gameTypeId: 'quiz', packId: publicCopy.packId, packTitle: publicCopy.title, questions: publicCopy.questions }
  await db.ref().update({
    [`sessions/${roomId}`]: session,
    [`publicRooms/${roomId}`]: publicRoom,
    [`roomParticipantQuestions/${roomId}`]: participantSet,
    [`roomPrivateQuestions/${roomId}`]: { roomId, createdAt: now, questions: keys },
  })
  return { roomId }
})

/** Backfills safe leader-facing projections from the owner-only catalogue.
 * Only a platform owner may invoke it; the source keys stay server-side. */
exports.syncPublishedPacks = onCall(async request => {
  if (!request.auth?.token?.platformAdmin) throw new HttpsError('permission-denied', 'Только владелец платформы может синхронизировать каталог.')
  const snapshot = await db.ref('globalPacks').once('value')
  const patch = {}
  snapshot.forEach(child => {
    const pack = child.val()
    if (!pack || pack.status !== 'published') return
    const questions = pack.questions || pack.content?.questions
    if (!questions || !Object.keys(questions).length) return
    patch[`publishedPacks/${child.key}`] = {
      ...pack,
      questions: publicQuestions(questions),
      content: { ...(pack.content || {}), questions: publicQuestions(questions) },
      publicContent: { questions: publicQuestions(questions) },
      privateContent: null,
    }
  })
  if (Object.keys(patch).length) await db.ref().update(patch)
  return { synchronized: Object.keys(patch).length }
})

/** Registers a guest through trusted infrastructure.  The database rules
 * intentionally keep the session root private; this callable is the only
 * writer that can create a participant record after verifying the anonymous
 * Firebase identity, room state, capacity and stable participant key. */
exports.joinRoomAsGuest = onCall(async request => {
  const uid = request.auth?.uid
  const provider = request.auth?.token?.firebase?.sign_in_provider
  const { roomId, nickname } = request.data || {}
  if (!uid || provider !== 'anonymous') throw new HttpsError('permission-denied', 'Для подключения откройте ссылку участника в отдельном браузере или в режиме инкогнито.')
  if (typeof roomId !== 'string' || !/^[A-Z0-9]{6,16}$/.test(roomId)) throw new HttpsError('invalid-argument', 'Некорректный код комнаты.')
  const displayName = String(nickname || '').trim().slice(0, 20)
  if (displayName.length < 2) throw new HttpsError('invalid-argument', 'Введите никнейм от 2 до 20 символов.')

  const roomRef = db.ref(`sessions/${roomId}`)
  // Hydrate the same reference before starting its transaction.  RTDB invokes
  // a transaction callback optimistically with a local null cache before the
  // server snapshot arrives; treating that first invocation as "not found"
  // would abort a real room registration.
  const [publicRoomSnap, initialRoomSnap] = await Promise.all([
    db.ref(`publicRooms/${roomId}`).once('value'),
    roomRef.once('value'),
  ])
  const publicRoom = publicRoomSnap.val()
  if (!publicRoom) {
    logger.warn('Guest room lookup failed', { roomId, source: 'publicRooms', database: ROOM_DATABASE_URL })
    throw new HttpsError('not-found', 'Комната не найдена или больше недоступна.')
  }
  if (publicRoom.phase === 'closed' || isExpiredRoom(publicRoom)) throw new HttpsError('failed-precondition', 'Сессия завершена или срок её активности истёк. Подключение больше недоступно.')
  const initialRoom = initialRoomSnap.val()
  if (!initialRoom || !['diagnostic', 'quiz'].includes(initialRoom.mode)) {
    logger.warn('Guest room lookup failed', { roomId, source: 'sessions', database: ROOM_DATABASE_URL })
    throw new HttpsError('not-found', 'Комната не найдена или больше недоступна.')
  }
  if (initialRoom.phase === 'closed' || isExpiredRoom(initialRoom)) throw new HttpsError('failed-precondition', 'Сессия завершена или срок её активности истёк. Подключение больше недоступно.')
  if (initialRoom.participants?.[uid]) return { participant: initialRoom.participants[uid], reused: true }

  const now = Date.now()
  let failure = null
  let firstTransactionPass = true
  const transaction = await roomRef.transaction(current => {
    // The Admin SDK's first transaction callback has no local cache even after
    // an explicit once(). Use the verified snapshot only for that optimistic
    // pass. A later server retry with null must still abort instead of
    // resurrecting a deleted room.
    const room = !current && firstTransactionPass ? initialRoom : current
    firstTransactionPass = false
    if (!room || !['diagnostic', 'quiz'].includes(room.mode)) { failure = 'not-found'; return }
    if (room.phase === 'closed' || isExpiredRoom(room, now)) { failure = 'closed'; return }
    const participants = asObject(room.participants)
    const currentParticipant = participants[uid]
    if (currentParticipant) return room
    const capacity = Math.max(1, Math.min(30, Number(room.maxParticipants) || 30))
    if (Object.keys(participants).length >= capacity) { failure = 'full'; return }
    const participant = { id: uid, nickname: displayName, joinedAt: now, status: 'waiting', currentQuestionIndex: 0, answers: {} }
    return {
      ...room,
      participants: { ...participants, [uid]: participant },
      participantCount: Object.keys(participants).length + 1,
      lastActivityAt: now,
    }
  })
  if (failure === 'not-found') {
    logger.warn('Guest room registration transaction found no compatible session', { roomId, source: 'sessions', mode: publicRoom.mode || null })
    throw new HttpsError('not-found', 'Комната не найдена или больше недоступна.')
  }
  if (failure === 'closed') throw new HttpsError('failed-precondition', 'Сессия завершена или срок её активности истёк. Подключение больше недоступно.')
  if (failure === 'full') throw new HttpsError('resource-exhausted', 'Комната уже заполнена. Попросите ведущего создать новую.')

  const room = transaction.snapshot.val()
  const participant = room?.participants?.[uid]
  if (!participant || participant.id !== uid) throw new HttpsError('internal', 'Сервер не подтвердил регистрацию участника.')
  await db.ref(`publicRooms/${roomId}`).update({ lastActivityAt: now })
  return { participant, reused: !transaction.committed }
})

/** Grade one quiz answer on trusted infrastructure. A participant can submit
 * only their own answer while the room is live; no correct answer is returned. */
exports.submitQuizAnswer = onCall(async request => {
  const uid = request.auth?.uid
  const { roomId, questionId, answer } = request.data || {}
  if (!uid) throw new HttpsError('unauthenticated', 'Требуется безопасное подключение участника.')
  if (!roomId || !questionId || !['A', 'B', 'C', 'D'].includes(answer)) throw new HttpsError('invalid-argument', 'Некорректный ответ.')
  const [roomSnap, publicQuestionsSnap, privateQuestionsSnap] = await Promise.all([
    db.ref(`sessions/${roomId}`).once('value'),
    db.ref(`roomParticipantQuestions/${roomId}`).once('value'),
    db.ref(`roomPrivateQuestions/${roomId}`).once('value'),
  ])
  const room = roomSnap.val()
  const participant = room?.participants?.[uid]
  const publicSet = publicQuestionsSnap.val()
  const privateSet = privateQuestionsSnap.val()
  if (!room || room.mode !== 'quiz' || room.phase !== 'live') throw new HttpsError('failed-precondition', 'Викторина не принимает ответы.')
  if (Date.now() - Number(room.lastActivityAt || room.createdAt || 0) >= 10 * 60 * 1000) throw new HttpsError('failed-precondition', 'Время активности комнаты истекло.')
  if (!participant || participant.id !== uid) throw new HttpsError('permission-denied', 'Участник не принадлежит этой комнате.')
  const publicQuestion = byQuestionId(publicSet?.questions, questionId)
  const privateQuestion = byQuestionId(privateSet?.questions, questionId)
  if (!publicQuestion || !privateQuestion?.correctAnswer) throw new HttpsError('failed-precondition', 'Вопрос недоступен.')
  const allPublic = Object.values(asObject(publicSet?.questions))
  const previous = existingQuizAnswer(participant, questionId, answer)
  if (previous.kind === 'replayed') return { ...previous, questionId, answer }
  if (previous.kind === 'conflict') throw new HttpsError('already-exists', 'На этот вопрос уже был дан другой ответ.')
  if (participant.status === 'finished') throw new HttpsError('failed-precondition', 'Викторина уже завершена для этого участника.')
  const expectedQuestion = allPublic[Number(participant.currentQuestionIndex || 0)]
  if (!expectedQuestion || expectedQuestion.id !== questionId) throw new HttpsError('failed-precondition', 'Вопрос уже изменился. Дождитесь синхронизации.')
  const nextIndex = Number(participant.currentQuestionIndex || 0) + 1
  const finished = nextIndex >= allPublic.length
  const nextAnswers = { ...(participant.answers || {}), [questionId]: answer }
  const patch = {
    [`sessions/${roomId}/participants/${uid}/answers/${questionId}`]: answer,
    [`sessions/${roomId}/participants/${uid}/currentQuestionIndex`]: nextIndex,
    [`sessions/${roomId}/participants/${uid}/status`]: finished ? 'finished' : 'answering',
    [`sessions/${roomId}/lastActivityAt`]: Date.now(),
    [`publicRooms/${roomId}/lastActivityAt`]: Date.now(),
    ...(finished ? { [`sessions/${roomId}/participants/${uid}/completedAt`]: Date.now() } : {}),
  }
  if (finished) {
    const correct = allPublic.reduce((total, question) => total + (nextAnswers[question.id] === byQuestionId(privateSet?.questions, question.id)?.correctAnswer ? 1 : 0), 0)
    patch[`roomParticipantResults/${roomId}/${uid}`] = {
      participantId: uid, correct, total: allPublic.length,
      percentage: allPublic.length ? Math.round(correct / allPublic.length * 100) : 0,
      releasedAt: Date.now(),
    }
  }
  await db.ref().update(patch)
  return { questionId, answer, nextIndex, status: finished ? 'finished' : 'answering', replayed: false }
})
