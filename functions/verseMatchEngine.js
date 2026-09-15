const clone = value => JSON.parse(JSON.stringify(value))
const asObject = value => value && typeof value === 'object' ? value : {}
const normalizeText = value => String(value || '').replace(/\s+/g, ' ').trim()
const allowedDifficulties = new Set(['easy', 'medium', 'hard'])
const allowedDirections = new Set(['starts', 'ends', 'mixed'])

const validateVerseEntry = entry => {
  const errors = []
  if (!entry || typeof entry !== 'object') return ['Запись стиха отсутствует.']
  if (!/^[a-z0-9][a-z0-9-]{2,80}$/i.test(String(entry.id || ''))) errors.push('Нужен устойчивый ID.')
  if (!String(entry.bookId || '').trim() || !String(entry.book || '').trim()) errors.push('Укажите книгу Библии.')
  if (!Number.isInteger(Number(entry.chapter)) || Number(entry.chapter) < 1) errors.push('Укажите корректную главу.')
  if (!/^\d+(?:-\d+)?$/.test(String(entry.verse || ''))) errors.push('Укажите стих или диапазон.')
  if (!String(entry.translation || '').trim()) errors.push('Укажите перевод.')
  const full = normalizeText(entry.fullText)
  const start = normalizeText(entry.start)
  const end = normalizeText(entry.end)
  if (!full || !start || !end) errors.push('Полный текст, начало и окончание не могут быть пустыми.')
  if (full && normalizeText(`${start} ${end}`) !== full) errors.push('Начало и окончание должны точно составлять полный текст.')
  if (!allowedDifficulties.has(entry.difficulty)) errors.push('Выберите сложность.')
  if (!['draft', 'verified', 'rejected'].includes(entry.verificationStatus)) errors.push('Укажите состояние проверки.')
  return errors
}

const validateVersePack = pack => {
  const entries = Array.isArray(pack?.entries) ? pack.entries : []
  const issues = []
  const ids = new Set()
  const references = new Map()
  const starts = new Map()
  const ends = new Map()
  entries.forEach((entry, index) => {
    validateVerseEntry(entry).forEach(message => issues.push({ entryId: entry?.id || `row-${index + 1}`, message }))
    const id = String(entry?.id || '')
    if (ids.has(id)) issues.push({ entryId: id, message: 'Повторяется устойчивый ID.' })
    ids.add(id)
    const reference = normalizeText(entry?.reference).toLocaleLowerCase('ru-RU')
    if (reference && references.has(reference)) issues.push({ entryId: id, message: `Повторяется ссылка ${entry.reference}.` })
    references.set(reference, id)
    if (entry?.enabled && entry?.verificationStatus === 'verified') {
      const start = normalizeText(entry.start).toLocaleLowerCase('ru-RU')
      const end = normalizeText(entry.end).toLocaleLowerCase('ru-RU')
      if (starts.has(start)) issues.push({ entryId: id, message: 'Начало неоднозначно внутри набора.' })
      if (ends.has(end)) issues.push({ entryId: id, message: 'Окончание неоднозначно внутри набора.' })
      starts.set(start, id); ends.set(end, id)
    }
  })
  const counts = Object.fromEntries([...allowedDifficulties].map(level => [level, entries.filter(entry => entry.enabled && entry.verificationStatus === 'verified' && entry.difficulty === level).length]))
  return { valid: issues.length === 0 && entries.length > 0, issues, counts }
}

const shuffle = (items, random = Math.random) => {
  const result = [...items]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1)); [result[index], result[target]] = [result[target], result[index]]
  }
  return result
}

const cardDirection = (setting, index) => setting === 'mixed' ? (index % 2 === 0 ? 'end' : 'start') : setting === 'starts' ? 'start' : 'end'

