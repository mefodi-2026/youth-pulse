/**
 * Determines whether a retried quiz submission is a harmless replay or a
 * conflicting second answer. Keeping this pure makes the callable's
 * idempotency rule testable without Firebase.
 */
const existingQuizAnswer = (participant, questionId, answer) => {
  const answers = participant?.answers || {}
  if (!Object.prototype.hasOwnProperty.call(answers, questionId)) return { kind: 'new' }
  if (answers[questionId] === answer) {
    return {
      kind: 'replayed',
      nextIndex: Number(participant.currentQuestionIndex || 0),
      status: participant.status === 'finished' ? 'finished' : 'answering',
    }
  }
  return { kind: 'conflict' }
}

module.exports = { existingQuizAnswer }
