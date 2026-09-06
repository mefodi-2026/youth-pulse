import { useEffect, useState } from 'react'
import { questions } from './data/questions'
import { ensureAuth, firebaseReady, subscribeSession } from './repositories/firebaseRepository'
import { getGameModule } from './lib/gameRegistry'
import { type Participant, type Session } from './types'
import { getModeManifest } from './modes/modeRegistry'

const demoKey = (room: string) => `atmosphere-demo-${room}`
const getDemo = (room: string) => JSON.parse(localStorage.getItem(demoKey(room)) || 'null') as Session | null
const setDemo = (session: Session) => { localStorage.setItem(demoKey(session.roomId), JSON.stringify(session)); window.dispatchEvent(new StorageEvent('storage', { key: demoKey(session.roomId) })) }

function useStageSession(room: string) {
  const [session, setSession] = useState<Session | null>(null)
  const [state, setState] = useState<'connecting' | 'ready' | 'error'>('connecting')
  useEffect(() => {
    if (!room) { setState('error'); return }
    if (!firebaseReady) {
      setSession(getDemo(room)); setState('ready')
      const sync = (event: StorageEvent) => { if (event.key === demoKey(room)) setSession(getDemo(room)) }
      window.addEventListener('storage', sync)
      return () => window.removeEventListener('storage', sync)
    }
    let active = true
    let unsubscribe: () => void = () => undefined
    const timeout = window.setTimeout(() => { if (active) setState('error') }, 12000)
    setState('connecting')
    void ensureAuth().then(() => {
      if (!active) return
      unsubscribe = subscribeSession(room, value => { if (active) { window.clearTimeout(timeout); setSession(value); setState('ready') } }, () => { if (active) { window.clearTimeout(timeout); setState('error') } })
    }).catch(() => { if (active) { window.clearTimeout(timeout); setState('error') } })
    return () => { active = false; window.clearTimeout(timeout); unsubscribe() }
  }, [room])
  return [session, setSession, state] as const
}

const Metric = ({ value, label, caption }: { value: number; label: string; caption: string }) => <div className="stage-stat"><strong>{value}</strong><div><b>{label}</b><small>{caption}</small></div></div>

export function StageDashboard({ room }: { room: string }) {
  const [session, , state] = useStageSession(room)

  if (!session) return <main className="stage-dashboard stage-loading"><div className="stage-light" /><p className="eyebrow">ЭКРАН ПРОГРЕССА</p><h1>{state === 'error' ? 'Не удалось подключиться к комнате' : 'Подключаемся к сессии'}</h1><p>{state === 'error' ? 'Проверьте соединение и откройте экран ещё раз.' : 'Загружаем живые данные участников…'}</p>{state === 'error' ? <button className="stage-retry" onClick={() => window.location.reload()}>Повторить</button> : <span className="stage-spinner" />}</main>

  const ModeMainScreen = getModeManifest(session.gameTypeId || session.mode).mainScreen
  if (ModeMainScreen) return <ModeMainScreen session={session} />

  const people = Object.values(session.participants || {}) as Participant[]
  const activeQuestionCount = getGameModule(session.gameTypeId).getQuestions(session, questions).length
  const answered = people.reduce((sum, participant) => sum + Object.keys(participant.answers || {}).length, 0)
  const totalAnswers = Math.max(people.length * activeQuestionCount, 1)
  const finished = people.filter(person => person.status === 'finished').length
  const viewed = people.filter(person => Boolean(person.personalViewedAt)).length
  const progress = Math.round(answered / totalAnswers * 100)
  const isQuiz = session.mode === 'quiz' || session.gameTypeId === 'quiz'
  const ready = people.length > 0 && finished === people.length
  const phaseLabel = session.phase === 'lobby' ? 'Собираем участников' : ready ? 'Все участники завершили' : 'Участники выполняют задания'

  if (session.phase === 'resultsIntro' || session.phase === 'resultsReal') return <main className={`stage-dashboard stage-results-view ${isQuiz ? 'quiz-stage' : ''}`} data-stage-mode={isQuiz ? 'quiz' : session.mode}><div className="stage-light" /><header className="stage-header"><div><p className="eyebrow">ОБЩИЙ РЕЗУЛЬТАТ · {isQuiz ? 'БИБЛЕЙСКАЯ ВИКТОРИНА' : 'ПРОВЕРЬ СЕБЯ'}</p><h1>{isQuiz ? 'Победители и результаты' : 'Наша общая картина'}</h1></div><span className="stage-ready">РЕЗУЛЬТАТЫ ОТКРЫТЫ</span></header><section className="stage-hero-card stage-results-message"><div className="stage-hero-copy"><p className="eyebrow">ПОКАЗ СИНХРОНИЗИРОВАН</p><strong>{finished}<small>/{people.length}</small></strong><p>{isQuiz ? 'Ведущий открыл итоговый рейтинг. Победители показаны на его общем экране.' : 'Ведущий открыл общую диаграмму. Личные ответы и карточки участников не отображаются.'}</p></div><div className="stage-ring"><b>✓</b><span>общий<br />результат</span></div></section><p className="stage-privacy">Этот экран переключился по действию ведущего. Он не создаёт и не меняет данные комнаты.</p></main>

  return <main className={`stage-dashboard ${isQuiz ? 'quiz-stage' : ''}`} data-stage-mode={isQuiz ? 'quiz' : session.mode}><div className="stage-light" /><header className="stage-header"><div><p className="eyebrow">{isQuiz ? 'БИБЛЕЙСКАЯ ВИКТОРИНА' : 'ПРОВЕРЬ СЕБЯ'}</p><h1>{phaseLabel}</h1></div><span className={ready ? 'stage-ready' : 'stage-live'}>{ready ? 'ВСЁ ГОТОВО' : 'ЭФИР ИДЁТ'}</span></header><section className="stage-hero-card"><div className="stage-hero-copy"><p className="eyebrow">ОБЩИЙ ПРОГРЕСС</p><strong>{progress}<small>%</small></strong><p>{ready ? 'Все участники завершили. Ведущий может открыть общий результат.' : 'Участники выполняют задания в своём темпе. Личные ответы не отображаются.'}</p></div><div className="stage-ring"><b>{finished}</b><span>из {people.length || '—'}<br />завершили</span></div><div className="stage-progress-track"><i style={{ width: `${progress}%` }} /></div><span className="stage-progress-note">Завершили {finished} из {people.length || 0} · {answered} из {totalAnswers} ответов</span></section><section className="stage-stats"><Metric value={people.length} label="Подключились" caption="участников в комнате" /><Metric value={people.filter(person => person.status === 'answering').length} label="Сейчас проходят" caption={isQuiz ? 'викторину' : '«Проверь себя»'} /><Metric value={finished} label="Завершили" caption={`из ${people.length || 0} участников`} /><Metric value={viewed} label="Открыли карточку" caption="увидели личный результат" /></section><section className={`stage-result-control ${ready ? 'is-ready' : ''}`}><div><p className="eyebrow">ОБЩИЙ РЕЗУЛЬТАТ</p><h2>{ready ? 'Готов к показу ведущим' : 'Результат пока закрыт'}</h2><p>{ready ? 'Ведущий сам решает, когда синхронно открыть общий результат.' : `Ждём: завершили ${finished} из ${people.length || 0}.`}</p></div><span className="stage-results-button">{ready ? 'Ждём ведущего' : 'Идёт прохождение'}</span></section><p className="stage-privacy">На этом экране — только общий ход сессии. Имена и ответы участников не показываются.</p></main>
}
