import { categories } from '../../data/questions'
import type { Answer, DiagnosticQuestion } from '../../types'
import type { ParticipantQuestionScreenProps } from '../participantTypes'

export function DiagnosticParticipantQuestionScreen({ question, currentIndex, total, saving, notice, onAnswer }: ParticipantQuestionScreenProps) {
  const diagnostic = question as DiagnosticQuestion
  const done = Math.round(currentIndex / total * 100)
  return <><div className="question-top"><div><span>ВОПРОС {currentIndex + 1} / {total}</span><small>{categories[diagnostic.category]}</small></div><b>{done}%</b></div><div className="question-progress"><i style={{ width: `${done}%` }} /></div><h1 className="question">{diagnostic.title}</h1><p>Выбери вариант, который ближе всего к тебе.</p><div className="options answer-options">{(['A', 'B', 'C', 'D'] as Answer[]).map(letter => <button className="option" disabled={saving} key={letter} onClick={() => onAnswer(letter)}><b>{letter}</b><span>{diagnostic.options[letter]}</span></button>)}</div><div className="question-footer"><button className="mobile-action secondary" disabled={saving} onClick={() => onAnswer('SKIP')}>Пропустить вопрос</button><small>Но это может стоить вам <b>баллов.</b></small></div>{notice && <p className="flow-error">{notice}</p>}</>
}
