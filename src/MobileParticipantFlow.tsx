import { useEffect, useState } from 'react'
import { categories, questions } from './data/questions'
import { ensureAuth, firebaseReady, joinSession, markPersonalViewed, saveAnswer, subscribeSession, waitForAuthPersistence } from './lib/firebase'
import { scoreAnswers } from './lib/scoring'
import { downloadWishPng, printWish } from './lib/export'
import { getSessionQuestions, type Answer, type Participant, type ResponseValue, type Scores, type Session } from './types'

const demoKey = (room: string) => `atmosphere-demo-${room}`
const getDemo = (room: string) => JSON.parse(localStorage.getItem(demoKey(room)) || 'null') as Session | null
const setDemo = (session: Session) => { localStorage.setItem(demoKey(session.roomId), JSON.stringify(session)); window.dispatchEvent(new StorageEvent('storage', { key: demoKey(session.roomId) })) }

function useParticipantSession(room: string) {
  const [session, setSession] = useState<Session | null>(null)
  useEffect(() => {
    if (!room) return
    if (!firebaseReady) {
      setSession(getDemo(room)); const sync = (event: StorageEvent) => { if (event.key === demoKey(room)) setSession(getDemo(room)) }
      window.addEventListener('storage', sync); return () => window.removeEventListener('storage', sync)
    }
    let active = true; let unsubscribe: () => void = () => undefined
    void ensureAuth().then(() => { if (active) unsubscribe = subscribeSession(room, value => { if (active) setSession(value) }) })
    return () => { active = false; unsubscribe() }
  }, [room])
  return [session, setSession] as const
}

const Shell = ({ children, screen = '' }: { children: React.ReactNode; screen?: string }) => <main className="mobile-wrap mobile-flow"><div className={`mobile-card phone-screen ${screen}`}>{children}</div></main>
const Action = ({ children, onClick, disabled = false, secondary = false }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; secondary?: boolean }) => <button className={secondary ? 'mobile-action secondary' : 'mobile-action'} disabled={disabled} onClick={onClick}>{children}</button>

function ScoreRing({ score }: { score: number }) {
  const [draw, setDraw] = useState(false)
  const circumference = 301.6
  const ringScore = Math.max(0, Math.min(100, score))
  useEffect(() => { const timer = window.setTimeout(() => setDraw(true), 120); return () => window.clearTimeout(timer) }, [])
  return <div className="report-ring"><svg viewBox="0 0 120 120" aria-hidden="true"><circle className="report-ring-track" cx="60" cy="60" r="48" /><circle className="report-ring-progress" cx="60" cy="60" r="48" style={{ strokeDasharray: circumference, strokeDashoffset: draw ? circumference * (1 - ringScore / 100) : circumference }} /></svg><div><b>{score}%</b><small>общий<br />ориентир</small></div></div>
}

function PersonalReport({ participant, scores, onClose }: { participant: Participant; scores: Scores; onClose: () => void }) {
  const [showBars, setShowBars] = useState(false)
  useEffect(() => { const timer = window.setTimeout(() => setShowBars(true), 180); return () => window.clearTimeout(timer) }, [])
  return <Shell screen="report-screen"><p className="flow-label gold">ТВОЯ КАРТОЧКА</p><h1>{participant.nickname}</h1><div className="report-summary"><ScoreRing score={scores.total} /><p>Тёплая, живая атмосфера<br />с пространством<br />для роста</p></div><h2>Твои показатели</h2><div className="report-bars">{Object.entries(scores.categories).map(([id, value], index) => { const barValue = Math.max(0, Math.min(100, value)); return <div key={id} style={{ transitionDelay: `${index * 110}ms` }}><span>{categories[id as keyof typeof categories]}</span><b>{value}%</b><i><em style={{ width: showBars ? `${barValue}%` : '0%' }} /></i></div> })}</div><div className="wish-download-panel"><p>По итогам твоих ответов мы подготовили для тебя пожелания. Их можно скачать на телефон в PDF-формате или как картинку.</p><div className="report-downloads"><Action secondary onClick={() => printWish(participant, scores)}>Скачать PDF</Action><Action secondary onClick={() => downloadWishPng(participant, scores)}>Скачать PNG</Action></div></div><button className="return-link" onClick={onClose}>Вернуться к ожиданию <span>→</span></button></Shell>
}

