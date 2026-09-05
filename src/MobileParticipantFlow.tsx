import { useEffect, useState } from 'react'
import { categories, questions } from './data/questions'
import { ensureAuth, firebaseReady, joinSession, markPersonalViewed, saveAnswer, subscribeParticipantQuestionSet, subscribeParticipantQuizResult, subscribeParticipantRecord, subscribePublicRoom, subscribeRoomLobby, waitForAuthPersistence } from './repositories/firebaseRepository'
import { type ModeManifest } from './modes/modeRegistry'
import { resolveLegacyParticipantRoomMode, resolveParticipantRoomMode } from './modes/participantRouting'
import { downloadWishPng, printWish } from './lib/export'
import { type Answer, type Participant, type ParticipantQuestionSet, type ParticipantQuizResult, type PublicRoom, type Question, type ResponseValue, type RoomLobby, type RoomMode, type Scores, type Session } from './types'
import { isSessionExpired } from './core/sessionLifecycle'

const demoKey = (room: string) => `atmosphere-demo-${room}`
const getDemo = (room: string) => JSON.parse(localStorage.getItem(demoKey(room)) || 'null') as Session | null
const setDemo = (session: Session) => { localStorage.setItem(demoKey(session.roomId), JSON.stringify(session)); window.dispatchEvent(new StorageEvent('storage', { key: demoKey(session.roomId) })) }

