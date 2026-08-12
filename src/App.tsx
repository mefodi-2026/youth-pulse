import { useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'
import { categories, questions } from './data/questions'
import { archiveSession, createSession, createSessionRecord, defaultDiagnosticTemplateSelection, defaultRoomTitle, diagnosticPackId, ensureAuth, firebaseReady, isPlatformOwner, joinSession, loginLeader, logoutLeader, markPersonalViewed, registerLeader, saveAnswer, saveWorkspacePack, subscribeAuthUser, subscribeLeaderProfile, subscribePublishedGlobalPacks, subscribeSession, subscribeSessionArchives, subscribeWorkspace, subscribeWorkspacePack, updatePhase, updateRoomTitle, updateSessionPilotCounts, type RoomPilotDetails } from './lib/firebase'
import { getGameModule } from './lib/gameRegistry'
import { downloadWishPng, printWish } from './lib/export'
import { StageDashboard } from './StageDashboard'
import { MobileParticipantFlow } from './MobileParticipantFlow'
import { type Answer, type ContentPack, type LeaderProfile, type Participant, type Question, type RoomMode, type Scores, type Session, type SessionArchive, type SessionPhase, type TemplateSelection, type Workspace } from './types'
import { appBasePath as getAppBasePath, createJoinUrl } from './lib/urls'
import { nextCategoryQuestionOrder, orderQuestionsByCategory } from './lib/questionOrder'
import { OwnerAdmin } from './OwnerAdmin'

const demoKey = (room: string) => `atmosphere-demo-${room}`
const getDemo = (room: string) => JSON.parse(localStorage.getItem(demoKey(room)) || 'null') as Session | null
const setDemo = (session: Session) => { localStorage.setItem(demoKey(session.roomId), JSON.stringify(session)); window.dispatchEvent(new StorageEvent('storage', { key: demoKey(session.roomId) })) }
const makeRoom = () => Math.random().toString(36).slice(2, 8).toUpperCase()
const appBasePath = import.meta.env.BASE_URL.replace(/\/$/, '')
const currentPath = () => window.location.pathname.replace(/\/+$/, '') || '/'
const queryRoom = () => new URLSearchParams(window.location.search).get('room')?.toUpperCase() || ''
const go = (path: string) => { window.history.pushState({}, '', `${appBasePath}${path}`); window.dispatchEvent(new PopStateEvent('popstate')) }

const createFeedbackUrl = (formUrl: string, session: Session | null) => {
  if (!formUrl.trim() || !session) return ''
  try {
    const values: Record<string, string> = { roomId: session.roomId, workspaceId: session.workspaceId || '', groupName: session.groupName || '', hostUid: session.hostUid }
    const template = Object.entries(values).reduce((url, [key, value]) => url.replaceAll(`{{${key}}}`, encodeURIComponent(value)), formUrl.trim())
    const url = new URL(template)
    url.searchParams.set('roomId', session.roomId)
    url.searchParams.set('workspaceId', session.workspaceId || '')
    url.searchParams.set('groupName', session.groupName || '')
    url.searchParams.set('hostUid', session.hostUid)
    return url.toString()
  } catch { return '' }
}

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
    if (!room) {
      setSession(null)
      setConnection('idle')
      return
    }
    setSession(null)
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
  return [session?.roomId === room ? session : null, setSession, connection] as const
}

function App() {
  const path = useRoute()
  if (path.endsWith('/owner')) return <OwnerAdmin />
  if (path.endsWith('/owner-login')) return <AuthPage mode="owner-login" />
  if (path.endsWith('/login')) return <AuthPage mode="login" />
  if (path.endsWith('/register')) return <AuthPage mode="register" />
  if (path.endsWith('/account')) return <LeaderRoute allowInactive>{profile => <AccountPage profile={profile} />}</LeaderRoute>
  if (path.endsWith('/host') || path.endsWith('/results')) {
    const requestedTab = readHostTab()
    return <LeaderRoute>{profile => <Host leader={profile} initialTab={path.endsWith('/results') ? 'results' : requestedTab} initialRoom={queryRoom()} />}</LeaderRoute>
  }
  if (path.endsWith('/join')) return <MobileParticipantFlow room={queryRoom()} />
  if (path.endsWith('/stage')) return <StageDashboard room={queryRoom()} />
  return <AppEntry />
}