function createPoster(participant: Participant, scores: Scores) {
  const canvas = document.createElement('canvas'); canvas.width = 1080; canvas.height = 1350
  const ctx = canvas.getContext('2d'); if (!ctx) return
  ctx.fillStyle = '#03120e'; ctx.fillRect(0, 0, 1080, 1350); ctx.fillStyle = '#32ce8b'; ctx.font = '700 32px Arial'; ctx.fillText('ДИАГНОСТИКА АТМОСФЕРЫ', 90, 100); ctx.fillStyle = '#eef5ee'; ctx.font = '700 72px Arial'; ctx.fillText(participant.nickname, 90, 205); ctx.fillStyle = '#32ce8b'; ctx.font = '700 144px Arial'; ctx.fillText(`${scores.total}%`, 90, 380)
  let y = 560; Object.entries(scores.categories).forEach(([id, value]) => { ctx.fillStyle = '#eef5ee'; ctx.font = '600 28px Arial'; ctx.fillText(categories[id as keyof typeof categories], 90, y); ctx.fillStyle = '#0d4c3a'; ctx.fillRect(90, y + 28, 900, 14); ctx.fillStyle = '#32ce8b'; ctx.fillRect(90, y + 28, 900 * value / 100, 14); y += 132 })
  const link = document.createElement('a'); link.href = canvas.toDataURL('image/png'); link.download = `карточка-${participant.nickname}.png`; link.click()
}

