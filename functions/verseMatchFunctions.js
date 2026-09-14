const { randomBytes } = require('node:crypto')
const { onCall, HttpsError } = require('firebase-functions/v2/https')
const builtInProverbsPack = require('./data/proverbs-pack-v1.json')
const {
  validateVersePack,
  startVerseGame,
  submitVerseCard,
  revealVerseAnswer,
  continueVerseGame,
  finishVerseGame,
} = require('./verseMatchEngine')

const asObject = value => value && typeof value === 'object' ? value : {}
const clean = (value, max = 200) => String(value || '').trim().slice(0, max)
const roomIdPattern = /^[A-Z0-9]{6,16}$/
const allowedDifficulties = new Set(['easy', 'medium', 'hard'])
const allowedDirections = new Set(['starts', 'ends', 'mixed'])

const publicPhase = phase => phase === 'lobby' ? 'lobby' : phase === 'closed' ? 'closed' : phase === 'completed' ? 'resultsReal' : 'live'

const sanitizeEntry = value => ({
  id: clean(value?.id, 80),
  bookId: clean(value?.bookId, 20).toUpperCase(),
  book: clean(value?.book, 80),
  chapter: Math.max(1, Math.floor(Number(value?.chapter) || 1)),
  verse: clean(value?.verse, 20),
  reference: clean(value?.reference, 100),
  translation: clean(value?.translation, 100),
  fullText: clean(value?.fullText, 1000),
  start: clean(value?.start, 700),
  end: clean(value?.end, 700),
  difficulty: allowedDifficulties.has(value?.difficulty) ? value.difficulty : 'medium',
  enabled: value?.enabled !== false,
  verificationStatus: ['draft', 'verified', 'rejected'].includes(value?.verificationStatus) ? value.verificationStatus : 'draft',
})

const sanitizePack = (value, fallback = {}) => ({
  packId: clean(value?.packId || fallback.packId, 100),
  version: Math.max(1, Math.floor(Number(value?.version || fallback.version) || 1)),
  title: clean(value?.title || fallback.title, 120),
  description: clean(value?.description || fallback.description, 500),
  translation: clean(value?.translation || fallback.translation, 100),
  sourceUrl: clean(value?.sourceUrl || fallback.sourceUrl, 500),
  license: clean(value?.license || fallback.license, 100),
  status: ['draft', 'published', 'archived'].includes(value?.status) ? value.status : 'draft',
  entries: (Array.isArray(value?.entries) ? value.entries : []).slice(0, 500).map(sanitizeEntry),
})