/** The root route is an entry gate, not a public product page. A leader who
 * already has a persisted Firebase session is sent straight to the Host UI. */
function AppEntry() {
  const leader = useLeaderProfile()
  if (leader.loading) return <main className="auth-page"><Glass className="auth-card"><p className="eyebrow">ПРОВЕРКА ДОСТУПА</p><h1>Подключаем аккаунт…</h1></Glass></main>
  if (!leader.userUid) return <AuthRedirect to="/login" />
  return <AuthRedirect to={leader.profile?.status === 'active' ? '/host?tab=main' : '/account'} />
}

function LandingPage() {
  return <main className="landing landing-product">
    <div className="orb orb-a" /><div className="orb orb-b" />
    <button type="button" className="landing-owner-login" onClick={() => go('/owner-login')}>Вход владельца</button>
    <div className="landing-grid">
      <section className="landing-copy">
        <p className="eyebrow">МОЛОДЁЖНАЯ ПЛАТФОРМА</p>
        <h1>Атмосфера<br />нашей молодёжи</h1>
        <p className="landing-lead">Пространство для бережных диагностик, викторин и интерактивных встреч молодёжных групп.</p>
        <div className="landing-actions"><Button onClick={() => go('/login')}>Войти</Button><Button secondary onClick={() => go('/register')}>Создать аккаунт</Button></div>
      </section>
      <Glass className="landing-visual">
        <div className="landing-visual-glow" />
        <p className="eyebrow">АТМОСФЕРА</p>
        <h2>Встречи, в которых слышен каждый.</h2>
        <div className="landing-feature-list">
          <article><span>01</span><div><b>Диагностика</b><small>Соберите честную картину встречи без сравнения участников.</small></div></article>
          <article><span>02</span><div><b>Интерактивные форматы</b><small>Викторины и другие игровые модули постепенно появятся в платформе.</small></div></article>
        </div>
        <div className="landing-orbit"><i /><i /><strong>✦</strong></div>
      </Glass>
    </div>
  </main>
}

function AuthRedirect({ to }: { to: string }) {
  useEffect(() => { go(to) }, [to])
  return <main className="auth-page"><Glass className="auth-card"><p className="eyebrow">ПЕРЕХОД</p><h1>Открываем страницу…</h1></Glass></main>
}

function useLeaderProfile() {
  const [userUid, setUserUid] = useState<string | null>(null)
  const [profile, setProfile] = useState<LeaderProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    let unsubscribeProfile: () => void = () => undefined
    const unsubscribeAuth = subscribeAuthUser(user => {
      unsubscribeProfile()
      setError('')
      if (!user || user.isAnonymous) {
        setUserUid(null); setProfile(null); setLoading(false)
        return
      }
      setUserUid(user.uid); setLoading(true)
      unsubscribeProfile = subscribeLeaderProfile(user.uid, value => { setProfile(value); setLoading(false) }, reason => { setError(reason.message); setLoading(false) })
    })
    return () => { unsubscribeProfile(); unsubscribeAuth() }
  }, [])
  return { userUid, profile, loading, error }
}

function LeaderRoute({ children, allowInactive = false }: { children: (profile: LeaderProfile) => React.ReactNode; allowInactive?: boolean }) {
  const leader = useLeaderProfile()
  if (leader.loading) return <main className="auth-page"><Glass className="auth-card"><p className="eyebrow">ПРОВЕРКА ДОСТУПА</p><h1>Подключаем аккаунт…</h1></Glass></main>
  if (!leader.userUid) return <AuthRedirect to="/login" />
  if (!leader.profile) return <main className="auth-page"><Glass className="auth-card"><p className="eyebrow">АККАУНТ НЕ ГОТОВ</p><h1>Профиль ведущего не найден</h1><p>{leader.error || 'Завершите регистрацию или обратитесь к администратору.'}</p><Button onClick={() => void logoutLeader().then(() => go('/login'))}>Выйти</Button></Glass></main>
  if (!allowInactive && leader.profile.status !== 'active') return <AuthRedirect to="/account" />
  return <>{children(leader.profile)}</>
}

const authErrorText = (error: unknown) => {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''
  if (code === 'auth/email-already-in-use') return 'Этот email уже зарегистрирован.'
  if (code === 'auth/invalid-email') return 'Введите корректный email.'
  if (code === 'auth/weak-password') return 'Пароль должен содержать минимум 6 символов.'
  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') return 'Неверный email или пароль.'
  if (code === 'auth/operation-not-allowed') return 'В Firebase нужно включить вход по Email/Password.'
  return error instanceof Error ? error.message : 'Не удалось выполнить операцию. Попробуйте ещё раз.'
}

