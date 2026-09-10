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
const assertPlatformOwner = request => {
  if (!request.auth?.token?.platformAdmin) throw new HttpsError('permission-denied', 'Только владелец платформы может выполнить это действие.')
  return request.auth.uid
}
const asTimestamp = value => Number.isFinite(Number(value)) ? Number(value) : 0
const ownerDay = timestamp => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(timestamp))
const adminAuditId = (type, targetId, at) => `${type}:${targetId}:${at}`
// Registration notifications have a stable key. A retried callable or a
// returning account therefore cannot create another event for the same UID.
const registrationNotificationId = uid => `registration:${uid}`
const safeAdminRoom = room => {
  const participants = asObject(room.participants)
  const events = Object.values(asObject(room.events)).filter(event => event && typeof event === 'object')
  const rawPhase = room.phase || room.status || 'lobby'
  const activityAt = asTimestamp(room.lastActivityAt)
  // A room is not finished merely because its owner disconnected.  This flag
  // is only a reporting classification: lifecycle data remains untouched.
  const operationalStatus = rawPhase === 'closed'
    ? 'completed'
    : !['lobby', 'live'].includes(rawPhase)
      ? 'unknown'
      : !activityAt
        ? 'unknown'
        : Date.now() - activityAt < ROOM_INACTIVITY_MS ? 'active' : 'inactive'
  return {
    roomId: room.roomId,
    roomTitle: room.roomTitle || room.roomId,
    displayCode: room.displayCode || room.roomId,
    hostUid: room.hostUid,
    workspaceId: room.workspaceId || '',
    mode: room.mode || 'diagnostic',
    phase: rawPhase,
    operationalStatus,
    createdAt: asTimestamp(room.createdAt),
    startedAt: asTimestamp(room.startedAt) || null,
    endedAt: asTimestamp(room.endedAt || room.closedAt) || null,
    lastActivityAt: activityAt || null,
    participantCount: Number.isFinite(Number(room.participantCount)) ? Number(room.participantCount) : Object.keys(participants).length,
    completedCount: Number.isFinite(Number(room.completedCount)) ? Number(room.completedCount) : Object.values(participants).filter(participant => participant?.status === 'finished').length,
    eventCounts: {
      joined: events.filter(event => event.type === 'participant_joined').length,
      finished: events.filter(event => event.type === 'participant_finished').length,
    },
    events: events.map(event => ({ id: event.id, type: event.type, createdAt: asTimestamp(event.createdAt), hostUid: event.hostUid, participantId: event.participantId })),
  }
}

/**
 * Owner-only operational projection. The browser receives paginated user and
 * room summaries, never raw participant answers, private question material or
 * a subscription to protected database roots. Historical event metrics are
 * deliberately null when no persisted events exist instead of being shown as 0.
 */