const startVerseGame = (source, random = Math.random, at = Date.now()) => {
  const game = clone(source)
  if (game.phase !== 'lobby') return { game, reused: true }
  const participants = Object.values(asObject(game.participants)).sort((left, right) => left.joinedAt - right.joinedAt)
  if (!participants.length) throw new Error('Подключите хотя бы одного участника.')
  const cardsPerPlayer = Number(game.config.cardsPerPlayer)
  if (![5, 7, 10].includes(cardsPerPlayer)) throw new Error('Количество карточек должно быть 5, 7 или 10.')
  if (!allowedDirections.has(game.config.direction)) throw new Error('Неизвестное направление фрагментов.')
  const eligible = game.packSnapshot.entries.filter(entry => entry.enabled && entry.verificationStatus === 'verified' && entry.difficulty === game.config.difficulty)
  const required = participants.length * cardsPerPlayer
  if (eligible.length < required) throw new Error(`Недостаточно стихов: доступно ${eligible.length}, требуется ${required}.`)
  const selected = shuffle(eligible, random).slice(0, required)
  const cardsByParticipant = Object.fromEntries(participants.map(item => [item.id, []]))
  selected.forEach((entry, index) => {
    const owner = participants[index % participants.length]
    const direction = cardDirection(game.config.direction, index)
    cardsByParticipant[owner.id].push({
      cardId: `card-${index + 1}`, verseId: entry.id, ownerId: owner.id, direction,
      fragment: direction === 'end' ? entry.end : entry.start, status: 'available',
    })
  })
  participants.forEach(participant => {
    game.participants[participant.id] = { ...participant, cards: Object.fromEntries(cardsByParticipant[participant.id].map(card => [card.cardId, card])), attempts: {}, correct: 0, errors: 0, missed: 0 }
  })
  const queue = []
  for (let cardIndex = 0; cardIndex < cardsPerPlayer; cardIndex += 1) {
    shuffle(participants, random).forEach(participant => {
      const card = cardsByParticipant[participant.id][cardIndex]
      queue.push({ roundId: `round-${queue.length + 1}`, cardId: card.cardId, ownerId: participant.id, verseId: card.verseId })
    })
  }
  game.queue = queue
  game.phase = 'live'; game.startedAt = at; game.version = Number(game.version || 0) + 1; game.history = []
  return { game: openNextRound(game, at), reused: false }
}

const findCard = (game, ownerId, cardId) => game.participants?.[ownerId]?.cards?.[cardId]
const verseById = (game, verseId) => game.packSnapshot.entries.find(entry => entry.id === verseId)

const openNextRound = (source, at = Date.now()) => {
  const game = clone(source)
  if (game.currentRound?.status === 'open') return game
  let cursor = Number(game.queueCursor || 0)
  let queued = null
  while (cursor < game.queue.length) {
    const candidate = game.queue[cursor]; cursor += 1
    if (findCard(game, candidate.ownerId, candidate.cardId)?.status === 'available') { queued = candidate; break }
  }
  game.queueCursor = cursor
  if (!queued) {
    game.currentRound = null; game.phase = 'completed'; game.completedAt = at; game.results = rankVerseResults(game, false)
    return game
  }
  const card = findCard(game, queued.ownerId, queued.cardId)
  const verse = verseById(game, queued.verseId)
  game.currentRound = {
    roundId: queued.roundId, version: Number(game.version || 0) + 1, status: 'open',
    cardId: queued.cardId, ownerId: queued.ownerId, verseId: queued.verseId,
    promptDirection: card.direction === 'end' ? 'start' : 'end',
    promptText: card.direction === 'end' ? verse.start : verse.end,
    openedAt: at, attempts: {},
  }
  game.version = game.currentRound.version
  return game
}