function AuthPage({ mode }: { mode: 'login' | 'register' | 'owner-login' }) {
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [workspaceName, setWorkspaceName] = useState('')
  const [city, setCity] = useState('')
  const [inviteCode, setInviteCode] = useState(() => new URLSearchParams(window.location.search).get('invite') || '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const register = mode === 'register'
  const ownerLogin = mode === 'owner-login'
  useEffect(() => {
    if (!ownerLogin) return
    let alive = true
    const unsubscribe = subscribeAuthUser(user => {
      if (!user || user.isAnonymous) return
      void isPlatformOwner().then(owner => {
        if (!alive) return
        if (owner) go('/owner')
        else setError('У вас нет доступа к панели владельца.')
      }).catch(() => {
        if (alive) setError('Не удалось проверить доступ владельца. Проверьте соединение и попробуйте снова.')
      })
    })
    return () => { alive = false; unsubscribe() }
  }, [ownerLogin])
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setError('')
    if (!firebaseReady) return setError('Firebase пока не настроен для входа.')
    if (register && (!fullName.trim() || !phone.trim() || !workspaceName.trim() || !city.trim())) return setError('Заполните все поля профиля.')
    if (password.length < 6) return setError('Пароль должен содержать минимум 6 символов.')
    setBusy(true)
    try {
      if (register) {
        const profile = await registerLeader({ fullName, phone, email, password, workspaceName, city, inviteCode })
        go(profile.status === 'active' ? '/host' : '/account')
      } else if (ownerLogin) {
        await loginLeader(email, password)
        if (!await isPlatformOwner()) {
          setError('У вас нет доступа к панели владельца.')
          return
        }
        go('/owner')
      } else {
        await loginLeader(email, password)
        go('/host')
      }
    } catch (reason) { setError(authErrorText(reason)) } finally { setBusy(false) }
  }
  if (ownerLogin) return <main className="auth-page"><div className="orb orb-a" /><div className="orb orb-b" /><Glass className="auth-card"><p className="eyebrow">ВЛАДЕЛЕЦ ПЛАТФОРМЫ</p><h1>Вход владельца</h1><p>После входа Firebase обновит токен и безопасно подтвердит роль владельца через Custom Claim.</p><form className="auth-form" onSubmit={event => void submit(event)}><label>Email<input value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" inputMode="email" type="email" required /></label><label>Пароль<input value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" type="password" minLength={6} required /></label><Button disabled={busy}>{busy ? 'Проверяем…' : 'Проверить и войти'}</Button></form>{error && <p className="auth-error">{error}</p>}<div className="auth-switch">Обычный вход? <button type="button" onClick={() => go('/login')}>Перейти к входу</button></div></Glass></main>
  return <main className="auth-page"><div className="orb orb-a" /><div className="orb orb-b" /><Glass className="auth-card"><p className="eyebrow">ПАНЕЛЬ ВЕДУЩЕГО</p><h1>{register ? 'Создать аккаунт' : 'Войти в аккаунт'}</h1><p>{register ? 'Создайте отдельный аккаунт для вашей молодёжки. Пароль хранится только в Firebase Authentication.' : 'Войдите, чтобы управлять комнатами и вопросами своей молодёжки.'}</p><form className="auth-form" onSubmit={event => void submit(event)}>{register && <><label>Имя и фамилия<input value={fullName} onChange={event => setFullName(event.target.value)} autoComplete="name" /></label><label>Телефон<input value={phone} onChange={event => setPhone(event.target.value)} autoComplete="tel" inputMode="tel" /></label><label>Название молодёжки<input value={workspaceName} onChange={event => setWorkspaceName(event.target.value)} /></label><label>Город<input value={city} onChange={event => setCity(event.target.value)} autoComplete="address-level2" /></label></>}<label>Email<input value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" inputMode="email" type="email" required /></label><label>Пароль<input value={password} onChange={event => setPassword(event.target.value)} autoComplete={register ? 'new-password' : 'current-password'} type="password" minLength={6} required /></label>{register && <label>Код приглашения <small>необязательно</small><input value={inviteCode} onChange={event => setInviteCode(event.target.value.toUpperCase())} /></label>}<Button disabled={busy}>{busy ? 'Подождите…' : register ? 'Зарегистрироваться' : 'Войти'}</Button></form>{error && <p className="auth-error">{error}</p>}<div className="auth-switch">{register ? <>Уже есть аккаунт? <button type="button" onClick={() => go('/login')}>Войти</button></> : <>Нет аккаунта? <button type="button" onClick={() => go('/register')}>Зарегистрироваться</button></>}</div></Glass></main>
}