exports.getOwnerAdminDashboard = onCall(async request => {
  assertPlatformOwner(request)
  const input = asObject(request.data)
  const now = Date.now()
  const requestedFrom = asTimestamp(input.from)
  const requestedTo = asTimestamp(input.to)
  const to = requestedTo > 0 ? Math.min(requestedTo, now) : now
  const from = requestedFrom > 0 ? Math.min(requestedFrom, to) : to - 30 * 24 * 60 * 60 * 1000
  const search = String(input.search || '').trim().toLocaleLowerCase('ru-RU').slice(0, 120)
  const selectedMode = ['diagnostic', 'quiz', 'wheel'].includes(input.mode) ? input.mode : ''
  const selectedHost = typeof input.hostUid === 'string' ? input.hostUid : ''
  const selectedRoomStatus = ['active', 'inactive', 'completed', 'unknown'].includes(input.roomStatus) ? input.roomStatus : ''
  const selectedRoomMetric = ['created', 'started', 'completed', 'active', 'inactive'].includes(input.roomMetric) ? input.roomMetric : ''
  const selectedUserMetric = ['new', 'blocked', 'activeHosts'].includes(input.userMetric) ? input.userMetric : ''
  const pageSize = Math.max(10, Math.min(100, Math.floor(Number(input.pageSize) || 30)))
  const [usersSnap, workspacesSnap, sessionsSnap, archivesSnap, productsSnap, accessSnap, packsSnap, feedbackSnap, auditSnap] = await Promise.all([
    db.ref('users').once('value'), db.ref('workspaces').once('value'), db.ref('sessions').once('value'),
    db.ref('sessionArchives').once('value'), db.ref('products').once('value'), db.ref('workspaceProducts').once('value'),
    db.ref('globalPacks').once('value'), db.ref('feedback').once('value'), db.ref('adminAudit').limitToLast(100).once('value'),
  ])
  const users = asObject(usersSnap.val())
  const workspaces = asObject(workspacesSnap.val())
  const liveRooms = Object.values(asObject(sessionsSnap.val())).filter(room => room?.roomId).map(safeAdminRoom)
  const archivedRooms = Object.values(asObject(archivesSnap.val())).filter(room => room?.roomId).map(safeAdminRoom)
  const roomsById = new Map(archivedRooms.map(room => [room.roomId, room]))
  liveRooms.forEach(room => roomsById.set(room.roomId, room))
  const rooms = [...roomsById.values()]
  const inPeriod = timestamp => timestamp >= from && timestamp <= to
  const roomEvents = rooms.flatMap(room => room.events.map(event => ({ ...event, roomId: room.roomId, workspaceId: room.workspaceId })))
  const joinedEvents = roomEvents.filter(event => event.type === 'participant_joined' && inPeriod(event.createdAt))
  const finishedEvents = roomEvents.filter(event => event.type === 'participant_finished' && inPeriod(event.createdAt))
  const eventHistoryAvailable = roomEvents.length > 0
  const registrations = Object.values(users).filter(user => inPeriod(asTimestamp(user?.createdAt)))
  const registeredByDay = {}
  const createdRoomsByDay = {}
  const startedByDay = {}
  const completedRoomsByDay = {}
  const joinsByDay = {}
  const finishedByDay = {}
  registrations.forEach(user => { const day = ownerDay(asTimestamp(user.createdAt)); registeredByDay[day] = (registeredByDay[day] || 0) + 1 })
  rooms.filter(room => inPeriod(room.createdAt)).forEach(room => { const day = ownerDay(room.createdAt); createdRoomsByDay[day] = (createdRoomsByDay[day] || 0) + 1 })
  rooms.filter(room => room.startedAt && inPeriod(room.startedAt)).forEach(room => { const day = ownerDay(room.startedAt); startedByDay[day] = (startedByDay[day] || 0) + 1 })
  rooms.filter(room => room.endedAt && inPeriod(room.endedAt)).forEach(room => { const day = ownerDay(room.endedAt); completedRoomsByDay[day] = (completedRoomsByDay[day] || 0) + 1 })
  joinedEvents.forEach(event => { const day = ownerDay(event.createdAt); joinsByDay[day] = (joinsByDay[day] || 0) + 1 })
  finishedEvents.forEach(event => { const day = ownerDay(event.createdAt); finishedByDay[day] = (finishedByDay[day] || 0) + 1 })
  const days = [...new Set([...Object.keys(registeredByDay), ...Object.keys(createdRoomsByDay), ...Object.keys(startedByDay), ...Object.keys(completedRoomsByDay), ...Object.keys(joinsByDay), ...Object.keys(finishedByDay)])].sort()
  // Both an open lobby and a live game can be active now. An old room is only
  // labelled inactive; no write is made and its game lifecycle is preserved.
  const activeNow = liveRooms.filter(room => room.operationalStatus === 'active')
  const inactiveUnfinished = liveRooms.filter(room => room.operationalStatus === 'inactive')
  const startedRooms = rooms.filter(room => room.startedAt && inPeriod(room.startedAt))
  const completedRooms = rooms.filter(room => room.endedAt && inPeriod(room.endedAt))
  const activeHostIds = new Set(startedRooms.map(room => room.hostUid))
  const modeAnalytics = ['diagnostic', 'quiz', 'wheel'].map(mode => {
    const all = rooms.filter(room => room.mode === mode)
    const started = all.filter(room => room.startedAt && inPeriod(room.startedAt))
    const completed = all.filter(room => room.endedAt && inPeriod(room.endedAt))
    const joined = all.flatMap(room => room.events).filter(event => event.type === 'participant_joined' && inPeriod(event.createdAt))
    const finished = all.flatMap(room => room.events).filter(event => event.type === 'participant_finished' && inPeriod(event.createdAt))
    const knownEvents = all.some(room => room.events.length > 0)
    const dayMap = {}
    started.forEach(room => { const day = ownerDay(room.startedAt); dayMap[day] = (dayMap[day] || 0) + 1 })
    return { mode, created: all.filter(room => inPeriod(room.createdAt)).length, started: started.length, completed: completed.length, activeNow: all.filter(room => room.operationalStatus === 'active').length, inactiveUnfinished: all.filter(room => room.operationalStatus === 'inactive').length, leaders: new Set(started.map(room => room.hostUid)).size, participations: knownEvents ? joined.length : null, completedRuns: knownEvents ? finished.length : null, dailyStarts: Object.entries(dayMap).sort(([a], [b]) => a.localeCompare(b)).map(([day, value]) => ({ day, value })) }
  })
  const userRows = Object.values(users).filter(user => user?.uid).map(user => {
    const ownRooms = rooms.filter(room => room.hostUid === user.uid)
    return {
      uid: user.uid, fullName: user.fullName || 'Без имени', email: user.email || null, status: user.status || 'pending',
      workspaceId: user.workspaceId || '', createdAt: asTimestamp(user.createdAt), lastActiveAt: asTimestamp(user.lastActiveAt) || null,
      createdRooms: ownRooms.length, completedRooms: ownRooms.filter(room => room.operationalStatus === 'completed').length,
      roomParticipations: ownRooms.reduce((sum, room) => sum + room.participantCount, 0),
    }
  }).filter(user => !search || [user.fullName, user.email || '', user.uid].join(' ').toLocaleLowerCase('ru-RU').includes(search))
    .filter(user => !selectedUserMetric || (selectedUserMetric === 'new' && inPeriod(user.createdAt)) || (selectedUserMetric === 'blocked' && ['paused', 'revoked'].includes(user.status)) || (selectedUserMetric === 'activeHosts' && activeHostIds.has(user.uid)))
    .sort((a, b) => b.createdAt - a.createdAt).slice(0, pageSize)
  const roomRows = rooms.filter(room => !search || [room.roomTitle, room.displayCode, room.hostUid].join(' ').toLocaleLowerCase('ru-RU').includes(search))
    .filter(room => !selectedMode || room.mode === selectedMode).filter(room => !selectedHost || room.hostUid === selectedHost).filter(room => !selectedRoomStatus || room.operationalStatus === selectedRoomStatus)
    .filter(room => !selectedRoomMetric || (selectedRoomMetric === 'created' && inPeriod(room.createdAt)) || (selectedRoomMetric === 'started' && room.startedAt && inPeriod(room.startedAt)) || (selectedRoomMetric === 'completed' && room.endedAt && inPeriod(room.endedAt)) || (selectedRoomMetric === 'active' && room.operationalStatus === 'active') || (selectedRoomMetric === 'inactive' && room.operationalStatus === 'inactive'))
    .sort((a, b) => b.createdAt - a.createdAt).slice(0, pageSize)
  const administrativeAudit = Object.values(asObject(auditSnap.val())).filter(item => item?.id).map(item => ({ ...item, createdAt: asTimestamp(item.createdAt) }))
  const activity = [
    ...registrations.map(user => ({ id: `registration:${user.uid}`, type: 'registration', actorUid: user.uid, targetId: user.uid, createdAt: asTimestamp(user.createdAt) })),
    ...roomEvents.filter(event => ['room_created', 'room_started', 'room_closed'].includes(event.type)).map(event => ({ id: event.id, type: event.type, actorUid: event.hostUid || null, targetId: event.roomId, createdAt: event.createdAt })),
    ...administrativeAudit,
  ].sort((a, b) => b.createdAt - a.createdAt).slice(0, 60)
  return {
    generatedAt: now, timezone: 'Asia/Almaty',
    metrics: {
      totalAccounts: Object.keys(users).length, newRegistrations: registrations.length,
      leaders: Object.keys(users).length, blockedAccounts: Object.values(users).filter(user => ['paused', 'revoked'].includes(user?.status)).length,
      activeHosts: activeHostIds.size,
      roomsCreated: rooms.filter(room => inPeriod(room.createdAt)).length,
      roomsStarted: startedRooms.length,
      roomsCompleted: completedRooms.length,
      roomsActiveNow: activeNow.length, inactiveUnfinished: inactiveUnfinished.length,
      participantConnections: eventHistoryAvailable ? joinedEvents.length : null,
      completedRuns: eventHistoryAvailable ? finishedEvents.length : null,
    },
    charts: { daily: days.map(day => ({ day, registrations: registeredByDay[day] || 0, roomCreated: createdRoomsByDay[day] || 0, starts: startedByDay[day] || 0, roomCompleted: completedRoomsByDay[day] || 0, joins: eventHistoryAvailable ? joinsByDay[day] || 0 : null, completions: eventHistoryAvailable ? finishedByDay[day] || 0 : null })), modeUsage: modeAnalytics.map(item => ({ mode: item.mode, value: item.started })) },
    modeAnalytics,
    users: userRows, rooms: roomRows, activity,
    workspaces, products: asObject(productsSnap.val()), workspaceProducts: asObject(accessSnap.val()), packs: asObject(packsSnap.val()), feedback: asObject(feedbackSnap.val()),
  }
})