function useParticipantSession(room: string, participantId: string | undefined, mode: Exclude<RoomMode, 'wheel'>) {
  const [session, setSession] = useState<Session | null>(null)
  const [lobby, setLobby] = useState<RoomLobby | null>(null)
  const [publicRoom, setPublicRoom] = useState<PublicRoom | null>(null)
  const [questionSet, setQuestionSet] = useState<ParticipantQuestionSet | null>(null)
  const [participantRecord, setParticipantRecord] = useState<Participant | null>(null)
  const [quizResult, setQuizResult] = useState<ParticipantQuizResult | null>(null)
  const [connectionError, setConnectionError] = useState('')
  useEffect(() => {
    setSession(null); setLobby(null); setPublicRoom(null); setQuestionSet(null); setParticipantRecord(null); setQuizResult(null); setConnectionError('')
    if (!room) return
    if (!firebaseReady) {
      const applyDemo = () => {
        const demo = getDemo(room)
        const resolution = resolveParticipantRoomMode(demo)
        if (!demo || resolution.state !== 'ready' || resolution.mode !== mode) {
          setSession(null); setLobby(null); setConnectionError(demo ? 'Данные комнаты не соответствуют выбранному режиму.' : 'Комната не найдена или больше недоступна.')
          return
        }
        setSession(demo)
        setLobby({ roomId: demo.roomId, hostUid: demo.hostUid, workspaceId: demo.workspaceId || '', phase: demo.phase, maxParticipants: demo.maxParticipants, createdAt: demo.createdAt, mode: demo.mode, ...(demo.closedAt ? { closedAt: demo.closedAt } : {}) })
      }
      applyDemo(); const sync = (event: StorageEvent) => { if (event.key === demoKey(room)) applyDemo() }
      window.addEventListener('storage', sync); return () => window.removeEventListener('storage', sync)
    }
    let active = true; let stopLobby: () => void = () => undefined; let stopPublic: () => void = () => undefined; let stopQuestions: () => void = () => undefined; let stopParticipant: () => void = () => undefined; let stopQuizResult: () => void = () => undefined
    void ensureAuth().then(() => {
      if (!active) return
      stopPublic = subscribePublicRoom(room, value => {
        if (!active) return
        if (value) {
          const resolution = resolveParticipantRoomMode(value)
          if (resolution.state !== 'ready' || resolution.mode !== mode) {
            setPublicRoom(null); setLobby(null); setConnectionError('Данные комнаты не соответствуют выбранному режиму.')
            return
          }
          setPublicRoom(value); setConnectionError(''); stopLobby(); setLobby(null); return
        }
        // A legacy room has no safe projection until its host opens it once.
        // Only then is its old lobby read for a non-sensitive waiting state.
        stopLobby()
        stopLobby = subscribeRoomLobby(room, legacy => {
          if (!active) return
          const resolution = resolveLegacyParticipantRoomMode(legacy)
          if (resolution.state !== 'ready' || resolution.mode !== mode) {
            setLobby(null); setConnectionError('Данные комнаты не соответствуют выбранному режиму.')
            return
          }
          setLobby(legacy); setConnectionError('')
        }, () => { if (active) { setLobby(null); setConnectionError('Не удалось загрузить данные комнаты.') } })
      }, () => { if (active) { setPublicRoom(null); setConnectionError('Не удалось загрузить данные комнаты.') } })
      stopQuestions = subscribeParticipantQuestionSet(room, value => {
        if (!active) return
        const resolution = value ? resolveParticipantRoomMode(value) : null
        const hasDeclaredMode = Boolean(value?.mode || value?.gameTypeId)
        if (resolution && hasDeclaredMode && (resolution.state !== 'ready' || resolution.mode !== mode)) {
          setQuestionSet(null); setConnectionError('Материалы комнаты не соответствуют выбранному режиму.')
          return
        }
        setQuestionSet(value)
      }, () => { if (active) { setQuestionSet(null); setConnectionError('Не удалось загрузить материалы комнаты.') } })
      if (participantId) {
        stopParticipant = subscribeParticipantRecord(room, participantId, value => { if (active) setParticipantRecord(value) }, () => { if (active) { setParticipantRecord(null); setConnectionError('Не удалось восстановить данные участника.') } })
        stopQuizResult = subscribeParticipantQuizResult(room, participantId, value => { if (active) setQuizResult(value) }, () => { if (active) setQuizResult(null) })
      }
    })
    return () => { active = false; stopLobby(); stopPublic(); stopQuestions(); stopParticipant(); stopQuizResult() }
  }, [mode, participantId, room])
  useEffect(() => {
    const roomResolution = resolveParticipantRoomMode(publicRoom)
    const questionResolution = questionSet ? resolveParticipantRoomMode(questionSet) : null
    if (!publicRoom || !questionSet || !participantId || !participantRecord || roomResolution.state !== 'ready' || roomResolution.mode !== mode || (questionResolution?.state === 'ready' && questionResolution.mode !== mode)) { setSession(null); return }
    // The shell deliberately resembles a Session so existing participant UI
    // stays unchanged, but its data comes exclusively from public questions
    // and this participant's own record. It contains no answer keys.
    setSession({
      roomId: publicRoom.roomId,
      roomTitle: publicRoom.roomTitle,
      displayCode: publicRoom.displayCode,
      createdAt: publicRoom.createdAt,
      lastActivityAt: publicRoom.lastActivityAt,
      phase: publicRoom.phase,
      status: publicRoom.phase,
      maxParticipants: publicRoom.maxParticipants,
      hostUid: '',
      mode,
      productId: publicRoom.productId || questionSet.productId,
      gameTypeId: mode,
      packId: publicRoom.packId || questionSet.packId,
      scoringTemplateId: publicRoom.scoringTemplateId || questionSet.scoringTemplateId,
      packSnapshot: { title: publicRoom.packTitle || questionSet.packTitle || '', description: '', questions: questionSet.questions, settings: {} },
      questions: questionSet.questions,
      participants: { [participantId]: participantRecord },
    } as Session)
  }, [mode, participantId, publicRoom, questionSet, participantRecord])
  return [session, setSession, lobby || (publicRoom ? { roomId: publicRoom.roomId, hostUid: '', workspaceId: '', phase: publicRoom.phase, maxParticipants: publicRoom.maxParticipants, createdAt: publicRoom.createdAt, mode, packId: publicRoom.packId, packTitle: publicRoom.packTitle, difficulty: publicRoom.difficulty, closedAt: publicRoom.closedAt } : null), quizResult, connectionError] as const
}

const Shell = ({ children, screen = '' }: { children: React.ReactNode; screen?: string }) => <main className="mobile-wrap mobile-flow"><div className={`mobile-card phone-screen ${screen}`}>{children}</div></main>
const Action = ({ children, onClick, disabled = false, secondary = false }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; secondary?: boolean }) => <button className={secondary ? 'mobile-action secondary' : 'mobile-action'} disabled={disabled} onClick={onClick}>{children}</button>

type ParticipantRoomGate =
  | { roomId: string; state: 'loading' }
  | { roomId: string; state: 'ready'; mode: RoomMode; manifest: ModeManifest }
  | { roomId: string; state: 'error'; message: string }

const connectionScreen = () => <Shell screen="waiting-screen"><p className="flow-label">ПОДКЛЮЧАЕМ</p><h1>Подключаемся<br />к комнате…</h1><p>Проверяем ссылку и загружаем режим встречи.</p><span className="stage-spinner" /></Shell>
const roomErrorScreen = (message: string) => <Shell screen="waiting-screen"><p className="flow-label">КОМНАТА НЕДОСТУПНА</p><h1>Не удалось открыть комнату</h1><p>{message}</p></Shell>