const submitVerseCard = (source, input, at = Date.now()) => {
  const game = clone(source)
  const round = game.currentRound
  if (game.phase !== 'live' || !round || round.status !== 'open') return { game, accepted: false, reason: 'round-closed' }
  if (round.roundId !== input.roundId || Number(round.version) !== Number(input.roundVersion)) return { game, accepted: false, reason: 'stale-round' }
  const participant = game.participants?.[input.participantId]
  if (!participant) return { game, accepted: false, reason: 'not-participant' }
  if (round.attempts?.[input.participantId]) return { game, accepted: false, reason: 'already-attempted' }
  const card = participant.cards?.[input.cardId]
  if (!card || card.ownerId !== input.participantId) return { game, accepted: false, reason: 'not-owner' }
  if (card.status !== 'available') return { game, accepted: false, reason: 'card-closed' }
  // Realtime Database omits empty arrays/objects. Restore the mutable
  // collections before recording the first answer in a persisted round.
  round.attempts = asObject(round.attempts)
  participant.attempts = asObject(participant.attempts)
  game.history = Array.isArray(game.history) ? game.history : Object.values(asObject(game.history))
  const correct = card.verseId === round.verseId && card.cardId === round.cardId && round.ownerId === input.participantId
  round.attempts[input.participantId] = { cardId: card.cardId, acceptedAt: at, correct }
  participant.attempts[round.roundId] = {
    cardId: card.cardId,
    acceptedAt: at,
    correct,
    promptText: round.promptText,
    promptDirection: round.promptDirection,
  }
  if (correct) {
    card.status = 'correct'; card.closedAt = at; participant.correct += 1
    const verse = verseById(game, card.verseId)
    round.status = 'revealed'; round.outcome = 'correct'; round.answeredBy = input.participantId; round.answeredByName = participant.nickname; round.fullText = verse.fullText; round.reference = verse.reference; round.closedAt = at
    game.history.push(clone(round))
  } else {
    card.status = 'error'; card.closedAt = at; participant.errors += 1
  }
  game.version += 1
  return { game, accepted: true, correct }
}

const revealVerseAnswer = (source, at = Date.now()) => {
  const game = clone(source); const round = game.currentRound
  if (game.phase !== 'live' || !round || round.status !== 'open') return { game, accepted: false, reason: 'round-closed' }
  const card = findCard(game, round.ownerId, round.cardId)
  if (!card || card.status !== 'available') return { game: openNextRound(game, at), accepted: false, reason: 'card-closed' }
  const owner = game.participants[round.ownerId]; const verse = verseById(game, round.verseId)
  game.history = Array.isArray(game.history) ? game.history : Object.values(asObject(game.history))
  card.status = 'missed'; card.closedAt = at; owner.missed += 1
  round.status = 'revealed'; round.outcome = 'missed'; round.fullText = verse.fullText; round.reference = verse.reference; round.closedAt = at
  game.history.push(clone(round)); game.version += 1
  return { game, accepted: true }
}

const continueVerseGame = (source, at = Date.now()) => {
  const game = clone(source)
  if (game.phase !== 'live') return game
  if (game.currentRound?.status === 'open') return game
  game.currentRound = null
  return openNextRound(game, at)
}

const rankVerseResults = (game, interim = false) => {
  const rows = Object.values(asObject(game.participants)).map(participant => {
    const cards = Object.values(asObject(participant.cards)); const total = cards.length
    const correct = cards.filter(card => card.status === 'correct').length
    const errors = cards.filter(card => card.status === 'error').length
    const missed = cards.filter(card => card.status === 'missed').length
    const remaining = cards.filter(card => card.status === 'available').length
    return { participantId: participant.id, nickname: participant.nickname, correct, errors, missed, remaining, total, percentage: total ? Math.round(correct / total * 100) : 0, perfect: !interim && total > 0 && correct === total && errors === 0 && missed === 0 }
  })
  if (interim) return rows.sort((a, b) => b.correct - a.correct || a.errors - b.errors || a.nickname.localeCompare(b.nickname, 'ru')).map(row => ({ ...row, place: null }))
  const perfect = rows.filter(row => row.perfect).sort((a, b) => a.nickname.localeCompare(b.nickname, 'ru')).map(row => ({ ...row, place: 1 }))
  const rest = rows.filter(row => !row.perfect).sort((a, b) => b.correct - a.correct || a.errors - b.errors || a.nickname.localeCompare(b.nickname, 'ru'))
  let place = 1; let lastKey = ''
  const ranked = rest.map(row => {
    const key = `${row.correct}:${row.errors}`
    if (key !== lastKey) { place += 1; lastKey = key }
    return { ...row, place }
  })
  return [...perfect, ...ranked]
}

const finishVerseGame = (source, early, at = Date.now()) => {
  const game = clone(source)
  if (game.phase === 'closed') return game
  game.phase = 'closed'; game.endedEarly = Boolean(early); game.closedAt = at; game.currentRound = null; game.results = rankVerseResults(game, Boolean(early)); game.version += 1
  return game
}

module.exports = {
  normalizeText, validateVerseEntry, validateVersePack, startVerseGame, openNextRound,
  submitVerseCard, revealVerseAnswer, continueVerseGame, rankVerseResults, finishVerseGame,
}