/** Reversible account access change with server-side auditing. It never closes a room. */
exports.changeLeaderAccess = onCall(async request => {
  const actorUid = assertPlatformOwner(request)
  const { uid, status, reason } = asObject(request.data)
  if (typeof uid !== 'string' || !['active', 'paused', 'revoked'].includes(status)) throw new HttpsError('invalid-argument', 'Некорректные параметры доступа.')
  if (uid === actorUid) throw new HttpsError('failed-precondition', 'Нельзя изменить собственный доступ владельца.')
  const profileSnap = await db.ref(`users/${uid}`).once('value')
  const profile = profileSnap.val()
  if (!profile) throw new HttpsError('not-found', 'Пользователь не найден.')
  const now = Date.now()
  const audit = { id: adminAuditId('access_changed', uid, now), type: 'access_changed', actorUid, targetId: uid, targetName: profile.fullName || uid, previousStatus: profile.status || 'pending', nextStatus: status, reason: typeof reason === 'string' ? reason.trim().slice(0, 300) : '', createdAt: now }
  await db.ref().update({ [`users/${uid}/status`]: status, [`users/${uid}/updatedAt`]: now, [`adminAudit/${audit.id}`]: audit })
  return { status, audit }
})

/** Owner-only invitation projection. It uses the same records and counters
 * that the redemption transaction reads; no account-derived reconstruction. */