/**
 * A room's manifest is selected only after public Firebase metadata has
 * arrived. Keeping the roomId alongside state prevents a previous room's
 * subscription from rendering while a new QR/link is opening.
 */
function useParticipantRoomGate(roomId: string): ParticipantRoomGate {
  const [gate, setGate] = useState<ParticipantRoomGate>(() => roomId ? { roomId, state: 'loading' } : { roomId, state: 'error', message: 'Нужна действующая ссылка на комнату ведущего.' })
  useEffect(() => {
    let active = true
    let stopPublic: () => void = () => undefined
    let stopLegacyLobby: () => void = () => undefined
    const setResolution = (resolution: ReturnType<typeof resolveParticipantRoomMode> | ReturnType<typeof resolveLegacyParticipantRoomMode>) => {
      if (!active) return
      if (resolution.state === 'ready') setGate({ roomId, state: 'ready', mode: resolution.mode, manifest: resolution.manifest })
      else setGate({ roomId, state: 'error', message: resolution.message })
    }

    if (!roomId) {
      setGate({ roomId, state: 'error', message: 'Нужна действующая ссылка на комнату ведущего.' })
      return () => { active = false }
    }
    setGate({ roomId, state: 'loading' })

    if (!firebaseReady) {
      const applyDemo = () => setResolution(resolveParticipantRoomMode(getDemo(roomId)))
      applyDemo()
      const sync = (event: StorageEvent) => { if (event.key === demoKey(roomId)) applyDemo() }
      window.addEventListener('storage', sync)
      return () => { active = false; window.removeEventListener('storage', sync) }
    }

    void ensureAuth().then(() => {
      if (!active) return
      stopPublic = subscribePublicRoom(roomId, publicRoom => {
        if (!active) return
        if (publicRoom) {
          stopLegacyLobby()
          setResolution(resolveParticipantRoomMode(publicRoom))
          return
        }
        stopLegacyLobby()
        stopLegacyLobby = subscribeRoomLobby(roomId, legacyLobby => setResolution(resolveLegacyParticipantRoomMode(legacyLobby)), () => {
          if (active) setGate({ roomId, state: 'error', message: 'Не удалось загрузить данные комнаты. Проверьте соединение и обновите страницу.' })
        })
      }, () => {
        if (active) setGate({ roomId, state: 'error', message: 'Не удалось загрузить данные комнаты. Проверьте соединение и обновите страницу.' })
      })
    }).catch(() => {
      if (active) setGate({ roomId, state: 'error', message: 'Не удалось подключиться к комнате. Проверьте соединение и обновите страницу.' })
    })
    return () => { active = false; stopPublic(); stopLegacyLobby() }
  }, [roomId])
  return gate
}

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
  ctx.fillStyle = '#03120e'; ctx.fillRect(0, 0, 1080, 1350); ctx.fillStyle = '#32ce8b'; ctx.font = '700 32px Arial'; ctx.fillText('ПРОВЕРЬ СЕБЯ', 90, 100); ctx.fillStyle = '#eef5ee'; ctx.font = '700 72px Arial'; ctx.fillText(participant.nickname, 90, 205); ctx.fillStyle = '#32ce8b'; ctx.font = '700 144px Arial'; ctx.fillText(`${scores.total}%`, 90, 380)
  let y = 560; Object.entries(scores.categories).forEach(([id, value]) => { ctx.fillStyle = '#eef5ee'; ctx.font = '600 28px Arial'; ctx.fillText(categories[id as keyof typeof categories], 90, y); ctx.fillStyle = '#0d4c3a'; ctx.fillRect(90, y + 28, 900, 14); ctx.fillStyle = '#32ce8b'; ctx.fillRect(90, y + 28, 900 * value / 100, 14); y += 132 })
  const link = document.createElement('a'); link.href = canvas.toDataURL('image/png'); link.download = `карточка-${participant.nickname}.png`; link.click()
}

