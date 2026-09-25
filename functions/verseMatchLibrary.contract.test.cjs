const assert = require('node:assert/strict')
const pack = require('./data/proverbs-pack-v2.json')
const catalog = require('./data/verse-match-catalog.json')
const { validateVersePack, startVerseGame } = require('./verseMatchEngine')

assert.equal(pack.entries.length, 918, 'selected RUSSYN edition must contain all 918 Proverbs verse records')
assert.deepEqual(pack.chapterVerseCounts, [33,22,35,29,23,35,27,36,18,32,31,28,26,35,33,33,28,24,29,30,31,29,35,34,28,28,27,28,27,33,31])
const playable = pack.entries.filter(entry => entry.enabled && entry.verificationStatus === 'verified')
assert.equal(playable.length, 916, 'two exact repeated texts stay catalogued but are not playable')
const counts = playable.reduce((result, entry) => ({ ...result, [entry.difficulty]: (result[entry.difficulty] || 0) + 1 }), {})
assert.deepEqual(counts, { medium: 305, easy: 306, hard: 305 })
assert.ok(Math.max(...Object.values(counts)) - Math.min(...Object.values(counts)) <= 1)
assert.equal(validateVersePack(pack).valid, true)
for (const entry of pack.entries) {
  assert.equal(`${entry.start} ${entry.end}`.replace(/\s+/g, ' ').trim(), entry.fullText)
  assert.equal(entry.translationId, 'russyn-1876')
}
assert.equal(new Set(pack.entries.map(entry => entry.id)).size, 918)
assert.equal(new Set(pack.entries.map(entry => `${entry.chapter}:${entry.verse}`)).size, 918)
assert.equal(catalog.books[0].translations.find(item => item.translationId === 'nrt').status, 'license-required')
assert.equal(catalog.books[0].translations.find(item => item.translationId === 'nrt').packId, null)

const gameFor = (difficulty, playerCount, cardsPerPlayer) => ({
  roomId: 'TEST01', phase: 'lobby', version: 1, config: { difficulty, cardsPerPlayer, direction: 'ends' }, packSnapshot: pack,
  participants: Object.fromEntries(Array.from({ length: playerCount }, (_, index) => [`p${index}`, { id: `p${index}`, nickname: `P${index}`, joinedAt: index }])),
})
for (const cards of [5, 7, 10]) {
  const { game } = startVerseGame(gameFor('easy', 5, cards), () => 0.314159, 1)
  const verseIds = Object.values(game.participants).flatMap(participant => Object.values(participant.cards).map(card => card.verseId))
  assert.equal(verseIds.length, 5 * cards)
  assert.equal(new Set(verseIds).size, verseIds.length, `${cards}-card assignment must be unique`)
  assert.equal(startVerseGame(game, () => 0.9, 2).reused, true, 'retry must preserve assignment')
}
assert.throws(() => startVerseGame(gameFor('medium', 31, 10)), /Недостаточно стихов/)
console.log('Verse match library contracts passed.')