module.exports = ({ db, logger }) => {
  const assertLeader = async request => {
    const uid = request.auth?.uid
    if (!uid || request.auth?.token?.firebase?.sign_in_provider === 'anonymous') throw new HttpsError('unauthenticated', 'Требуется вход ведущего.')
    const user = (await db.ref(`users/${uid}`).once('value')).val()
    if (!user || user.status !== 'active' || !user.workspaceId) throw new HttpsError('permission-denied', 'Аккаунт ведущего не активен.')
    const workspace = (await db.ref(`workspaces/${user.workspaceId}`).once('value')).val()
    if (!workspace || workspace.ownerUid !== uid) throw new HttpsError('permission-denied', 'Рабочее пространство недоступно.')
    return { uid, user, workspaceId: user.workspaceId, workspace }
  }

  const systemPack = async () => {
    const override = (await db.ref(`verseMatchPacks/system/${builtInProverbsPack.packId}`).once('value')).val()
    return override ? sanitizePack(override, builtInProverbsPack) : builtInProverbsPack
  }

  const resolvePack = async (workspaceId, packId) => {
    if (packId === builtInProverbsPack.packId) return systemPack()
    const pack = (await db.ref(`verseMatchPacks/workspaces/${workspaceId}/${packId}`).once('value')).val()
    return pack ? sanitizePack(pack) : null
  }

  const entryForCard = (game, card) => game.packSnapshot.entries.find(entry => entry.id === card.verseId)
  const participantStats = participant => {
    const cards = Object.values(asObject(participant.cards))
    return {
      correct: cards.filter(card => card.status === 'correct').length,
      errors: cards.filter(card => card.status === 'error').length,
      missed: cards.filter(card => card.status === 'missed').length,
      remaining: cards.filter(card => card.status === 'available').length,
      total: cards.length,
    }
  }

  const publicRound = game => {
    const round = game.currentRound
    if (!round) return null
    return {
      roundId: round.roundId,
      version: round.version,
      status: round.status,
      promptDirection: round.promptDirection,
      promptText: round.promptText,
      ...(round.status === 'revealed' ? {
        outcome: round.outcome,
        fullText: round.fullText,
        reference: round.reference,
        ...(round.answeredByName ? { answeredByName: round.answeredByName } : {}),
      } : {}),
    }
  }

  const toHostView = game => {
    const eligibleCount = game.packSnapshot.entries.filter(entry => entry.enabled && entry.verificationStatus === 'verified' && entry.difficulty === game.config.difficulty).length
    const participants = Object.values(asObject(game.participants)).map(participant => ({ id: participant.id, nickname: participant.nickname, joinedAt: participant.joinedAt, ...participantStats(participant) }))
    return {
      roomId: game.roomId, hostUid: game.hostUid, workspaceId: game.workspaceId, title: game.title,
      environment: 'development', phase: game.phase, version: game.version, createdAt: game.createdAt,
      startedAt: game.startedAt || null, completedAt: game.completedAt || null, closedAt: game.closedAt || null,
      endedEarly: Boolean(game.endedEarly), config: game.config,
      pack: { packId: game.packSnapshot.packId, version: game.packSnapshot.version, title: game.packSnapshot.title, translation: game.packSnapshot.translation },
      capacity: { available: eligibleCount, required: participants.length * game.config.cardsPerPlayer, maxPlayers: Math.floor(eligibleCount / game.config.cardsPerPlayer), maxRounds: participants.length * game.config.cardsPerPlayer },
      participants, currentRound: publicRound(game), roundNumber: game.history?.length ? game.history.length + (game.currentRound?.status === 'open' ? 1 : 0) : game.currentRound ? 1 : 0,
      remainingCards: participants.reduce((total, participant) => total + participant.remaining, 0),
      history: (game.history || []).map(round => ({ roundId: round.roundId, outcome: round.outcome, fullText: round.fullText, reference: round.reference, answeredByName: round.answeredByName || null })),
      results: game.results || null,
    }
  }

  const toParticipantView = (game, participant) => {
    const cards = Object.values(asObject(participant.cards)).map(card => {
      const entry = entryForCard(game, card)
      const closed = card.status !== 'available'
      return {
        cardId: card.cardId, direction: card.direction, fragment: card.fragment, status: card.status,
        ...(closed && entry ? { fullText: entry.fullText, reference: entry.reference } : {}),
      }
    })
    return {
      roomId: game.roomId, participantId: participant.id, nickname: participant.nickname, title: game.title,
      environment: 'development', phase: game.phase, version: game.version, config: { cardsPerPlayer: game.config.cardsPerPlayer, direction: game.config.direction },
      currentRound: publicRound(game), cards, stats: participantStats(participant), result: (game.results || []).find(row => row.participantId === participant.id) || null,
      endedEarly: Boolean(game.endedEarly),
    }
  }

  const toAudienceView = game => ({
    roomId: game.roomId, title: game.title, environment: 'development', phase: game.phase,
    currentRound: publicRound(game), roundNumber: game.history?.length ? game.history.length + (game.currentRound?.status === 'open' ? 1 : 0) : game.currentRound ? 1 : 0,
    remainingCards: Object.values(asObject(game.participants)).reduce((total, participant) => total + participantStats(participant).remaining, 0),
    participantCount: Object.keys(asObject(game.participants)).length,
    completedRounds: (game.history || []).length,
    endedEarly: Boolean(game.endedEarly), results: game.results || null,
  })

  const syncViews = async game => {
    const hostView = toHostView(game)
    const patch = {
      [`verseMatchHostViews/${game.roomId}`]: hostView,
      [`verseMatchPublicViews/${game.roomId}`]: toAudienceView(game),
      [`publicRooms/${game.roomId}`]: {
        roomId: game.roomId, roomTitle: game.title, displayCode: game.roomId, phase: publicPhase(game.phase), maxParticipants: 40,
        createdAt: game.createdAt, lastActivityAt: Date.now(), mode: 'verse-match', gameTypeId: 'verse-match', productId: 'verse-match', packId: game.packSnapshot.packId, packTitle: game.packSnapshot.title,
        versePhase: game.phase,
      },
    }
    Object.values(asObject(game.participants)).forEach(participant => { patch[`verseMatchParticipantViews/${game.roomId}/${participant.id}`] = toParticipantView(game, participant) })
    if (['completed', 'closed'].includes(game.phase)) patch[`verseMatchArchives/${game.workspaceId}/${game.roomId}`] = hostView
    await db.ref().update(patch)
  }

  const roomTransaction = async (roomId, transition) => {
    if (!roomIdPattern.test(roomId)) throw new HttpsError('invalid-argument', 'Некорректный код комнаты.')
    const roomRef = db.ref(`verseMatchGames/${roomId}`)
    const initial = (await roomRef.once('value')).val()
    if (!initial) throw new HttpsError('not-found', 'Комната «Собери стих» не найдена.')
    let outcome = null; let first = true
    const transaction = await roomRef.transaction(current => {
      const game = !current && first ? initial : current; first = false
      if (!game) return
      const next = transition(game)
      outcome = next
      return next.game
    })
    if (!transaction.snapshot.exists()) throw new HttpsError('not-found', 'Комната больше недоступна.')
    const game = transaction.snapshot.val()
    await syncViews(game)
    return { game, outcome, committed: transaction.committed }
  }

  const getVerseMatchLibrary = onCall(async request => {
    const leader = await assertLeader(request)
    const [system, workspaceSnap] = await Promise.all([systemPack(), db.ref(`verseMatchPacks/workspaces/${leader.workspaceId}`).once('value')])
    return { system: [system], workspace: Object.values(asObject(workspaceSnap.val())).map(sanitizePack) }
  })

  const saveVerseMatchPack = onCall(async request => {
    const leader = await assertLeader(request)
    const input = asObject(request.data)
    const scope = input.scope === 'system' ? 'system' : 'workspace'
    if (scope === 'system' && !request.auth?.token?.platformAdmin) throw new HttpsError('permission-denied', 'Общую библиотеку меняет только владелец платформы.')
    const fallbackId = scope === 'system' ? builtInProverbsPack.packId : `verse-${leader.uid.slice(0, 8)}-${Date.now().toString(36)}`
    const pack = sanitizePack({ ...asObject(input.pack), packId: input.pack?.packId || fallbackId })
    if (!pack.title || !pack.packId) throw new HttpsError('invalid-argument', 'Укажите название набора.')
    const validation = validateVersePack(pack)
    if (pack.status === 'published' && !validation.valid) throw new HttpsError('failed-precondition', 'Перед публикацией исправьте ошибки набора.', { issues: validation.issues })
    const path = scope === 'system' ? `verseMatchPacks/system/${pack.packId}` : `verseMatchPacks/workspaces/${leader.workspaceId}/${pack.packId}`
    const existing = (await db.ref(path).once('value')).val()
    if (scope === 'workspace' && existing?.createdBy && existing.createdBy !== leader.uid) throw new HttpsError('permission-denied', 'Редактировать можно только свои наборы.')
    const now = Date.now()
    const saved = { ...pack, version: Math.max(Number(existing?.version || 0) + 1, pack.version), workspaceId: scope === 'workspace' ? leader.workspaceId : null, createdBy: existing?.createdBy || leader.uid, createdAt: existing?.createdAt || now, updatedAt: now }
    await db.ref(path).set(saved)
    return { pack: saved, validation }
  })

  const copyVerseMatchPack = onCall(async request => {
    const leader = await assertLeader(request)
    const source = await systemPack()
    if (clean(request.data?.packId, 100) !== source.packId) throw new HttpsError('not-found', 'Опубликованный набор не найден.')
    const path = `verseMatchPacks/workspaces/${leader.workspaceId}/${source.packId}`
    const existing = (await db.ref(path).once('value')).val()
    if (existing) return { pack: sanitizePack(existing), reused: true }
    const now = Date.now()
    const copy = { ...source, status: 'published', workspaceId: leader.workspaceId, sourcePackId: source.packId, createdBy: leader.uid, createdAt: now, updatedAt: now }
    await db.ref(path).set(copy)
    return { pack: copy, reused: false }
  })

  const deleteVerseMatchPack = onCall(async request => {
    const leader = await assertLeader(request)
    const packId = clean(request.data?.packId, 100)
    const path = `verseMatchPacks/workspaces/${leader.workspaceId}/${packId}`
    const existing = (await db.ref(path).once('value')).val()
    if (!existing || existing.createdBy !== leader.uid) throw new HttpsError('not-found', 'Личный набор не найден.')
    await db.ref(path).remove()
    return { deleted: true }
  })

  const createVerseMatchRoom = onCall(async request => {
    const leader = await assertLeader(request)
    const input = asObject(request.data)
    const packId = clean(input.packId, 100)
    const pack = await resolvePack(leader.workspaceId, packId)
    if (!pack || pack.status !== 'published') throw new HttpsError('failed-precondition', 'Выбранный набор не опубликован или недоступен.')
    const validation = validateVersePack(pack)
    if (!validation.valid) throw new HttpsError('failed-precondition', 'В выбранном наборе есть ошибки.', { issues: validation.issues })
    const difficulty = allowedDifficulties.has(input.difficulty) ? input.difficulty : 'easy'
    const cardsPerPlayer = [5, 7, 10].includes(Number(input.cardsPerPlayer)) ? Number(input.cardsPerPlayer) : 5
    const direction = allowedDirections.has(input.direction) ? input.direction : 'ends'
    let roomId = ''
    for (let attempt = 0; attempt < 6; attempt += 1) {
      roomId = randomBytes(4).toString('hex').slice(0, 6).toUpperCase()
      if (!(await db.ref(`publicRooms/${roomId}`).once('value')).exists()) break
    }
    if (!roomId) throw new HttpsError('resource-exhausted', 'Не удалось подобрать код комнаты. Повторите попытку.')
    const now = Date.now()
    const game = {
      roomId, hostUid: leader.uid, workspaceId: leader.workspaceId, environment: 'development',
      title: clean(input.title, 80) || 'Собери стих', createdAt: now, updatedAt: now, phase: 'lobby', version: 1,
      config: { packId, difficulty, cardsPerPlayer, direction }, packSnapshot: { ...pack, capturedAt: now },
      participants: {}, queue: [], queueCursor: 0, history: [], results: null,
    }
    await db.ref(`verseMatchGames/${roomId}`).set(game)
    await syncViews(game)
    return { roomId }
  })

  const joinVerseMatchRoom = onCall(async request => {
    const uid = request.auth?.uid
    if (!uid || request.auth?.token?.firebase?.sign_in_provider !== 'anonymous') throw new HttpsError('permission-denied', 'Откройте ссылку участника в отдельном браузере или режиме инкогнито.')
    const roomId = clean(request.data?.roomId, 16).toUpperCase()
    const nickname = clean(request.data?.nickname, 30)
    if (!roomIdPattern.test(roomId) || nickname.length < 2) throw new HttpsError('invalid-argument', 'Проверьте код комнаты и имя.')
    const result = await roomTransaction(roomId, game => {
      const existing = game.participants?.[uid]
      if (existing) return { game, accepted: true, reused: true }
      if (game.phase !== 'lobby') return { game, accepted: false, reason: 'started' }
      const participants = asObject(game.participants)
      if (Object.keys(participants).length >= 40) return { game, accepted: false, reason: 'full' }
      const now = Date.now()
      return { game: { ...game, participants: { ...participants, [uid]: { id: uid, nickname, joinedAt: now, cards: {}, attempts: {}, correct: 0, errors: 0, missed: 0 } }, updatedAt: now, version: Number(game.version || 0) + 1 }, accepted: true, reused: false }
    })
    if (!result.outcome?.accepted) throw new HttpsError(result.outcome?.reason === 'full' ? 'resource-exhausted' : 'failed-precondition', result.outcome?.reason === 'started' ? 'Игра уже началась.' : 'Комната заполнена.')
    return { participantId: uid, reused: Boolean(result.outcome.reused) }
  })

  const startVerseMatchGame = onCall(async request => {
    const leader = await assertLeader(request); const roomId = clean(request.data?.roomId, 16).toUpperCase()
    const result = await roomTransaction(roomId, game => {
      if (game.hostUid !== leader.uid) throw new HttpsError('permission-denied', 'Запустить игру может только ведущий комнаты.')
      try { return { ...startVerseGame(game), accepted: true } } catch (error) { throw new HttpsError('failed-precondition', error.message) }
    })
    return { started: true, reused: Boolean(result.outcome?.reused) }
  })

  const submitVerseMatchCard = onCall(async request => {
    const uid = request.auth?.uid; const roomId = clean(request.data?.roomId, 16).toUpperCase()
    if (!uid || request.auth?.token?.firebase?.sign_in_provider !== 'anonymous') throw new HttpsError('permission-denied', 'Ответ принимается только от участника комнаты.')
    const result = await roomTransaction(roomId, game => submitVerseCard(game, { participantId: uid, cardId: clean(request.data?.cardId, 80), roundId: clean(request.data?.roundId, 80), roundVersion: Number(request.data?.roundVersion) }))
    if (!result.outcome?.accepted) {
      const stale = ['round-closed', 'stale-round'].includes(result.outcome?.reason)
      throw new HttpsError(stale ? 'failed-precondition' : 'already-exists', stale ? 'Раунд уже изменился. Карточка не была закрыта.' : 'Попытка в этом раунде уже принята.')
    }
    return { accepted: true, correct: Boolean(result.outcome.correct) }
  })

  const hostTransition = transition => onCall(async request => {
    const leader = await assertLeader(request); const roomId = clean(request.data?.roomId, 16).toUpperCase()
    const result = await roomTransaction(roomId, game => {
      if (game.hostUid !== leader.uid) throw new HttpsError('permission-denied', 'Комната принадлежит другому ведущему.')
      return transition(game, request)
    })
    return { phase: result.game.phase, version: result.game.version }
  })

  const revealVerseMatchAnswer = hostTransition(game => revealVerseAnswer(game))
  const nextVerseMatchRound = hostTransition(game => ({ game: continueVerseGame(game), accepted: true }))
  const finishVerseMatchGame = hostTransition((game, request) => ({ game: finishVerseGame(game, request.data?.early !== false), accepted: true }))

  return {
    getVerseMatchLibrary,
    saveVerseMatchPack,
    copyVerseMatchPack,
    deleteVerseMatchPack,
    createVerseMatchRoom,
    joinVerseMatchRoom,
    startVerseMatchGame,
    submitVerseMatchCard,
    revealVerseMatchAnswer,
    nextVerseMatchRound,
    finishVerseMatchGame,
  }
}