function QuestionParticipantFlow({ room, mode, modeManifest }: { room: string; mode: Exclude<RoomMode, 'wheel'>; modeManifest: ModeManifest }) {
  const [participant, setParticipant] = useState<Participant | null>(null)
  const [session, setSession, lobby, quizResult, connectionError] = useParticipantSession(room, participant?.id, mode)
  const [screen, setScreen] = useState<'intro' | 'nickname'>('intro')
  const [name, setName] = useState('')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const [reportReady, setReportReady] = useState(false)
  const [showReport, setShowReport] = useState(false)
  const [authReady, setAuthReady] = useState(!firebaseReady)
  const [authUid, setAuthUid] = useState('')
  let activeQuestions: Question[] = []
  let moduleError = ''
  try {
    activeQuestions = modeManifest.runtime.getQuestions(session, questions)
  } catch (error) {
    moduleError = error instanceof Error ? error.message : 'Не удалось открыть материалы комнаты.'
  }
  const isQuiz = mode === 'quiz'
  const introQuestionCount = isQuiz ? (session ? activeQuestions.length : 15) : activeQuestions.length

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
      if (lobby?.phase === 'closed' || session?.phase === 'closed' || isSessionExpired(session || lobby)) throw new Error('Сессия завершена или срок её активности истёк. Подключение больше недоступно.')
      const user = firebaseReady ? await ensureAuth() : null
      const next: Participant = { id: user?.uid || crypto.randomUUID(), nickname: name.trim().slice(0, 20), joinedAt: Date.now(), status: 'waiting', currentQuestionIndex: 0, answers: {} }
      if (firebaseReady) await joinSession(room, next)
      else { const demo = getDemo(room); if (!demo) throw new Error('Комната не найдена'); setDemo({ ...demo, participants: { ...demo.participants, [next.id]: next } }) }
      localStorage.setItem(`atmosphere-participant-${room}`, JSON.stringify(next)); setParticipant(next)
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Не удалось подключиться') }
  }
  const answer = async (value: ResponseValue) => {
    if (!participant || !session || saving) return
    if (isQuiz && value === 'SKIP') return setNotice('В этой викторине пропуск вопроса недоступен.')
    if (session.phase !== 'live') return setNotice(session.phase === 'closed' ? 'Сессия завершена ведущим. Ответы больше не принимаются.' : `Ответы пока не принимаются. Дождитесь запуска ${modeManifest.title.toLocaleLowerCase('ru-RU')}.`)
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

  if (firebaseReady && !authReady) return connectionScreen()
  if (connectionError) return roomErrorScreen(connectionError)
  if (moduleError) return roomErrorScreen(moduleError)
  if (lobby?.phase === 'closed' || session?.phase === 'closed' || isSessionExpired(session || lobby)) return <Shell screen="waiting-screen"><div className="ready-spark">✓</div><p className="flow-label">СЕССИЯ ЗАВЕРШЕНА</p><h1>{isQuiz ? 'Эта викторина уже завершена' : '«Проверь себя» уже завершён'}</h1><p>{isSessionExpired(session || lobby) ? 'Время активности этой комнаты истекло. Ответы больше не принимаются.' : 'Ведущий закрыл комнату. Ответы больше не принимаются, а подключиться по этой ссылке нельзя.'}</p></Shell>
  if (!participant && screen === 'intro') return <Shell screen="intro-screen"><p className="flow-label gold">{isQuiz ? 'БИБЛЕЙСКАЯ ВИКТОРИНА' : 'ПРОВЕРЬ СЕБЯ'}</p><h1>{isQuiz ? (lobby?.packTitle || session?.packSnapshot?.title || 'Библейская\nвикторина') : <>Проверь<br />себя</>}</h1><p>{isQuiz ? 'Проверь свои знания Библии. Выбери один правильный ответ в каждом вопросе.' : 'Небольшой бережный формат, который помогает увидеть сильные стороны и точки роста.'}</p><div className="intro-info"><b>✦</b><strong>{introQuestionCount} {isQuiz ? 'вопросов викторины' : 'простых вопросов'}</strong><small>{isQuiz ? '1 балл за верный ответ · без таймера' : `${Object.keys(categories).length} тем · в своём темпе · без оценок`}</small><i /><span>{isQuiz ? 'Общий результат появится, когда все участники завершат игру.' : 'В конце ты получишь личную карточку с результатами.'}</span></div><Action onClick={() => setScreen('nickname')}>{isQuiz ? 'Начать викторину' : 'Начать «Проверь себя»'}</Action><small className="flow-footnote">{isQuiz ? 'Отвечай внимательно — правильный ответ только один.' : 'Твоя искренность поможет нам стать ближе.'}</small></Shell>
  if (!participant) return <Shell screen="nickname-screen"><p className="flow-label">ШАГ 1 ИЗ 2</p><h1>Как тебя<br />называть?</h1><p>{isQuiz ? 'Укажи имя или никнейм — он появится в общем рейтинге после завершения игры.' : 'Можно указать имя или придумать никнейм — результаты всё равно останутся анонимными.'}</p><input value={name} onChange={event => setName(event.target.value)} placeholder="Например, «Свет»" maxLength={20} /><small className="input-help">{isQuiz ? 'Это имя увидят только в общем результате викторины.' : 'Это нужно только для твоей личной карточки.'}</small>{!isQuiz && <div className="flow-note"><b>Важно</b><p>Нет правильных или неправильных ответов. Главное — отвечать честно.</p></div>}<Action onClick={() => void join()}>Продолжить</Action>{notice && <p className="flow-error">{notice}</p>}</Shell>
  if (!session || session.phase === 'lobby') return <Shell screen="waiting-screen"><div className="waiting-orbit"><i /><i /><b>✦</b></div><p className="flow-label">ПОДКЛЮЧЕНИЕ ПОДТВЕРЖДЕНО</p><h1>Ждём ведущего</h1><p>Ты уже в комнате. Как только ведущий запустит {isQuiz ? 'викторину' : '«Проверь себя»'}, первый вопрос появится автоматически.</p><div className="waiting-status"><span /><div><b>Собираем участников</b><small>Не закрывай эту страницу</small></div></div></Shell>
  if (!activeQuestions.length) return <Shell screen="waiting-screen"><p className="flow-label">НАБОР БЕЗ ВОПРОСОВ</p><h1>{isQuiz ? 'Викторина пока недоступна' : '«Проверь себя» пока недоступен'}</h1><p>Ведущий выбрал набор без вопросов. Попросите его выбрать другой материал и создать новую комнату.</p></Shell>
  if (participant.status === 'finished' && isQuiz) {
    const canShowPersonalScore = session.phase === 'resultsIntro' || session.phase === 'resultsReal'
    return <Shell screen="report-ready"><div className="ready-spark">✓</div><p className="flow-label">ВИКТОРИНА ЗАВЕРШЕНА</p><h1>{participant.nickname}, спасибо!</h1><p>{canShowPersonalScore && quizResult ? `Твой результат: ${quizResult.correct} из ${quizResult.total} · ${quizResult.percentage}%` : 'Ты ответил(а) на все вопросы. Ждём, пока остальные участники завершат игру, чтобы ведущий открыл общий результат.'}</p>{canShowPersonalScore && <p className="flow-footnote">Общий рейтинг показан на экране ведущего.</p>}</Shell>
  }
  if (participant.status === 'finished' && !reportReady) return <Shell screen="report-loading"><div className="report-loader"><i /><b>✦</b></div><p className="flow-label">ГОТОВО</p><h1>Подготавливаем<br />твой отчёт</h1><p>Собираем твою личную карточку — это займёт всего пару секунд.</p></Shell>
  if (participant.status === 'finished' && !showReport) return <Shell screen="report-ready"><div className="ready-spark">✓</div><p className="flow-label">ТВОЙ ОТЧЁТ ГОТОВ</p><h1>{participant.nickname}, спасибо!</h1><p>Ты ответил(а) на все вопросы. Твоя личная карточка готова и доступна только тебе.</p><Action onClick={() => void openReport()}>Открыть личный отчёт <span>→</span></Action></Shell>
  if (participant.status === 'finished') return <PersonalReport participant={participant} scores={modeManifest.runtime.score(participant.answers || {}, activeQuestions, session)} onClose={() => setShowReport(false)} />
  const question = activeQuestions[participant.currentQuestionIndex]
  if (!question) return <Shell screen="waiting-screen"><p className="flow-label">ВОПРОС НЕДОСТУПЕН</p><h1>Не удалось открыть текущий вопрос</h1><p>Обновите страницу. Если проблема останется, обратитесь к ведущему.</p>{notice && <p className="flow-error">{notice}</p>}</Shell>
  const ModeParticipantScreen = modeManifest.participantScreen
  return <Shell screen="question-screen"><ModeParticipantScreen question={question} currentIndex={participant.currentQuestionIndex} total={activeQuestions.length} packTitle={session.packSnapshot?.title} saving={saving} notice={notice} onAnswer={value => void answer(value)} /></Shell>
}

export function MobileParticipantFlow({ room }: { room: string }) {
  const gate = useParticipantRoomGate(room)
  if (gate.roomId !== room || gate.state === 'loading') return connectionScreen()
  if (gate.state === 'error') return roomErrorScreen(gate.message)

  const ModeParticipantFlow = gate.manifest.participantFlow
  const content = ModeParticipantFlow
    ? <ModeParticipantFlow key={`${room}:${gate.mode}`} room={room} />
    : gate.mode === 'wheel'
      ? roomErrorScreen('Не удалось открыть режим комнаты.')
      : <QuestionParticipantFlow key={`${room}:${gate.mode}`} room={room} mode={gate.mode} modeManifest={gate.manifest} />
  return <div data-participant-mode={gate.mode}>{content}</div>
}
