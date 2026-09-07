const assert = require('node:assert/strict')
const { existingQuizAnswer } = require('./quizAnswerPolicy')

assert.deepEqual(existingQuizAnswer({ answers: {}, currentQuestionIndex: 8 }, 'q9', 'D'), { kind: 'new' })
assert.deepEqual(
  existingQuizAnswer({ answers: { q9: 'D' }, currentQuestionIndex: 9, status: 'answering' }, 'q9', 'D'),
  { kind: 'replayed', nextIndex: 9, status: 'answering' },
)
assert.deepEqual(
  existingQuizAnswer({ answers: { q15: 'A' }, currentQuestionIndex: 15, status: 'finished' }, 'q15', 'A'),
  { kind: 'replayed', nextIndex: 15, status: 'finished' },
)
assert.deepEqual(existingQuizAnswer({ answers: { q9: 'D' } }, 'q9', 'A'), { kind: 'conflict' })

console.log('Quiz answer idempotency contract passed.')