export function MobileParticipantFlow({ room }: { room: string }) {
  const [session, setSession] = useParticipantSession(room)
  const [screen, setScreen] = useState<'intro' | 'nickname'>('intro')
  const [name, setName] = useState('')
  const [participant, setParticipant] = useState<Participant | null>(null)
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const [reportReady, setReportReady] = useState(false)
  const [showReport, setShowReport] = useState(false)
  const [authReady, setAuthReady] = useState(!firebaseReady)
  const [authUid, setAuthUid] = useState('')
  const activeQuestions = getSessionQuestions(session, questions)

  useEffect(() => {
    let active = true
    if (!firebaseReady) return
    setAuthReady(false)
    void waitForAuthPersistence().then(user => {
      if (!active) return
      setAuthUid(user?.uid || '')
      setAuthReady(true)
    }).catch(error => {
      console.error('participant auth persistence failed', { room, error })
      if (active) { setNotice('Не удалось восстановить подключение к Firebase. Обновите страницу.'); setAuthReady(true) }
    })
    return () => { active = false }
  }, [room])
  useEffect(() => {
    if (firebaseReady && !authReady) return
    const key = `atmosphere-participant-${room}`
    const stored = localStorage.getItem(key)
    if (!stored) return
    try {
      const saved = JSON.parse(stored) as Participant
      if (firebaseReady && saved.id !== authUid) {
        localStorage.removeItem(key)
        setParticipant(null)
        return
      }
      setParticipant(saved)
    } catch { localStorage.removeItem(key) }
  }, [room, authReady, authUid])
  // Do not render Firebase's optimistic local answer update. Wait for the
  // server-confirmed write, so a rejected write cannot flash the next question.
  useEffect(() => { if (!saving && participant && session?.participants?.[participant.id]) setParticipant(session.participants[participant.id]) }, [session, participant?.id, saving])
  useEffect(() => { if (participant?.status !== 'finished' || reportReady || showReport) return; const timer = window.setTimeout(() => setReportReady(true), 2600); return () => window.clearTimeout(timer) }, [participant?.status, reportReady, showReport])

  const join = async () => {
    if (!room || name.trim().length < 2) return setNotice('Введите никнейм от 2 до 20 символов.')
    try {
      if (!session) throw new Error('Проверяем состояние комнаты. Попробуйте ещё раз через секунду.')
      if (session.phase === 'closed') throw new Error('Сессия завершена ведущим. Подключение больше недоступно.')
      const user = firebaseReady ? await ensureAuth() : null
      const next: Participant = { id: user?.uid || crypto.randomUUID(), nickname: name.trim().slice(0, 20), joinedAt: Date.now(), status: 'waiting', currentQuestionIndex: 0, answers: {} }
      if (firebaseReady) await joinSession(room, next)
      else { const demo = getDemo(room); if (!demo) throw new Error('Комната не найдена'); setDemo({ ...demo, participants: { ...demo.participants, [next.id]: next } }) }
      localStorage.setItem(`atmosphere-participant-${room}`, JSON.stringify(next)); setParticipant(next)
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Не удалось подключиться') }
  }
  const answer = async (value: ResponseValue) => {
    if (!participant || !session || saving) return
    if (session.phase !== 'live') return setNotice(session.phase === 'closed' ? 'Сессия завершена ведущим. Ответы больше не принимаются.' : 'Ответы пока не принимаются. Дождитесь запуска диагностики.')
    const question = activeQuestions[participant.currentQuestionIndex]
    if (!activeQuestions.length || !question) return setNotice('Не удалось определить текущий вопрос. Обновите страницу или обратитесь к ведущему.')
    const nextIndex = participant.currentQuestionIndex + 1
    setNotice(''); setSaving(true)
    try {
      const next = firebaseReady
        ? await saveAnswer(room, participant, question.id, value, nextIndex, activeQuestions.length)
        : { ...participant, answers: { ...participant.answers, [question.id]: value }, currentQuestionIndex: nextIndex, status: nextIndex >= activeQuestions.length ? 'finished' as const : 'answering' as const, ...(nextIndex >= activeQuestions.length ? { completedAt: Date.now() } : {}) }
      if (!firebaseReady) {
        const demo = { ...session, participants: { ...session.participants, [participant.id]: next } }
        setDemo(demo)
        setSession(demo)
      }
      // Only advance after Firebase confirms the write. This keeps the local
      // question index stable when a rules rejection rolls back the write.
      localStorage.setItem(`atmosphere-participant-${room}`, JSON.stringify(next))
      setParticipant(next)
    } catch (error) {
      console.error('participant answer rejected', { room, participantId: participant.id, questionId: question.id, error })
      setNotice(error instanceof Error ? `Ответ не сохранён: ${error.message}. Подключитесь к комнате заново.` : 'Ответ не сохранён. Пожалуйста, подключитесь к комнате заново.')
    } finally { setSaving(false) }
  }
  const openReport = async () => { if (!participant) return; try { if (firebaseReady) await markPersonalViewed(room, participant.id); else if (session) { const next = { ...participant, personalViewedAt: Date.now() }; const demo = { ...session, participants: { ...session.participants, [participant.id]: next } }; setDemo(demo); setSession(demo); setParticipant(next) } } finally { setShowReport(true) } }

  if (!room) return <Shell screen="intro-screen"><p className="flow-label">ОНЛАЙН-ДИАГНОСТИКА</p><h1>Нужен QR-код ведущего</h1><p>Отсканируйте код, чтобы открыть личную ссылку на диагностику.</p></Shell>
  if (firebaseReady && !authReady) return <Shell screen="waiting-screen"><p className="flow-label">ПОДКЛЮЧАЕМ</p><h1>Проверяем подключение</h1><p>Восстанавливаем безопасную сессию участника.</p></Shell>
  if (session?.phase === 'closed') return <Shell screen="waiting-screen"><div className="ready-spark">✓</div><p className="flow-label">СЕССИЯ ЗАВЕРШЕНА</p><h1>Эта диагностика уже завершена</h1><p>Ведущий закрыл комнату. Ответы больше не принимаются, а подключиться по этой ссылке нельзя.</p></Shell>
  if (!participant && screen === 'intro') return <Shell screen="intro-screen"><p className="flow-label gold">ОНЛАЙН-ДИАГНОСТИКА</p><h1>Атмосфера<br />нашей молодёжи</h1><p>Небольшая анонимная диагностика, которая помогает увидеть сильные стороны и точки роста.</p><div className="intro-info"><b>✦</b><strong>{activeQuestions.length} простых вопросов</strong><small>{Object.keys(categories).length} тем · в своём темпе · без оценок</small><i /><span>В конце ты получишь личную карточку с результатами.</span></div><Action onClick={() => setScreen('nickname')}>Начать диагностику</Action><small className="flow-footnote">Твоя искренность поможет нам стать ближе.</small></Shell>
  if (!participant) return <Shell screen="nickname-screen"><p className="flow-label">ШАГ 1 ИЗ 2</p><h1>Как тебя<br />называть?</h1><p>Можно указать имя или придумать никнейм — результаты всё равно останутся анонимными.</p><input value={name} onChange={event => setName(event.target.value)} placeholder="Например, «Свет»" maxLength={20} /><small className="input-help">Это нужно только для твоей личной карточки.</small><div className="flow-note"><b>Важно</b><p>Нет правильных или неправильных ответов. Главное — отвечать честно.</p></div><Action onClick={() => void join()}>Продолжить</Action>{notice && <p className="flow-error">{notice}</p>}</Shell>
  if (!session || session.phase === 'lobby') return <Shell screen="waiting-screen"><div className="waiting-orbit"><i /><i /><b>✦</b></div><p className="flow-label">ПОДКЛЮЧЕНИЕ ПОДТВЕРЖДЕНО</p><h1>Ждём ведущего</h1><p>Ты уже в комнате. Как только ведущий запустит диагностику, первый вопрос появится автоматически.</p><div className="waiting-status"><span /><div><b>Собираем участников</b><small>Не закрывай эту страницу</small></div></div></Shell>
  if (participant.status === 'finished' && !reportReady) return <Shell screen="report-loading"><div className="report-loader"><i /><b>✦</b></div><p className="flow-label">ГОТОВО</p><h1>Подготавливаем<br />твой отчёт</h1><p>Собираем твою личную карточку — это займёт всего пару секунд.</p></Shell>
  if (participant.status === 'finished' && !showReport) return <Shell screen="report-ready"><div className="ready-spark">✓</div><p className="flow-label">ТВОЙ ОТЧЁТ ГОТОВ</p><h1>{participant.nickname}, спасибо!</h1><p>Ты ответил(а) на все вопросы. Твоя личная карточка готова и доступна только тебе.</p><Action onClick={() => void openReport()}>Открыть личный отчёт <span>→</span></Action></Shell>
  if (participant.status === 'finished') return <PersonalReport participant={participant} scores={scoreAnswers(participant.answers || {}, activeQuestions)} onClose={() => setShowReport(false)} />
  const question = activeQuestions[participant.currentQuestionIndex]
  if (!question) return <Shell screen="waiting-screen"><p className="flow-label">ВОПРОС НЕДОСТУПЕН</p><h1>Не удалось открыть текущий вопрос</h1><p>Обновите страницу. Если проблема останется, обратитесь к ведущему.</p>{notice && <p className="flow-error">{notice}</p>}</Shell>
  const done = Math.round(participant.currentQuestionIndex / activeQuestions.length * 100)
  return <Shell screen="question-screen"><div className="question-top"><div><span>ВОПРОС {participant.currentQuestionIndex + 1} / {activeQuestions.length}</span><small>{categories[question.category]}</small></div><b>{done}%</b></div><div className="question-progress"><i style={{ width: `${done}%` }} /></div><h1 className="question">{question.title}</h1><p>Выбери вариант, который ближе всего к тебе.</p><div className="options answer-options">{(['A', 'B', 'C', 'D'] as Answer[]).map(letter => <button className="option" disabled={saving} key={letter} onClick={() => void answer(letter)}><b>{letter}</b><span>{question.options[letter]}</span></button>)}</div><div className="question-footer"><Action secondary disabled={saving} onClick={() => void answer('SKIP')}>Пропустить вопрос</Action><small>Но это может стоить вам <b>баллов.</b></small></div>{notice && <p className="flow-error">{notice}</p>}</Shell>
}