exports.getOwnerInviteStats = onCall(async request => {
  assertPlatformOwner(request)
  const now = Date.now()
  const snap = await db.ref('invites').once('value')
  const items = Object.entries(asObject(snap.val())).map(([code, raw]) => {
    const invite = asObject(raw)
    const usedBy = asObject(invite.usedBy)
    const storedUses = Number(invite.uses)
    const used = Number.isFinite(storedUses) && storedUses >= 0 ? Math.floor(storedUses) : Object.keys(usedBy).length || null
    const storedLimit = Number(invite.maxUses)
    const limit = Number.isFinite(storedLimit) && storedLimit > 0 ? Math.floor(storedLimit) : null
    const expiresAt = asTimestamp(invite.expiresAt) || null
    const status = invite.status === 'active' && (!expiresAt || expiresAt > now) ? 'active' : invite.status === 'active' ? 'expired' : 'disabled'
    return { code, status, limit, used, remaining: limit === null ? null : used === null ? null : Math.max(0, limit - used), expiresAt }
  }).sort((a, b) => (a.expiresAt || Number.MAX_SAFE_INTEGER) - (b.expiresAt || Number.MAX_SAFE_INTEGER) || a.code.localeCompare(b.code))
  return { generatedAt: now, invites: items }
})

/** Detailed, redacted owner view of one leader. Participant answers and quiz
 * keys stay on the server; only operational room summaries are returned. */
