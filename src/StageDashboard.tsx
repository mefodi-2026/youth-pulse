import { useEffect, useState } from 'react'
import { questions } from './data/questions'
import { ensureAuth, firebaseReady, subscribeSession, updatePhase } from './repositories/firebaseRepository'
import { getGameModule } from './lib/gameRegistry'
import { type Participant, type Session } from './types'
import { appBasePath } from './lib/urls'
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
    setState('connecting')
    void ensureAuth().then(() => {
      if (!active) return
      unsubscribe = subscribeSession(room, value => { if (active) { setSession(value); setState('ready') } }, () => { if (active) setState('error') })
    }).catch(() => { if (active) setState('error') })
    return () => { active = false; unsubscribe() }
  }, [room])
  return [session, setSession, state] as const
}

const Metric = ({ value, label, caption }: { value: number; label: string; caption: string }) => <div className="stage-stat"><strong>{value}</strong><div><b>{label}</b><small>{caption}</small></div></div>

export function StageDashboard({ room }: { room: string }) {
  const [session, setSession, state] = useStageSession(room)
  const [opening, setOpening] = useState(false)

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
  const ready = people.length > 0 && finished === people.length && (isQuiz || viewed === people.length)
  const phaseLabel = session.phase === 'lobby' ? 'Собираем участников' : ready ? 'Группа готова к общему результату' : `Ждём завершения ${isQuiz ? 'викторины' : 'режима «Проверь себя»'}`
  const reveal = async () => {
    if (!ready || opening) return
    setOpening(true)
    try {
      if (firebaseReady) {
        await updatePhase(room, 'resultsIntro')
        window.setTimeout(() => { void updatePhase(room, 'resultsReal') }, 20000)
      } else {
        const next = { ...session, phase: 'resultsIntro' as const, resultsIntroStartedAt: Date.now() }
        setDemo(next); setSession(next)
        window.setTimeout(() => { const real = { ...next, phase: 'resultsReal' as const }; setDemo(real); setSession(real) }, 20000)
      }
      window.location.assign(`${appBasePath()}/host?tab=results&room=${encodeURIComponent(room)}`)
    } catch { setOpening(false) }
  }

  return <main className="stage-dashboard"><div className="stage-light" /><header className="stage-header"><div><p className="eyebrow">{isQuiz ? 'БИБЛЕЙСКАЯ ВИКТОРИНА' : 'ПРОВЕРЬ СЕБЯ'}</p><h1>{phaseLabel}</h1></div><span className={ready ? 'stage-ready' : 'stage-live'}>{ready ? 'ВСЁ ГОТОВО' : 'ЭФИР ИДЁТ'}</span></header><section className="stage-hero-card"><div className="stage-hero-copy"><p className="eyebrow">ОБЩИЙ ПРОГРЕСС</p><strong>{progress}<small>%</small></strong><p>{finished === people.length && people.length ? 'Ответы завершены. Ждём, пока каждый откроет личный результат.' : 'Участники отвечают в своём темпе. Личные ответы не отображаются.'}</p></div><div className="stage-ring"><b>{finished}</b><span>из {people.length || '—'}<br />завершили</span></div><div className="stage-progress-track"><i style={{ width: `${progress}%` }} /></div><span className="stage-progress-note">{answered} из {totalAnswers} ответов</span></section><section className="stage-stats"><Metric value={people.length} label="Подключились" caption="участников в комнате" /><Metric value={people.filter(person => person.status === 'answering').length} label="Сейчас отвечают" caption={isQuiz ? 'проходят викторину' : 'проходят «Проверь себя»'} /><Metric value={finished} label="Завершили" caption="ответили на вопросы" /><Metric value={viewed} label="Открыли карточку" caption="увидели личный результат" /></section><section className={`stage-result-control ${ready ? 'is-ready' : ''}`}><div><p className="eyebrow">ОБЩИЙ РЕЗУЛЬТАТ</p><h2>{ready ? 'Можно показывать общую картину' : 'Результат пока закрыт'}</h2><p>{ready ? `Все участники завершили ${isQuiz ? 'викторину' : '«Проверь себя»'} и открыли личные карточки.` : `Ждём: завершили ${finished} из ${people.length || '—'}, личный результат открыли ${viewed} из ${people.length || '—'}.`}</p></div><button className="stage-results-button" disabled={!ready || opening} onClick={() => void reveal()}>{opening ? 'Открываем…' : 'Получить результаты'}</button></section><p className="stage-privacy">На этом экране — только общий ход сессии. Имена и ответы участников не показываются.</p></main>
}