function AccountPage({ profile }: { profile: LeaderProfile }) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  useEffect(() => subscribeWorkspace(profile.workspaceId, setWorkspace), [profile.workspaceId])
  const labels = { pending: 'Ожидает активации', active: 'Активен', paused: 'Приостановлен', revoked: 'Доступ отозван' }
  return <main className="auth-page"><Glass className="auth-card account-card"><p className="eyebrow">АККАУНТ ВЕДУЩЕГО</p><h1>{profile.fullName}</h1><p className={`account-status ${profile.status}`}>{labels[profile.status]}</p><dl><div><dt>Молодёжка</dt><dd>{workspace?.name || profile.workspaceId}</dd></div>{workspace?.city && <div><dt>Город</dt><dd>{workspace.city}</dd></div>}<div><dt>Email</dt><dd>{profile.email}</dd></div><div><dt>Телефон</dt><dd>{profile.phone}</dd></div></dl>{profile.status === 'pending' && <p>Заявка сохранена. Доступ к панели появится после активации или регистрации по действующей invite-ссылке.</p>}{profile.status === 'paused' && <p>Доступ к панели временно приостановлен.</p>}{profile.status === 'revoked' && <p>Доступ к панели отозван. Обратитесь к администратору.</p>}{profile.status === 'active' && <Button onClick={() => go('/host')}>Открыть панель ведущего</Button>}<Button secondary onClick={() => void logoutLeader().then(() => go('/login'))}>Выйти</Button></Glass></main>
}

function HomePanel({ name, onStart, questionCount }: { name: string; onStart: () => void; questionCount: number }) {
  return <div className="home-panel"><div className="home-grid"><section className="home-copy"><p className="eyebrow">ГЛАВНОЕ · АТМОСФЕРА</p><h2>Рады видеть вас,<br />{name}</h2><p className="home-lead">«Атмосфера» помогает проводить диагностики, викторины и интерактивные игры для молодёжных групп — бережно, понятно и без лишней подготовки.</p><div className="control-actions"><Button onClick={onStart}>Перейти к созданию комнаты</Button><Button secondary disabled>Библейская викторина · скоро</Button></div><p className="home-feedback">Сейчас продукт находится на этапе разработки. Доступны две функции для тестир…14964 tokens truncated…сылка должна быть полной, начиная с https://.</p>}</Glass><Glass className="settings-panel"><p className="eyebrow">СЕССИЯ</p><h2>Завершение</h2><p>После завершения участники больше не смогут отвечать. Участники, ответы, результаты и экспорт останутся в архиве.</p><Button secondary disabled={session.phase === 'closed'} onClick={closeRoom}>{session.phase === 'closed' ? 'Комната завершена' : 'Завершить комнату'}</Button>{actionError && <p className="connection-warning">{actionError}</p>}</Glass></div>}
  </HostLayout>
}