exports.getOwnerLeaderDetails = onCall(async request => {
  assertPlatformOwner(request)
  const input = asObject(request.data)
  const uid = typeof input.uid === 'string' ? input.uid : ''
  if (!uid) throw new HttpsError('invalid-argument', 'Не указан пользователь.')
  const mode = ['diagnostic', 'quiz', 'wheel'].includes(input.mode) ? input.mode : ''
  const roomStatus = ['active', 'inactive', 'completed', 'unknown'].includes(input.roomStatus) ? input.roomStatus : ''
  const offset = Math.max(0, Math.floor(Number(input.offset) || 0))
  const pageSize = Math.max(10, Math.min(50, Math.floor(Number(input.pageSize) || 20)))
  const [profileSnap, sessionsSnap, archivesSnap, workspaceSnap] = await Promise.all([
    db.ref(`users/${uid}`).once('value'), db.ref('sessions').once('value'), db.ref('sessionArchives').once('value'),
    db.ref(`users/${uid}/workspaceId`).once('value'),
  ])
  const profile = profileSnap.val()
  if (!profile) throw new HttpsError('not-found', 'Пользователь не найден или уже удалён.')
  const workspaceId = typeof workspaceSnap.val() === 'string' ? workspaceSnap.val() : profile.workspaceId || ''
  const workspace = workspaceId ? (await db.ref(`workspaces/${workspaceId}`).once('value')).val() : null
  const archived = Object.values(asObject(archivesSnap.val())).filter(room => room?.hostUid === uid).map(safeAdminRoom)
  const roomsById = new Map(archived.map(room => [room.roomId, room]))
  Object.values(asObject(sessionsSnap.val())).filter(room => room?.hostUid === uid).map(safeAdminRoom).forEach(room => roomsById.set(room.roomId, room))
  const allRooms = [...roomsById.values()].filter(room => (!mode || room.mode === mode) && (!roomStatus || room.operationalStatus === roomStatus)).sort((a, b) => b.createdAt - a.createdAt)
  return {
    profile: { uid, fullName: profile.fullName || '', email: profile.email || '', phone: profile.phone || '', status: profile.status || 'pending', createdAt: asTimestamp(profile.createdAt) || null, lastActiveAt: asTimestamp(profile.lastActiveAt) || null, accessSource: profile.accessSource || null, workspaceId },
    workspace: workspace ? { name: workspace.name || '', city: workspace.city || '', ownerUid: workspace.ownerUid || '' } : null,
    rooms: allRooms.slice(offset, offset + pageSize), totalRooms: allRooms.length, nextOffset: offset + pageSize < allRooms.length ? offset + pageSize : null,
  }
})

const invitationCodePattern = /^[A-Z0-9-]{4,64}$/
const registrationField = (value, label, maxLength) => {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized || normalized.length > maxLength) {
    throw new HttpsError('invalid-argument', `Проверьте поле «${label}».`)
  }
  return normalized
}
const defaultWorkspaceAccess = (productId, ownerUid, now) => ({
  productId, ownerUid, enabled: true, accessSource: 'pilot', plan: 'pilot-free', planId: 'pilot-free', startsAt: now, expiresAt: 0, testing: false,
})

