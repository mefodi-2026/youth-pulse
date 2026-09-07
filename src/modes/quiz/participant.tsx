import type { Answer } from '../../types'
import type { ParticipantQuestionScreenProps } from '../participantTypes'

export function QuizParticipantQuestionScreen({ question, currentIndex, total, packTitle, saving, notice, selectedAnswer, retryable, onAnswer, onRetry }: ParticipantQuestionScreenProps) {
  const done = Math.round(currentIndex / total * 100)
  return <><div className="question-top"><div><span>ВОПРОС {currentIndex + 1} / {total}</span><small>{packTitle || 'Библейская викторина'}</small></div><b>{done}%</b></div><div className="question-progress"><i style={{ width: `${done}%` }} /></div><h1 className="question">{question.title}</h1><p>Выбери один правильный вариант ответа.</p><div className="options answer-options">{(['A', 'B', 'C', 'D'] as Answer[]).map(letter => <button className={`option${selectedAnswer === letter ? ' is-pending' : ''}`} disabled={saving} key={letter} onClick={() => onAnswer(letter)}><b>{letter}</b><span>{question.options[letter]}</span></button>)}</div>{notice && <div className="answer-error" role="alert"><p className="flow-error">{notice}</p>{retryable && onRetry && <button type="button" className="answer-retry" disabled={saving} onClick={onRetry}>Повторить отправку</button>}</div>}</>
}