function exportCsv(session: Session, leader: LeaderProfile) {
  const questionSet = getGameModule(session?.gameTypeId).getQuestions(session, questions)
  const participantCount = session.participantCount ?? Object.keys(session.participants || {}).length
  const completedCount = session.completedCount ?? Object.values(session.participants || {}).filter(participant => participant.status === 'finished').length
  const common = [leader.fullName, leader.email, session.workspaceId || leader.workspaceId, session.hostUid, session.groupName || '', session.city || '', session.mode === 'quiz' ? 'Викторина' : 'Диагностика', session.packId || '', session.packVersion || '', new Date(session.createdAt).toISOString(), session.startedAt ? new Date(session.startedAt).toISOString() : '', session.closedAt ? new Date(session.closedAt).toISOString() : '', session.estimatedParticipants ?? '', participantCount, completedCount]
  const rows = Object.values(session.participants).map(participant => {
    const scores = getGameModule(session?.gameTypeId).score(participant.answers, questionSet)
    return [...common, participant.id, participant.nickname, participant.status, ...questionSet.flatMap(question => { const selected = participant.answers[question.id]; return [question.title, selected === 'SKIP' ? 'Пропущен (−1 балл)' : selected ? question.options[selected] : ''] }), scores.total, ...Object.values(scores.categories)]
  })
  const headers = ['leaderName', 'leaderEmail', 'workspaceId', 'hostUid', 'groupName', 'city', 'mode', 'packId', 'packVersion', 'createdAt', 'startedAt', 'closedAt', 'estimatedParticipants', 'participantCount', 'completedCount', 'participantId', 'nickname', 'status', ...questionSet.flatMap((_, index) => [`Вопрос ${index + 1}`, `Ответ ${index + 1}`]), 'total', ...Object.values(categories)]
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
    const activeQuestions = getGameModule(session?.gameTypeId).getQuestions(session, questions)
    const question = activeQuestions[participant.currentQuestionIndex]
    const nextIndex = participant.currentQuestionIndex + 1
    try {
      if (firebaseReady) await saveAnswer(room, participant, question.id, value, nextIndex, activeQuestions.length)
      else { const status: Participant['status'] = nextIndex >= activeQuestions.length ? 'finished' : 'answering'; const next: Participant = { ...participant, answers: { ...participant.answers, [question.id]: value }, currentQuestionIndex: nextIndex, status, ...(nextIndex >= activeQuestions.length ? { completedAt: Date.now() } : {}) }; const nextSession: Session = { ...session, participants: { ...session.participants, [participant.id]: next } }; setDemo(nextSession); setSession(nextSession); setParticipant(next) }
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
  if (participant.status === 'finished' && showPersonal) return <PersonalResult participant={participant} scores={getGameModule(session?.gameTypeId).score(participant.answers || {}, getGameModule(session?.gameTypeId).getQuestions(session, questions))} onBack={() => setShowPersonal(false)} />
  if (participant.status === 'finished') return <Completion participant={participant} onPersonal={() => void openPersonal()} />
  const activeQuestions = getGameModule(session?.gameTypeId).getQuestions(session, questions)
  const question = activeQuestions[participant.currentQuestionIndex]
  return <MobileShell><div className="progress-label"><span>ВОПРОС {participant.currentQuestionIndex + 1} ИЗ {questions.length}</span><span>{Math.round((participant.currentQuestionIndex / questions.length) * 100)}%</span></div><div className="progress"><i style={{ width: `${participant.currentQuestionIndex / questions.length * 100}%` }} /></div><h1 className="question">{question.title}</h1><p>Выбери вариант, который ближе всего к тебе.</p><div className="options">{(['A', 'B', 'C', 'D'] as Answer[]).map(letter => <button key={letter} className="option" disabled={saving} onClick={() => void answer(letter)}><b>{letter}</b><span>{question.options[letter]}</span></button>)}</div></MobileShell>
}

function MobileShell({ children }: { children: React.ReactNode }) { return <main className="mobile-wrap"><div className="mobile-card">{children}</div></main> }
function Completion({ participant, onPersonal }: { participant: Participant; onPersonal: () => void }) {
  return <MobileShell><div className="completion-mark">✦</div><p className="eyebrow">ГОТОВО</p><h1>{participant.nickname}, спасибо!</h1><p>Ты ответил(а) на все вопросы и помог(ла) увидеть общую картину. Твоя личная карточка уже готова — её видишь только ты.</p><Button onClick={onPersonal}>Получить личный результат</Button><div className="finish-wait"><span className="waiting-dot" /><small>После этого можешь посмотреть на общий экран и дождаться остальных участников.</small></div></MobileShell>
}
function PersonalResult({ participant, scores, onBack }: { participant: Participant; scores: Scores; onBack: () => void }) {
  return <MobileShell><div className="personal-result" id="personal-result"><p className="eyebrow">ТВОЯ ЛИЧНАЯ КАРТОЧКА</p><h1>{participant.nickname}, спасибо</h1><p>Это не оценка тебя. Это бережная подсказка, где можно расти дальше.</p><div className="score-circle"><b>{scores.total}%</b><small>общий ориентир</small></div><div className="score-list">{Object.entries(scores.categories).map(([id, value]) => { const barValue = Math.max(0, Math.min(100, value)); return <div key={id}><span>{categories[id as keyof typeof categories]}</span><strong>{value}%</strong><i><em style={{ width: `${barValue}%` }} /></i></div> })}</div><div className="wish-download-panel"><p>По итогам твоих ответов мы подготовили для тебя пожелания. Их можно скачать на телефон в PDF-формате или как картинку.</p><div className="download-actions"><Button secondary onClick={() => printWish(participant, scores)}>Сохранить PDF</Button><Button secondary onClick={() => downloadWishPng(participant, scores)}>Скачать PNG</Button></div></div></div><Button onClick={onBack}>Вернуться к ожиданию</Button><small>Твоя карточка не показывается на общем экране.</small></MobileShell>
}

function ResultRing({ value }: { value: number }) {
  const [draw, setDraw] = useState(false)
  const circumference = 2 * Math.PI * 92
  const ringValue = Math.max(0, Math.min(100, value))
  useEffect(() => { const timer = window.setTimeout(() => setDraw(true), 180); return () => window.clearTimeout(timer) }, [])
  return <div className="result-ring"><svg viewBox="0 0 220 220" aria-hidden="true"><circle className="result-ring-track" cx="110" cy="110" r="92" /><circle className="result-ring-progress" cx="110" cy="110" r="92" style={{ strokeDasharray: circumference, strokeDashoffset: draw ? circumference * (1 - ringValue / 100) : circumference }} /></svg><div><b>{value}%</b><span>общий ориентир</span></div></div>
}

function Stage({ room }: { room: string }) {
  const [session, , connection] = useRoom(room)
  if (!room) return <main className="stage"><p className="eyebrow">ЭКРАН ПРОГРЕССА</p><h1>Нужен код комнаты</h1><p className="stage-caption">Откройте этот экран из панели ведущего.</p></main>
  if (!session) return <main className="stage"><div className="stage-glow" /><p className="eyebrow">ЭКРАН ПРОГРЕССА</p><h1>{connection === 'error' ? 'Не удалось подключиться' : 'Подключаемся к комнате'}</h1><p className="stage-caption">{connection === 'error' ? 'Проверьте интернет и откройте экран ещё раз.' : 'Это займёт несколько секунд.'}</p>{connection === 'error' ? <Button secondary onClick={() => window.location.reload()}>Повторить подключение</Button> : <div className="waiting-dot" />}</main>
  const people = Object.values(session?.participants || {})
  const activeQuestionCount = getGameModule(session?.gameTypeId).getQuestions(session, questions).length
  const answers = people.reduce((sum, participant) => sum + Object.keys(participant.answers || {}).length, 0)
  const total = Math.max(people.length * activeQuestionCount, 1)
  const progress = Math.round(answers / total * 100)
  return <main className="stage"><div className="stage-glow" /><p className="eyebrow">ДИАГНОСТИКА АТМОСФЕРЫ МОЛОДЁЖИ</p><h1>{session?.phase === 'lobby' ? 'Скоро начнём' : session?.phase === 'resultsIntro' ? 'Собираем общую картину' : session?.phase === 'resultsReal' ? 'Результаты готовы' : session ? 'Мы идём вместе' : 'Ожидаем комнату'}</h1><p className="stage-caption">{session?.phase === 'lobby' ? 'Участники подключаются по QR-коду.' : session?.phase === 'live' ? 'Каждый отвечает в своём темпе. Здесь — только общий прогресс.' : 'Спасибо каждому, кто ответил честно.'}</p><div className="stage-metrics"><Metric label="Подключились" value={people.length} note="участников" /><Metric label="Отвечают" value={people.filter(person => person.status === 'answering').length} note="в своём темпе" /><Metric label="Завершили" value={people.filter(person => person.status === 'finished').length} note="готовы к итогу" /></div><Glass className="stage-progress"><p>Общий прогресс</p><strong>{answers} <small>из {total} ответов</small></strong><div className="progress large"><i style={{ width: `${progress}%` }} /></div><span>{progress}%</span></Glass><small className="privacy">На этом экране отображаются только общие числа.</small></main>
}

function Results({ room, sessionOverride, embedded = false }: { room: string; sessionOverride?: Session | null; embedded?: boolean }) {
  const [liveSession] = useRoom(room)
  const session = sessionOverride || liveSession
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 250); return () => clearInterval(timer) }, [])
  const elapsed = session?.resultsIntroStartedAt ? now - session.resultsIntroStartedAt : 0
  const showReal = session?.phase === 'resultsReal' || elapsed >= 20000
  const people = Object.values(session?.participants || {})
  const real = useMemo(() => { if (!people.length) return { communication: 84, forgiveness: 71, service: 79, care: 68, honesty: 76 }; const game = getGameModule(session?.gameTypeId); const values = people.map(person => game.score(person.answers || {}, game.getQuestions(session, questions)).categories); return Object.fromEntries(Object.keys(categories).map(key => [key, Math.round(values.reduce((sum, item) => sum + item[key as keyof typeof item], 0) / values.length)])) as Record<keyof typeof categories, number> }, [people, session?.gameTypeId, session?.questions, session?.templateSnapshot])
  const shown = showReal ? real : { communication: 96, forgiveness: 94, service: 97, care: 93, honesty: 95 }
  const overall = Math.round(Object.values(shown).reduce((a, b) => a + b, 0) / Object.keys(categories).length)
  const countdown = Math.max(0, Math.ceil((20000 - elapsed) / 1000))
  if (embedded) return <div className={`results ${showReal ? 'reveal' : 'intro'}`}><p className="eyebrow">ОБЩИЙ РЕЗУЛЬТАТ · {showReal ? 'РЕАЛЬНЫЕ ДАННЫЕ' : `ИДЕАЛЬНЫЙ ОРИЕНТИР · ${countdown} СЕК.`}</p><h1>{showReal ? 'Наша общая картина' : 'Какими мы можем быть вместе'}</h1>{!showReal && <div className="result-loader"><i /><span>Через несколько секунд увидим реальную картину группы</span></div>}<Glass className="result-board"><ResultRing value={overall} /><div className="result-bars">{Object.entries(shown).map(([id, value]) => <div key={id}><span>{categories[id as keyof typeof categories]}</span><b className={value < 0 ? 'negative' : ''}>{value}%</b><i><em style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></i></div>)}</div></Glass><p className="closing">Любовь и единство начинаются не с других, а лично с каждого из нас.</p></div>
  return <main className={`results ${showReal ? 'reveal' : 'intro'}`}><p className="eyebrow">ОБЩИЙ РЕЗУЛЬТАТ · {showReal ? 'РЕАЛЬНЫЕ ДАННЫЕ' : `ИДЕАЛЬНЫЙ ОРИЕНТИР · ${countdown} СЕК.`}</p><h1>{showReal ? 'Наша общая картина' : 'Какими мы можем быть вместе'}</h1>{!showReal && <div className="result-loader"><i /><span>Через несколько секунд увидим реальную картину группы</span></div>}<Glass className="result-board"><ResultRing value={overall} /><div className="result-bars">{Object.entries(shown).map(([id, value]) => <div key={id}><span>{categories[id as keyof typeof categories]}</span><b className={value < 0 ? 'negative' : ''}>{value}%</b><i><em style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></i></div>)}</div></Glass><p className="closing">Любовь и единство начинаются не с других, а лично с каждого из нас.</p><small className="privacy">Показаны только агрегированные результаты — без имён и личных ответов.</small></main>
  return <main className={`results ${showReal ? 'reveal' : 'intro'}`}><p className="eyebrow">ОБЩИЙ РЕЗУЛЬТАТ · {showReal ? 'РЕАЛЬНЫЕ ДАННЫЕ' : `ИДЕАЛЬНЫЙ ОРИЕНТИР · ${countdown} СЕК.`}</p><h1>{showReal ? 'Наша общая картина' : 'Какими мы можем быть вместе'}</h1>{!showReal && <div className="result-loader"><i /><span>Через несколько секунд увидим реальную картину группы</span></div>}<Glass className="result-board"><div className="big-score"><b>{Math.round(Object.values(shown).reduce((a, b) => a + b, 0) / Object.keys(categories).length)}%</b><span>общий ориентир</span></div><div className="result-bars">{Object.entries(shown).map(([id, value]) => <div key={id}><span>{categories[id as keyof typeof categories]}</span><b>{value}%</b><i><em style={{ width: `${value}%` }} /></i></div>)}</div></Glass><p className="closing">Любовь и единство начинаются не с других, а лично с каждого из нас.</p><small className="privacy">Показаны только агрегированные результаты — без имён и личных ответов.</small></main>
}

export default App