/**
 * Redeems an invitation once per Firebase UID.  The transaction is the
 * authority for expiry and capacity, while `usedBy` makes retried callable
 * requests idempotent if a network failure happens after the first write.
 */
const redeemInvitation = async (rawCode, uid, now) => {
  const code = typeof rawCode === 'string' ? rawCode.trim().toUpperCase() : ''
  if (!invitationCodePattern.test(code)) {
    throw new HttpsError('invalid-argument', 'Код приглашения имеет неверный формат. Проверьте его и попробуйте снова.')
  }
  const inviteRef = db.ref(`invites/${code}`)
  // The Admin SDK can optimistically invoke a transaction with an empty local
  // cache. Hydrate first so that a valid invite is not mistaken for a missing
  // one on that initial callback.
  const initialSnap = await inviteRef.once('value')
  const initialInvite = initialSnap.val()
  if (!initialInvite || typeof initialInvite !== 'object') {
    throw new HttpsError('not-found', 'Код приглашения не найден или больше не активен. Проверьте его либо отправьте заявку без кода.')
  }
  let outcome = 'unknown'
  let firstTransactionPass = true
  await inviteRef.transaction(invite => {
    const currentInvite = !invite && firstTransactionPass ? initialInvite : invite
    firstTransactionPass = false
    if (!currentInvite || typeof currentInvite !== 'object' || currentInvite.status !== 'active') { outcome = 'invalid'; return }
    const usedBy = asObject(currentInvite.usedBy)
    // A UID that already redeemed the code can safely resume an interrupted
    // registration even if the code later expired or reached its cap.
    if (usedBy[uid]) { outcome = 'already-redeemed'; return currentInvite }
    const expiresAt = asTimestamp(currentInvite.expiresAt)
    if (expiresAt && expiresAt <= now) { outcome = 'expired'; return }
    const maxUses = Math.max(0, Math.floor(asTimestamp(currentInvite.maxUses)))
    const uses = Math.max(0, Math.floor(asTimestamp(currentInvite.uses) || Object.keys(usedBy).length))
    if (maxUses && uses >= maxUses) { outcome = 'exhausted'; return }
    outcome = 'redeemed'
    return { ...currentInvite, uses: uses + 1, usedBy: { ...usedBy, [uid]: now }, updatedAt: now }
  })
  if (outcome === 'redeemed' || outcome === 'already-redeemed') return true
  if (outcome === 'expired') throw new HttpsError('failed-precondition', 'Срок действия кода приглашения истёк. Уберите код и отправьте заявку на одобрение.')
  if (outcome === 'exhausted') throw new HttpsError('resource-exhausted', 'Лимит использований этого кода приглашения исчерпан. Уберите код и отправьте заявку на одобрение.')
  throw new HttpsError('not-found', 'Код приглашения не найден или больше не активен. Проверьте его либо отправьте заявку без кода.')
}

/**
 * Creates or resumes one leader profile from a Firebase Auth identity.
 * The browser never reads an invite or decides its own account status.
 */
