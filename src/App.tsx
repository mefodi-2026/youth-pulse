import { useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'
import { categories, questions } from './data/questions'
import { archiveSession, createSession, ensureAuth, firebaseReady, joinSession, markPersonalViewed, saveAnswer, saveQuestionBank, saveSessionQuestions, subscribeQuestionBank, subscribeSession, subscribeSessionArchives, updatePhase } from './lib/firebase'
import { recommendation, scoreAnswers } from './lib/scoring'
import { StageDashboard } from './StageDashboard'
import { MobileParticipantFlow } from './MobileParticipantFlow'
import type { Answer, Participant, Question, Scores, Session, SessionArchive, SessionPhase } from './types'

const demoKey = (room: string) => `atmosphere-demo-${room}`
const getDemo = (room: string) => JSON.parse(localStorage.getItem(demoKey(room)) || 'null') as Session | null
const setDemo = (session: Session) => { localStorage.setItem(demoKey(session.roomId), JSON.stringify(session)); window.dispatchEvent(new StorageEvent('storage', { key: demoKey(session.roomId) })) }
const makeRoom = () => Math.random().toString(36).slice(2, 8).toUpperCase()
const appBasePath = import.meta.env.BASE_URL.replace(/\/$/, '')
const currentPath = () => window.location.pathname.replace(/\/+$/, '') || '/'
const queryRoom = () => new URLSearchParams(window.location.search).get('room')?.toUpperCase() || ''
const go = (path: string) => { window.history.pushState({}, '', `${appBasePath}${path}`); window.dispatchEvent(new PopStateEvent('popstate')) }

const Glass = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => <section className={`glass ${className}`}>{children}</section>
const Button = ({ children, secondary = false, disabled, onClick, className = '' }: { children: React.ReactNode; secondary?: boolean; disabled?: boolean; onClick?: () => void; className?: string }) => <button className={`${secondary ? 'button secondary' : 'button'} ${className}`} disabled={disabled} onClick={onClick}>{children}</button>
const phaseText = (phase: SessionPhase) => ({ lobby: 'Сбор участников', live: 'Диагностика идёт', personal: 'Личные результаты', resultsIntro: 'Готовим общий результат', resultsReal: 'Общий результат открыт', closed: 'Сессия завершена' })[phase]

function useRoute() {
  const [path, setPath] = useState(currentPath())
  useEffect(() => { const listener = () => setPath(currentPath()); window.addEventListener('popstate', listener); return () => window.removeEventListener('popstate', listener) }, [])
  return path
}

function useRoom(room: string) {
  const [session, setSession] = useState<Session | null>(() => room ? getDemo(room) : null)
  const [connection, setConnection] = useState<'idle' | 'connecting' | 'ready' | 'error'>(room ? 'connecting' : 'idle')
  useEffect(() => {
    if (!room) return
    if (firebaseReady) {
      let active = true
      let unsubscribe: () => void = () => undefined
      setConnection('connecting')
      void ensureAuth().then(() => {
        if (!active) return
        unsubscribe = subscribeSession(room, value => { if (active) { setSession(value); setConnection('ready') } }, () => { if (active) setConnection('error') })
      }).catch(() => { if (active) setConnection('error') })
      return () => { active = false; unsubscribe() }
    }
    const sync = (event: StorageEvent) => { if (event.key === demoKey(room)) setSession(getDemo(room)) }
    window.addEventListener('storage', sync); setSession(getDemo(room)); setConnection('ready')
    return () => window.removeEventListener('storage', sync)
  }, [room])
  return [session, setSession, connection] as const
}

function App() {
  const path = useRoute()
  if (path.endsWith('/host')) return <Host />
  if (path.endsWith('/join')) return <MobileParticipantFlow room={queryRoom()} />
  if (path.endsWith('/stage')) return <StageDashboard room={queryRoom()} />
  if (path.endsWith('/results')) return <Results room={queryRoom()} />
  return <Landing />
}

function Landing() {
  return <main className="landing"><div className="orb orb-a" /><div className="orb orb-b" /><Glass className="landing-card"><p className="eyebrow">ИНТЕРАКТИВНАЯ ДИАГНОСТИКА</p><h1>Атмосфера<br />нашей молодёжи</h1><p>Бережная встреча, которая помогает увидеть точки роста — без сравнений и осуждения.</p><div className="landing-actions"><Button onClick={() => go('/host')}>Открыть панель ведущего</Button><Button secondary onClick={() => go('/join?room=DEMO42')}>Открыть демо участника</Button></div><small>16 вопросов · 4 темы · около 4 минут</small></Glass></main>
}

type HostTab = 'overview' | 'rooms' | 'questions' | 'export' | 'settings'
function Host() {
  const [room, setRoom] = useState(() => localStorage.getItem('atmosphere-host-room') || '')
  const [session, setSession] = useRoom(room)
  const [qr, setQr] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [tab, setTab] = useState<HostTab>('overview')
  const [archives, setArchives] = useState<Record<string, SessionArchive>>({})
  const [questionBank, setQuestionBank] = useState<Question[]>(questions)
  const [questionDraft, setQuestionDraft] = useState({ category: 'communication' as Question['category'], title: '', options: ['', '', '', ''] })
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null)
  const [questionSaving, setQuestionSaving] = useState(false)
  const [questionError, setQuestionError] = useState('')
  const [publicOrigin, setPublicOrigin] = useState(() => localStorage.getItem('atmosphere-public-origin') || import.meta.env.VITE_PUBLIC_ORIGIN || window.location.origin)
  const basePath = window.location.pathname.replace(/\/host$/, '')
  const publicUrl = (path: string) => `${publicOrigin.replace(/\/$/, '')}${basePath}${path}`
  const hostUrl = (path: string) => `${basePath}${path}`
  const joinUrl = room ? publicUrl(`/join?room=${room}`) : ''
  const participants = Object.values(session?.participants || {})
  const finished = participants.filter(p => p.status === 'finished').length
  const answering = participants.filter(p => p.status === 'answering').length
  const allFinished = participants.length > 0 && finished === participants.length
  const menu: Array<[HostTab, string, string]> = [['overview', 'Обзор', '⌁'], ['rooms', 'Комнаты', '◫'], ['questions', 'Вопросы', '◌'], ['export', 'Экспорт', '↓'], ['settings', 'Настройки', '⚙']]

  useEffect(() => { if (joinUrl) QRCode.toDataURL(joinUrl, { margin: 0, width: 216, color: { dark: '#03120e', light: '#eef5ee' } }).then(setQr) }, [joinUrl])
  useEffect(() => { localStorage.setItem('atmosphere-public-origin', publicOrigin) }, [publicOrigin])
  useEffect(() => {
    if (!firebaseReady) {
      const localArchives = JSON.parse(localStorage.getItem('atmosphere-archives') || '{}') as Record<string, SessionArchive>
      setArchives(localArchives)
      return
    }
    let unsubscribe: () => void = () => undefined
    void ensureAuth().then(() => { unsubscribe = subscribeSessionArchives(setArchives) }).catch(() => undefined)
    return () => unsubscribe()
  }, [])
  useEffect(() => {
    if (!firebaseReady) {
      const localQuestions = JSON.parse(localStorage.getItem('atmosphere-question-bank') || 'null') as Question[] | null
      if (localQuestions?.length) setQuestionBank(localQuestions)
      return
    }
    const localQuestions = JSON.parse(localStorage.getItem('atmosphere-question-bank') || 'null') as Question[] | null
    let unsubscribe: () => void = () => undefined
    void ensureAuth().then(() => { unsubscribe = subscribeQuestionBank(value => { if (localQuestions?.length) setQuestionBank(localQuestions); else if (value?.length) setQuestionBank(value) }) }).catch(() => undefined)
    return () => unsubscribe()
  }, [])
  const create = async () => {
    setBusy(true)
    const newRoom = makeRoom()
    try {
      if (firebaseReady) { const user = await ensureAuth(); if (!user) throw new Error('Не удалось войти в Firebase'); await createSession(newRoom, user.uid, questionBank) }
      else setDemo({ roomId: newRoom, createdAt: Date.now(), phase: 'lobby', maxParticipants: 30, hostUid: 'demo-host', questions: questionBank, participants: {} })
      localStorage.setItem('atmosphere-host-room', newRoom); setRoom(newRoom); setTab('overview')
    } finally { setBusy(false) }
  }
  const changePhase = async (next: SessionPhase) => {
    if (!session) return
    setActionError('')
    try {
      if (firebaseReady) {
        if (next === 'closed') {
          const archived = await archiveSession(session)
          setSession(archived)
          setArchives(prev => ({ ...prev, [room]: archived }))
        } else await updatePhase(room, next)
      } else {
        const nextSession = { ...session, phase: next, ...(next === 'resultsIntro' ? { resultsIntroStartedAt: Date.now() } : {}), ...(next === 'closed' ? { closedAt: Date.now() } : {}) }
        setDemo(nextSession); setSession(nextSession)
        if (next === 'closed') {
          const archived = { ...nextSession, archivedAt: Date.now() } as SessionArchive
          const localArchives = JSON.parse(localStorage.getItem('atmosphere-archives') || '{}') as Record<string, SessionArchive>
          localStorage.setItem('atmosphere-archives', JSON.stringify({ ...localArchives, [room]: archived }))
          setArchives(prev => ({ ...prev, [room]: archived }))
        }
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Не удалось изменить состояние сессии')
    }
  }
  const start = () => {
    window.open(hostUrl(`/stage?room=${room}`), 'atmosphere-stage')
    void changePhase('live')
  }
  const showResults = () => {
    window.open(hostUrl(`/results?room=${room}`), 'atmosphere-results')
    void changePhase('resultsIntro')
    window.setTimeout(() => { void changePhase('resultsReal') }, 20000)
  }
  const resetQuestionDraft = (category: Question['category'] = 'communication') => {
    setEditingQuestionId(null)
    setQuestionDraft({ category, title: '', options: ['', '', '', ''] })
  }
  const editQuestion = (question: Question) => {
    setEditingQuestionId(question.id)
    setQuestionDraft({ category: question.category, title: question.title, options: [question.options.A, question.options.B, question.options.C, question.options.D] })
    setTab('questions')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const persistQuestionBank = async (nextBank: Question[]) => {
    setQuestionError('')
    if (firebaseReady) {
      try {
        await saveQuestionBank(nextBank)
        localStorage.removeItem('atmosphere-question-bank')
      } catch (error) {
        localStorage.setItem('atmosphere-question-bank', JSON.stringify(nextBank))
        if (session) await saveSessionQuestions(room, nextBank).catch(() => undefined)
        setQuestionError(`Сохранено в текущую комнату. Общий банк Firebase пока недоступен: ${error instanceof Error ? error.message : 'проверьте Rules'}`)
      }
    } else localStorage.setItem('atmosphere-question-bank', JSON.stringify(nextBank))
    setQuestionBank(nextBank)
  }
  const saveQuestion = async () => {
    if (!questionDraft.title.trim() || questionDraft.options.some(option => !option.trim())) return
    setQuestionSaving(true)
    const nextQuestion: Question = { id: editingQuestionId || `${questionDraft.category}-${Date.now()}`, category: questionDraft.category, title: questionDraft.title.trim(), options: { A: questionDraft.options[0].trim(), B: questionDraft.options[1].trim(), C: questionDraft.options[2].trim(), D: questionDraft.options[3].trim() } }
    const nextBank = editingQuestionId ? questionBank.map(question => question.id === editingQuestionId ? nextQuestion : question) : [...questionBank, nextQuestion]
    try {
      await persistQuestionBank(nextBank)
      resetQuestionDraft()
    } catch (error) {
      setQuestionError(error instanceof Error ? error.message : 'Не удалось сохранить вопрос')
    } finally { setQuestionSaving(false) }
  }
  const deleteQuestion = async (question: Question) => {
    if (!window.confirm(`Удалить вопрос «${question.title}»?`)) return
    setQuestionSaving(true)
    try {
      await persistQuestionBank(questionBank.filter(item => item.id !== question.id))
      if (editingQuestionId === question.id) resetQuestionDraft()
    } catch (error) {
      setQuestionError(error instanceof Error ? error.message : 'Не удалось удалить вопрос')
    } finally { setQuestionSaving(false) }
  }
  const warning = !firebaseReady ? 'Для работы с несколькими устройствами подключите Firebase: демо-режим синхронизируется только в этом браузере.' : /localhost|127\.0\.0\.1/.test(publicOrigin) ? 'Этот QR ведёт на адрес компьютера. После публикации сайта здесь будет общий интернет-адрес.' : ''
  if (!session) return <main className="host-page"><header className="topbar"><div><p className="eyebrow">ВЕДУЩИЙ · ЖИВАЯ СЕССИЯ</p><h2>Диагностика атмосферы молодёжи</h2></div><span className={`status ${firebaseReady ? '' : 'demo'}`}>{firebaseReady ? 'ЭФИР АКТИВЕН' : 'ДЕМО-РЕЖИМ'}</span></header><Glass className="start-panel"><h1>Готовы начать?</h1><p>Создайте комнату, покажите QR-код участникам и начните, когда все подключатся.</p><Button disabled={busy} onClick={create}>{busy ? 'Создаём…' : 'Создать сессию'}</Button></Glass></main>
  return <main className="host-shell"><aside className="host-menu"><div className="brand"><span>✦</span><b>Атмосфера</b><small>панель ведущего</small></div><nav>{menu.map(([id, label, icon]) => <button key={id} className={tab === id ? 'selected' : ''} onClick={() => setTab(id)}><span>{icon}</span>{label}</button>)}</nav><div className="menu-room"><small>АКТИВНАЯ КОМНАТА</small><b>{room}</b><span>{participants.length} из {session.maxParticipants} участников</span></div></aside><section className="host-content"><header className="host-header"><div><p className="eyebrow">СЕССИЯ · {room}</p><h1>{tab === 'overview' ? 'Управление сессией' : menu.find(item => item[0] === tab)?.[1]}</h1></div><span className={`status ${firebaseReady ? '' : 'demo'}`}>{firebaseReady ? 'ЭФИР АКТИВЕН' : 'ДЕМО-РЕЖИМ'}</span></header>
    {tab === 'overview' && <><div className="metrics"><Metric label="Подключились" value={participants.length} note={`из ${session.maxParticipants} участников`} /><Metric label="Сейчас отвечают" value={answering} note="в своём темпе" /><Metric label="Завершили" value={finished} note={allFinished ? 'все готовы' : 'ждём завершения'} /></div><div className="overview-grid"><Glass className="control-panel"><p className="eyebrow">ТЕКУЩАЯ ФАЗА</p><h2>{phaseText(session.phase)}</h2><p>{session.phase === 'lobby' ? 'Покажите QR-код. После запуска у вас автоматически откроется отдельный экран с живым прогрессом.' : allFinished ? 'Все участники завершили ответы. Можно открыть общую визуализацию на большом экране.' : 'Экран прогресса обновляется в реальном времени — без личных ответов и имён.'}</p><div className="control-actions">{session.phase === 'lobby' && <Button disabled={!participants.length} onClick={start}>Запустить диагностику</Button>}{session.phase !== 'lobby' && <Button secondary onClick={() => window.open(hostUrl(`/stage?room=${room}`), 'atmosphere-stage')}>Открыть экран прогресса</Button>}<Button onClick={showResults} disabled={!allFinished || session.phase === 'resultsIntro' || session.phase === 'resultsReal'}>Показать общие результаты</Button></div><div className="results-lock"><span className={allFinished ? 'ready' : ''}>{allFinished ? '✓' : '⌕'}</span><div><b>{allFinished ? 'Общий результат готов' : 'Общий результат пока закрыт'}</b><small>{allFinished ? 'Нажмите кнопку выше, чтобы начать показ.' : `Завершили ${finished} из ${participants.length || '—'} участников.`}</small></div></div><div className="phase-track">{(['lobby', 'live', 'resultsIntro', 'resultsReal'] as SessionPhase[]).map(item => <span className={session.phase === item ? 'active' : ''} key={item}>{phaseText(item)}</span>)}</div></Glass><Glass className="qr-panel"><p className="eyebrow">ПОДКЛЮЧЕНИЕ УЧАСТНИКОВ</p>{qr && <img src={qr} alt="QR-код для подключения" className="qr" />}<code>{joinUrl}</code><Button secondary onClick={() => navigator.clipboard.writeText(joinUrl)}>Скопировать ссылку</Button>{warning && <p className="connection-warning">{warning}</p>}</Glass></div></>}
    {tab === 'rooms' && <div className="stack"><Glass className="room-row"><div><p className="eyebrow">ТЕКУЩАЯ</p><h2>{room}</h2><p>{phaseText(session.phase)} · {participants.length} подключились · {finished} завершили</p></div><Button onClick={() => void create()}>Создать новую комнату</Button></Glass><div className="archive-list">{Object.values(archives).sort((a, b) => b.archivedAt - a.archivedAt).map(archived => <Glass className="archive-card" key={archived.roomId}><div><p className="eyebrow">АРХИВ · {new Date(archived.archivedAt).toLocaleDateString('ru-RU')}</p><h3>{archived.roomId}</h3><p>{Object.keys(archived.participants).length} участников · {Object.values(archived.participants).filter(person => person.status === 'finished').length} завершили</p></div><Button secondary onClick={() => exportCsv(archived)}>Скачать CSV</Button></Glass>)}</div>{!Object.keys(archives).length && <Glass className="empty-state"><h3>История комнат пока пуста</h3><p>После завершения комнаты она появится здесь вместе с ответами участников.</p></Glass>}</div>}
    {tab === 'questions' && <div className="question-admin"><Glass className="question-editor"><p className="eyebrow">{editingQuestionId ? 'РЕДАКТИРОВАНИЕ' : 'НОВЫЙ ВОПРОС'}</p><h3>{editingQuestionId ? 'Изменить вопрос' : 'Добавить вопрос в банк'}</h3><select value={questionDraft.category} onChange={event => setQuestionDraft(prev => ({ ...prev, category: event.target.value as Question['category'] }))}>{Object.entries(categories).map(([id, title]) => <option value={id} key={id}>{title}</option>)}</select><input value={questionDraft.title} onChange={event => setQuestionDraft(prev => ({ ...prev, title: event.target.value }))} placeholder="Текст вопроса" />{questionDraft.options.map((option, index) => <input key={index} value={option} onChange={event => setQuestionDraft(prev => ({ ...prev, options: prev.options.map((item, itemIndex) => itemIndex === index ? event.target.value : item) }))} placeholder={`В…5 tokens truncated…ng.fromCharCode(65 + index)}`} />)}<div className="question-editor-actions"><Button disabled={questionSaving} onClick={() => void saveQuestion()}>{questionSaving ? 'Сохраняем…' : editingQuestionId ? 'Сохранить изменения' : 'Добавить вопрос'}</Button>{editingQuestionId && <Button secondary onClick={() => resetQuestionDraft()}>Отмена</Button>}</div>{questionError && <p className="connection-warning">{questionError}</p>}</Glass><div className="question-admin-list">{Object.entries(categories).map(([id, title]) => { const categoryId = id as Question['category']; const categoryQuestions = questionBank.filter(question => question.category === categoryId); return <Glass key={id} className="question-group"><div className="question-group-header"><div><p className="eyebrow">{categoryQuestions.length} ВОПРОСОВ</p><h3>{title}</h3></div><Button secondary onClick={() => resetQuestionDraft(categoryId)}>Добавить</Button></div>{categoryQuestions.map((question, index) => <div className="question-row" key={question.id}><span>{index + 1}</span><div className="question-row-content"><b>{question.title}</b><small>{question.options.A} · {question.options.B} · {question.options.C} · {question.options.D}</small></div><div className="question-row-actions"><button type="button" onClick={() => editQuestion(question)}>Редактировать</button><button type="button" onClick={() => void deleteQuestion(question)}>Удалить</button></div></div>)}</Glass> })}</div></div>}
    {tab === 'export' && <div className="stack"><Glass className="export-panel"><p className="eyebrow">ВЫГРУЗКА ДАННЫХ</p><h2>Результаты сессии {room}</h2><p>Файл открывается в Excel: никнейм, статус, полный текст каждого вопроса и выбранный текст ответа. Буквы A/B/C/D в выгрузку не попадут.</p><Button onClick={() => exportCsv(session)}>Скачать CSV</Button></Glass></div>}
    {tab === 'settings' && <div className="stack"><Glass className="settings-panel"><p className="eyebrow">ПОДКЛЮЧЕНИЕ ПО QR</p><h2>Адрес для участников</h2><p>После публикации укажите здесь адрес сайта — он попадёт в QR-код. До публикации можно использовать адрес компьютера в одной Wi‑Fi сети.</p><input value={publicOrigin} onChange={event => setPublicOrigin(event.target.value)} placeholder="https://ваш-сайт.web.app" /><small>Firebase: {firebaseReady ? 'подключён' : 'не настроен'}</small></Glass><Glass className="settings-panel"><p className="eyebrow">СЕССИЯ</p><h2>Завершение</h2><p>После завершения к этой комнате больше нельзя будет присоединиться.</p><Button secondary onClick={() => void changePhase('closed')}>Завершить сессию</Button>{actionError && <p className="connection-warning">{actionError}</p>}</Glass></div>}
  </section></main>
}

function exportCsv(session: Session) {
  const questionSet = session.questions?.length ? session.questions : questions
  const rows = Object.values(session.participants).map(participant => {
    const scores = scoreAnswers(participant.answers, questionSet)
    return [participant.id, participant.nickname, participant.status, ...questionSet.flatMap(question => [question.title, participant.answers[question.id] ? question.options[participant.answers[question.id]] : '']), scores.total, ...Object.values(scores.categories)]
  })
  const headers = ['participantId', 'nickname', 'status', ...questions.flatMap((_, index) => [`Вопрос ${index + 1}`, `Ответ ${index + 1}`]), 'total', ...Object.values(categories)]
  const csv = [headers, ...rows].map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(';')).join('\n')
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `diagnostika-${session.roomId}.csv`; anchor.click(); URL.revokeObjectURL(url)
}

function Metric({ label, value, note }: { label: string; value: number; note: string }) { return <Glass className="metric"><p>{label}</p><strong>{value}</strong><small>{note}</small></Glass> }

function Join({ room }: { room: string }) {
  const [session, setSession] = useRoom(room)
  const [name, setName] = useState('')
  const [participant, setParticipant] = useState<Participant | null>(null)
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const [showPersonal, setShowPersonal] = useState(false)
  useEffect(() => { const stored = localStorage.getItem(`atmosphere-participant-${room}`); if (stored) setParticipant(JSON.parse(stored)) }, [room])
  useEffect(() => { if (participant && session?.participants[participant.id]) setParticipant(session.participants[participant.id]) }, [session, participant?.id])
  const join = async () => {
    if (!room || name.trim().length < 2) return setNotice('Введите никнейм от 2 до 20 символов.')
    const user = firebaseReady ? await ensureAuth() : null
    const p: Participant = { id: user?.uid || crypto.randomUUID(), nickname: name.trim().slice(0, 20), joinedAt: Date.now(), status: 'waiting', currentQuestionIndex: 0, answers: {} }
    try {
      if (firebaseReady) await joinSession(room, p)
      else { const demo = getDemo(room) || { roomId: room, createdAt: Date.now(), phase: 'lobby' as const, maxParticipants: 30, hostUid: 'demo-host', participants: {} }; if (Object.keys(demo.participants).length >= demo.maxParticipants) throw new Error('Комната уже заполнена'); setDemo({ ...demo, participants: { ...demo.participants, [p.id]: p } }) }
      localStorage.setItem(`atmosphere-participant-${room}`, JSON.stringify(p)); setParticipant(p)
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Не удалось подключиться') }
  }
  const answer = async (value: Answer) => {
    if (!session || !participant || saving) return
    setSaving(true)
    const question = questions[participant.currentQuestionIndex]
    const nextIndex = participant.currentQuestionIndex + 1
    try {
      if (firebaseReady) await saveAnswer(room, participant, question.id, value, nextIndex)
      else { const status: Participant['status'] = nextIndex >= questions.length ? 'finished' : 'answering'; const next: Participant = { ...participant, answers: { ...participant.answers, [question.id]: value }, currentQuestionIndex: nextIndex, status, ...(nextIndex >= questions.length ? { completedAt: Date.now() } : {}) }; const nextSession: Session = { ...session, participants: { ...session.participants, [participant.id]: next } }; setDemo(nextSession); setSession(nextSession); setParticipant(next) }
    } finally { setSaving(false) }
  }
  if (!room) return <MobileShell><h1>Нужен код комнаты</h1><p>Отсканируйте QR-код ведущего, чтобы открыть личную ссылку.</p></MobileShell>
  if (!participant) return <MobileShell><p className="eyebrow">ОНЛАЙН-ДИАГНОСТИКА</p><h1>Атмосфера<br />нашей молодёжи</h1><p>Никнейм нужен только для твоей личной карточки. Реальное имя указывать не обязательно.</p><input value={name} onChange={event => setName(event.target.value)} placeholder="Например, «Свет»" maxLength={20} /><Button onClick={() => void join()}>Продолжить</Button>{notice && <p className="notice">{notice}</p>}</MobileShell>
  if (!session || session.phase === 'lobby') return <MobileShell><p className="eyebrow">ТЫ ПОДКЛЮЧЁН(А)</p><h1>Ждём ведущего</h1><p>Как только диагностика начнётся, первый вопрос появится здесь автоматически.</p><div className="waiting-dot" /></MobileShell>
  const openPersonal = async () => {
    if (!participant) return
    if (firebaseReady) await markPersonalViewed(room, participant.id)
    else if (session) { const next = { ...participant, personalViewedAt: Date.now() }; const nextSession = { ...session, participants: { ...session.participants, [participant.id]: next } }; setDemo(nextSession); setSession(nextSession); setParticipant(next) }
    setShowPersonal(true)
  }
  if (participant.status === 'finished' && showPersonal) return <PersonalResult participant={participant} scores={scoreAnswers(participant.answers || {})} onBack={() => setShowPersonal(false)} />
  if (participant.status === 'finished') return <Completion participant={participant} onPersonal={() => void openPersonal()} />
  const question = questions[participant.currentQuestionIndex]
  return <MobileShell><div className="progress-label"><span>ВОПРОС {participant.currentQuestionIndex + 1} ИЗ {questions.length}</span><span>{Math.round((participant.currentQuestionIndex / questions.length) * 100)}%</span></div><div className="progress"><i style={{ width: `${participant.currentQuestionIndex / questions.length * 100}%` }} /></div><h1 className="question">{question.title}</h1><p>Выбери вариант, который ближе всего к тебе.</p><div className="options">{(['A', 'B', 'C', 'D'] as Answer[]).map(letter => <button key={letter} className="option" disabled={saving} onClick={() => void answer(letter)}><b>{letter}</b><span>{question.options[letter]}</span></button>)}</div></MobileShell>
}

function MobileShell({ children }: { children: React.ReactNode }) { return <main className="mobile-wrap"><div className="mobile-card">{children}</div></main> }
function Completion({ participant, onPersonal }: { participant: Participant; onPersonal: () => void }) {
  return <MobileShell><div className="completion-mark">✦</div><p className="eyebrow">ГОТОВО</p><h1>{participant.nickname}, спасибо!</h1><p>Ты ответил(а) на все вопросы и помог(ла) увидеть общую картину. Твоя личная карточка уже готова — её видишь только ты.</p><Button onClick={onPersonal}>Получить личный результат</Button><div className="finish-wait"><span className="waiting-dot" /><small>После этого можешь посмотреть на общий экран и дождаться остальных участников.</small></div></MobileShell>
}
function PersonalResult({ participant, scores, onBack }: { participant: Participant; scores: Scores; onBack: () => void }) {
  return <MobileShell><div className="personal-result" id="personal-result"><p className="eyebrow">ТВОЯ ЛИЧНАЯ КАРТОЧКА</p><h1>{participant.nickname}, спасибо</h1><p>Это не оценка тебя. Это бережная подсказка, где можно расти дальше.</p><div className="score-circle"><b>{scores.total}%</b><small>общий ориентир</small></div><div className="score-list">{Object.entries(scores.categories).map(([id, value]) => <div key={id}><span>{categories[id as keyof typeof categories]}</span><strong>{value}%</strong><i><em style={{ width: `${value}%` }} /></i></div>)}</div><Glass className="tip"><b>Небольшой шаг</b><p>{recommendation(scores)}</p></Glass></div><div className="download-actions"><Button secondary onClick={() => printResult()}>Сохранить PDF</Button><Button secondary onClick={() => downloadPoster(participant, scores)}>Скачать PNG</Button></div><Button onClick={onBack}>Вернуться к ожиданию</Button><small>Твоя карточка не показывается на общем экране.</small></MobileShell>
}

function printResult() { document.body.dataset.printPersonal = 'true'; window.print(); window.setTimeout(() => delete document.body.dataset.printPersonal, 500) }
function downloadPoster(participant: Participant, scores: Scores) {
  const canvas = document.createElement('canvas'); canvas.width = 1080; canvas.height = 1350
  const ctx = canvas.getContext('2d'); if (!ctx) return
  ctx.fillStyle = '#03120e'; ctx.fillRect(0, 0, canvas.width, canvas.height)
  const glow = ctx.createRadialGradient(900, 80, 0, 900, 80, 600); glow.addColorStop(0, 'rgba(30, 119, 84, .85)'); glow.addColorStop(1, 'rgba(3, 18, 14, 0)'); ctx.fillStyle = glow; ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#32ce8b'; ctx.font = '700 30px Arial'; ctx.fillText('ДИАГНОСТИКА АТМОСФЕРЫ', 90, 110)
  ctx.fillStyle = '#eef5ee'; ctx.font = '700 68px Arial'; ctx.fillText(`${participant.nickname}, твоя`, 90, 205); ctx.fillText('личная карточка', 90, 285)
  ctx.beginPath(); ctx.arc(540, 510, 170, 0, Math.PI * 2); ctx.fillStyle = '#123d31'; ctx.fill(); ctx.strokeStyle = '#32ce8b'; ctx.lineWidth = 2; ctx.stroke()
  ctx.fillStyle = '#eef5ee'; ctx.font = '700 100px Arial'; ctx.textAlign = 'center'; ctx.fillText(`${scores.total}%`, 540, 535); ctx.font = '400 25px Arial'; ctx.fillStyle = '#9aafa5'; ctx.fillText('общий ориентир', 540, 582); ctx.textAlign = 'left'
  let y = 770; Object.entries(scores.categories).forEach(([id, value]) => { ctx.fillStyle = '#eef5ee'; ctx.font = '600 28px Arial'; ctx.fillText(categories[id as keyof typeof categories], 90, y); ctx.textAlign = 'right'; ctx.fillStyle = '#32ce8b'; ctx.fillText(`${value}%`, 990, y); ctx.textAlign = 'left'; ctx.fillStyle = '#0e362b'; ctx.fillRect(90, y + 22, 900, 14); ctx.fillStyle = '#32ce8b'; ctx.fillRect(90, y + 22, 900 * value / 100, 14); y += 115 })
  ctx.fillStyle = '#c8ae67'; ctx.font = '700 27px Arial'; ctx.fillText('НЕБОЛЬШОЙ ШАГ', 90, 1230); ctx.fillStyle = '#9aafa5'; ctx.font = '400 25px Arial'; wrapCanvasText(ctx, recommendation(scores), 90, 1275, 900, 35)
  const anchor = document.createElement('a'); anchor.download = `личная-карточка-${participant.nickname}.png`; anchor.href = canvas.toDataURL('image/png'); anchor.click()
}
function wrapCanvasText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number) { let line = ''; let top = y; text.split(' ').forEach(word => { const next = `${line}${word} `; if (ctx.measureText(next).width > maxWidth && line) { ctx.fillText(line, x, top); line = `${word} `; top += lineHeight } else line = next }); ctx.fillText(line, x, top) }

function Stage({ room }: { room: string }) {
  const [session, , connection] = useRoom(room)
  if (!room) return <main className="stage"><p className="eyebrow">ЭКРАН ПРОГРЕССА</p><h1>Нужен код комнаты</h1><p className="stage-caption">Откройте этот экран из панели ведущего.</p></main>
  if (!session) return <main className="stage"><div className="stage-glow" /><p className="eyebrow">ЭКРАН ПРОГРЕССА</p><h1>{connection === 'error' ? 'Не удалось подключиться' : 'Подключаемся к комнате'}</h1><p className="stage-caption">{connection === 'error' ? 'Проверьте интернет и откройте экран ещё раз.' : 'Это займёт несколько секунд.'}</p>{connection === 'error' ? <Button secondary onClick={() => window.location.reload()}>Повторить подключение</Button> : <div className="waiting-dot" />}</main>
  const people = Object.values(session?.participants || {})
  const activeQuestionCount = session?.questions?.length || questions.length
  const answers = people.reduce((sum, participant) => sum + Object.keys(participant.answers || {}).length, 0)
  const total = Math.max(people.length * activeQuestionCount, 1)
  const progress = Math.round(answers / total * 100)
  return <main className="stage"><div className="stage-glow" /><p className="eyebrow">ДИАГНОСТИКА АТМОСФЕРЫ МОЛОДЁЖИ</p><h1>{session?.phase === 'lobby' ? 'Скоро начнём' : session?.phase === 'resultsIntro' ? 'Собираем общую картину' : session?.phase === 'resultsReal' ? 'Результаты готовы' : session ? 'Мы идём вместе' : 'Ожидаем комнату'}</h1><p className="stage-caption">{session?.phase === 'lobby' ? 'Участники подключаются по QR-коду.' : session?.phase === 'live' ? 'Каждый отвечает в своём темпе. Здесь — только общий прогресс.' : 'Спасибо каждому, кто ответил честно.'}</p><div className="stage-metrics"><Metric label="Подключились" value={people.length} note="участников" /><Metric label="Отвечают" value={people.filter(person => person.status === 'answering').length} note="в своём темпе" /><Metric label="Завершили" value={people.filter(person => person.status === 'finished').length} note="готовы к итогу" /></div><Glass className="stage-progress"><p>Общий прогресс</p><strong>{answers} <small>из {total} ответов</small></strong><div className="progress large"><i style={{ width: `${progress}%` }} /></div><span>{progress}%</span></Glass><small className="privacy">На этом экране отображаются только общие числа.</small></main>
}

function Results({ room }: { room: string }) {
  const [session] = useRoom(room)
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 250); return () => clearInterval(timer) }, [])
  const elapsed = session?.resultsIntroStartedAt ? now - session.resultsIntroStartedAt : 0
  const showReal = session?.phase === 'resultsReal' || elapsed >= 20000
  const people = Object.values(session?.participants || {})
  const real = useMemo(() => { if (!people.length) return { communication: 84, forgiveness: 71, service: 79, care: 68 }; const values = people.map(person => scoreAnswers(person.answers || {}, session?.questions || questions).categories); return Object.fromEntries(Object.keys(categories).map(key => [key, Math.round(values.reduce((sum, item) => sum + item[key as keyof typeof item], 0) / values.length)])) as Record<keyof typeof categories, number> }, [people, session?.questions])
  const shown = showReal ? real : { communication: 96, forgiveness: 94, service: 97, care: 93 }
  const countdown = Math.max(0, Math.ceil((20000 - elapsed) / 1000))
  return <main className={`results ${showReal ? 'reveal' : 'intro'}`}><p className="eyebrow">ОБЩИЙ РЕЗУЛЬТАТ · {showReal ? 'РЕАЛЬНЫЕ ДАННЫЕ' : `ИДЕАЛЬНЫЙ ОРИЕНТИР · ${countdown} СЕК.`}</p><h1>{showReal ? 'Наша общая картина' : 'Какими мы можем быть вместе'}</h1>{!showReal && <div className="result-loader"><i /><span>Через несколько секунд увидим реальную картину группы</span></div>}<Glass className="result-board"><div className="big-score"><b>{Math.round(Object.values(shown).reduce((a, b) => a + b, 0) / 4)}%</b><span>общий ориентир</span></div><div className="result-bars">{Object.entries(shown).map(([id, value]) => <div key={id}><span>{categories[id as keyof typeof categories]}</span><b>{value}%</b><i><em style={{ width: `${value}%` }} /></i></div>)}</div></Glass><p className="closing">Любовь и единство начинаются не с других, а лично с каждого из нас.</p><small className="privacy">Показаны только агрегированные результаты — без имён и личных ответов.</small></main>
}

export default App

