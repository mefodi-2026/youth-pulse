const assert = require('node:assert/strict')
const pack = require('./data/proverbs-pack-v1.json')
const { validateVersePack, startVerseGame, submitVerseCard, revealVerseAnswer, continueVerseGame, rankVerseResults, finishVerseGame } = require('./verseMatchEngine')

const validation = validateVersePack(pack)
assert.equal(validation.valid, true, JSON.stringify(validation.issues))
assert.deepEqual(validation.counts, { easy: 10, medium: 10, hard: 10 })

const participants = Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`p${index}`, { id: `p${index}`, nickname: `Игрок ${index}`, joinedAt: index }]))
const syntheticEntries = Array.from({ length: 200 }, (_, index) => ({ id: `test-${index}`, bookId: 'TEST', book: 'Тест', chapter: 1, verse: String(index + 1), reference: `Тест 1:${index + 1}`, translation: 'Тестовые данные', fullText: `Начало ${index} окончание ${index}`, start: `Начало ${index}`, end: `окончание ${index}`, difficulty: 'easy', enabled: true, verificationStatus: 'verified' }))
const source = { phase: 'lobby', version: 1, config: { cardsPerPlayer: 10, difficulty: 'easy', direction: 'mixed' }, packSnapshot: { entries: syntheticEntries }, participants }
const started = startVerseGame(source, () => 0.42, 100).game
assert.equal(started.queue.length, 200)
assert.equal(new Set(started.queue.map(item => item.verseId)).size, 200)
assert.equal(Object.values(started.participants).every(item => Object.keys(item.cards).length === 10), true)
assert.equal(started.queue.slice(0, 20).every((item, index, items) => index === 0 || item.ownerId !== items[index - 1].ownerId), true)
const directionCounts = Object.values(started.participants).flatMap(item => Object.values(item.cards)).reduce((counts, card) => ({ ...counts, [card.direction]: (counts[card.direction] || 0) + 1 }), {})
assert.deepEqual(directionCounts, { end: 100, start: 100 })

for (const cardsPerPlayer of [5, 7, 10]) {
  for (const direction of ['starts', 'ends', 'mixed']) {
    const sample = startVerseGame({ ...source, config: { ...source.config, cardsPerPlayer, direction } }, () => 0.31, 90).game
    assert.equal(sample.queue.length, 20 * cardsPerPlayer)
    const directions = new Set(Object.values(sample.participants).flatMap(item => Object.values(item.cards)).map(card => card.direction))
    assert.deepEqual([...directions].sort(), direction === 'starts' ? ['start'] : direction === 'ends' ? ['end'] : ['end', 'start'])
  }
}
const insufficient = { ...source, config: { ...source.config, cardsPerPlayer: 10 }, packSnapshot: { entries: syntheticEntries.slice(0, 199) } }
assert.throws(() => startVerseGame(insufficient, () => 0.1, 95), /Недостаточно стихов/)
assert.equal(Object.values(insufficient.participants).every(item => !item.cards), true, 'failed start must not partially distribute cards')

const round = started.currentRound
const owner = started.participants[round.ownerId]
const rightCard = owner.cards[round.cardId]
const wrongPlayer = Object.values(started.participants).find(item => item.id !== owner.id)
const wrongCard = Object.values(wrongPlayer.cards)[0]
const wrong = submitVerseCard(started, { participantId: wrongPlayer.id, cardId: wrongCard.cardId, roundId: round.roundId, roundVersion: round.version }, 200)
assert.equal(wrong.accepted, true); assert.equal(wrong.correct, false); assert.equal(wrong.game.currentRound.status, 'open'); assert.equal(wrong.game.participants[wrongPlayer.id].cards[wrongCard.cardId].status, 'error')
const duplicate = submitVerseCard(wrong.game, { participantId: wrongPlayer.id, cardId: Object.values(wrong.game.participants[wrongPlayer.id].cards)[1].cardId, roundId: round.roundId, roundVersion: wrong.game.currentRound.version }, 201)
assert.equal(duplicate.accepted, false); assert.equal(duplicate.reason, 'already-attempted')
const correct = submitVerseCard(wrong.game, { participantId: owner.id, cardId: rightCard.cardId, roundId: round.roundId, roundVersion: wrong.game.currentRound.version }, 202)
assert.equal(correct.accepted, true); assert.equal(correct.correct, true); assert.equal(correct.game.currentRound.status, 'revealed')
const late = submitVerseCard(correct.game, { participantId: owner.id, cardId: rightCard.cardId, roundId: round.roundId, roundVersion: round.version }, 203)
assert.equal(late.accepted, false); assert.equal(late.reason, 'round-closed')

let missedGame = continueVerseGame(correct.game, 300)
const missedRound = missedGame.currentRound
const missed = revealVerseAnswer(missedGame, 301)
assert.equal(missed.accepted, true); assert.equal(missed.game.participants[missedRound.ownerId].cards[missedRound.cardId].status, 'missed')

const resultsGame = JSON.parse(JSON.stringify(started))
const resultPlayers = Object.values(resultsGame.participants)
Object.values(resultPlayers[0].cards).forEach(card => { card.status = 'correct' })
Object.values(resultPlayers[1].cards).slice(0, 8).forEach(card => { card.status = 'correct' })
Object.values(resultPlayers[2].cards).slice(0, 8).forEach(card => { card.status = 'correct' })
Object.values(resultPlayers[3].cards).slice(0, 7).forEach(card => { card.status = 'correct' })
Object.values(resultPlayers[2].cards).slice(8, 9).forEach(card => { card.status = 'error' })
const ranked = rankVerseResults(resultsGame, false)
assert.equal(ranked.find(row => row.participantId === resultPlayers[0].id).place, 1)
assert.equal(ranked.find(row => row.participantId === resultPlayers[1].id).place, 2)
assert.equal(ranked.find(row => row.participantId === resultPlayers[2].id).place, 3)
assert.equal(ranked.find(row => row.participantId === resultPlayers[3].id).place, 4)
Object.values(resultPlayers[1].cards).forEach(card => { card.status = 'correct' })
const twoPerfect = rankVerseResults(resultsGame, false)
assert.equal(twoPerfect.filter(row => row.place === 1).length, 2, 'all perfect players share first place')
Object.values(resultPlayers[0].cards).slice(0, 1).forEach(card => { card.status = 'error' })
Object.values(resultPlayers[1].cards).slice(0, 1).forEach(card => { card.status = 'error' })
const noPerfect = rankVerseResults(resultsGame, false)
assert.equal(noPerfect.some(row => row.place === 1), false, 'first place stays empty without a perfect result')
assert.equal(noPerfect.find(row => row.participantId === resultPlayers[0].id).place, noPerfect.find(row => row.participantId === resultPlayers[1].id).place, 'equal results share a place')
const early = finishVerseGame(started, true, 400)
assert.equal(early.endedEarly, true); assert.equal(early.results.every(row => row.place === null), true)

const snapshotGame = startVerseGame(source, () => 0.2, 500).game
source.packSnapshot.entries[0].fullText = 'Изменённый после запуска текст'
assert.notEqual(snapshotGame.packSnapshot.entries[0].fullText, source.packSnapshot.entries[0].fullText, 'running room must keep its immutable pack snapshot')

console.log('Verse match engine contracts passed.')