exports.registerLeaderWithInvite = onCall(async request => {
  const uid = request.auth?.uid
  const provider = request.auth?.token?.firebase?.sign_in_provider
  if (!uid || provider === 'anonymous') throw new HttpsError('unauthenticated', 'Сначала создайте аккаунт ведущего.')
  const input = asObject(request.data)
  const fullName = registrationField(input.fullName, 'Имя и фамилия', 120)
  const phone = registrationField(input.phone, 'Телефон', 40)
  const workspaceName = registrationField(input.workspaceName, 'Название молодёжки', 120)
  const city = registrationField(input.city, 'Город', 120)
  const email = typeof request.auth?.token?.email === 'string' ? request.auth.token.email.trim() : ''
  if (!email) throw new HttpsError('failed-precondition', 'В аккаунте не найден email. Войдите снова и повторите регистрацию.')

  const profileRef = db.ref(`users/${uid}`)
  const existingSnap = await profileRef.once('value')
  const existing = existingSnap.val()
  if (existing?.status === 'paused' || existing?.status === 'revoked') {
    throw new HttpsError('permission-denied', 'Доступ этого аккаунта ограничен владельцем платформы. Приглашение не может его восстановить.')
  }
  if (existing?.status === 'active') return { profile: existing, reused: true }

  const inviteCode = typeof input.inviteCode === 'string' ? input.inviteCode.trim() : ''
  const now = Date.now()
  // The invite transaction, rather than a browser-supplied field, is the
  // authority for both the access state and the notification category.
  const invitationUsed = inviteCode ? await redeemInvitation(inviteCode, uid, now) : false

  const workspaceId = typeof existing?.workspaceId === 'string' && existing.workspaceId
    ? existing.workspaceId
    : db.ref('workspaces').push().key
  if (!workspaceId) throw new HttpsError('internal', 'Не удалось подготовить рабочее пространство.')

  const status = invitationUsed ? 'active' : 'pending'
  const profile = {
    uid,
    fullName: existing?.fullName || fullName,
    phone: existing?.phone || phone,
    email: existing?.email || email,
    workspaceId,
    status,
    createdAt: asTimestamp(existing?.createdAt) || now,
    updatedAt: now,
    lastActiveAt: now,
    accessSource: invitationUsed ? 'invite' : (existing?.accessSource || 'approval'),
  }
  const workspaceSnap = await db.ref(`workspaces/${workspaceId}`).once('value')
  const updates = { [`users/${uid}`]: profile }
  if (!existing) {
    // This is part of the same atomic write as the confirmed profile. A
    // notification can never be published for a registration that failed to
    // persist, and no invitation code is copied into the admin-facing event.
    updates[`adminNotifications/${registrationNotificationId(uid)}`] = {
      id: registrationNotificationId(uid),
      type: invitationUsed ? 'registration_invite' : 'registration_pending',
      uid,
      fullName: profile.fullName,
      email: profile.email,
      status: profile.status,
      createdAt: now,
      readBy: {},
    }
  }
  if (!workspaceSnap.exists()) {
    updates[`workspaces/${workspaceId}`] = {
      id: workspaceId, name: workspaceName, city, ownerUid: uid,
      planId: 'pilot-free', billingStatus: 'pilot', accessEndsAt: 0, accessSource: 'pilot', createdAt: now, updatedAt: now,
    }
    updates[`workspaceProducts/${workspaceId}/youth-atmosphere`] = defaultWorkspaceAccess('youth-atmosphere', uid, now)
    updates[`workspaceProducts/${workspaceId}/bible-quiz`] = defaultWorkspaceAccess('bible-quiz', uid, now)
  }
  await db.ref().update(updates)
  logger.info('Leader registration finalized', { uid, status, invitationUsed: Boolean(invitationUsed), createdNotification: !existing })
  return { profile, reused: Boolean(existing) }
})

/** Marks existing server-created registration notifications as read for one
 * platform owner. The client cannot write notification records or invent IDs. */
exports.markOwnerNotificationsRead = onCall(async request => {
  const ownerUid = assertPlatformOwner(request)
  const input = asObject(request.data)
  const ids = [...new Set(Array.isArray(input.ids) ? input.ids : [])]
    .filter(id => typeof id === 'string' && /^registration:[A-Za-z0-9_-]{1,128}$/.test(id))
    .slice(0, 100)
  if (!ids.length) return { updated: 0 }

  const notifications = await Promise.all(ids.map(async id => ({ id, value: (await db.ref(`adminNotifications/${id}`).once('value')).val() })))
  const now = Date.now()
  const updates = {}
  notifications.forEach(({ id, value }) => {
    if (value?.id === id && ['registration_pending', 'registration_invite'].includes(value.type)) {
      updates[`adminNotifications/${id}/readBy/${ownerUid}`] = now
    }
  })
  if (Object.keys(updates).length) await db.ref().update(updates)
  return { updated: Object.keys(updates).length }
})
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
