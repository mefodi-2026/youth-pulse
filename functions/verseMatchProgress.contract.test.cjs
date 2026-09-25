const assert = require('node:assert/strict')
const { difficultyLevels, normalizeProgress, isDifficultyUnlocked, isCredibleOfficialCompletion, unlockForCompletion } = require('./verseMatchProgress')

assert.deepEqual(difficultyLevels({ difficulty: 'easy' }), ['easy'])
assert.deepEqual(difficultyLevels({ difficulty: 'mixed', difficultyMix: ['easy', 'hard', 'easy'] }), ['easy', 'hard'])
assert.deepEqual(difficultyLevels({ difficulty: 'all' }), ['easy', 'medium', 'hard'])
assert.throws(() => difficultyLevels({ difficulty: 'mixed', difficultyMix: ['easy'] }), /минимум две/)

const initial = normalizeProgress(null, 'PRO')
assert.equal(isDifficultyUnlocked(initial, 'easy'), true)
assert.equal(isDifficultyUnlocked(initial, 'medium'), false)
assert.equal(isDifficultyUnlocked(initial, 'hard'), false)

const completedGame = difficulty => ({
  roomId: `ROOM-${difficulty}`, hostUid: 'host', config: { difficulty }, progression: { official: true, bookId: 'PRO' },
  completedAt: 100, endedEarly: false, queueCursor: 1, queue: [{ roundId: 'r1' }], participants: { p1: { cards: { c1: { status: 'correct' } } } },
})
const afterEasy = unlockForCompletion(initial, completedGame('easy'), 101)
assert.equal(afterEasy.unlocked.medium, true)
assert.equal(afterEasy.unlocked.hard, false)
const afterMedium = unlockForCompletion(afterEasy, completedGame('medium'), 102)
assert.equal(afterMedium.unlocked.hard, true)
assert.equal(afterMedium.unlocked.mixed, true)
assert.equal(afterMedium.unlocked.all, true)
assert.deepEqual(unlockForCompletion(afterMedium, completedGame('medium'), 103), afterMedium, 'retry must be idempotent')

for (const invalid of [
  { ...completedGame('easy'), endedEarly: true },
  { ...completedGame('easy'), participants: {} },
  { ...completedGame('easy'), completedAt: null },
  { ...completedGame('easy'), progression: { official: false, bookId: 'PRO' } },
  { ...completedGame('easy'), participants: { p1: { cards: { c1: { status: 'available' } } } } },
]) assert.equal(isCredibleOfficialCompletion(invalid), false)

const personal = { ...completedGame('easy'), roomId: 'PERSONAL', progression: { official: false, bookId: 'PRO' } }
assert.deepEqual(unlockForCompletion(initial, personal, 110), initial)
console.log('Verse match progress contracts passed.')
