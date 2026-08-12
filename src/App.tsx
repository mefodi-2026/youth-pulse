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
  return <div className="home-panel"><div className="home-grid"><section className="home-copy"><p className="eyebrow">ГЛАВНОЕ · АТМОСФЕРА</p><h2>Рады видеть вас,<br />{name}</h2><p className="home-lead">«Атмосфера» помогает проводить диагностики, викторины и интерактивные игры для молодёжных групп — бережно, понятно и без лишней подготовки.</p><div className="control-actions"><Button onClick={onStart}>Перейти к созданию комнаты</Button><Button secondary disabled>Библейская викторина · скоро</Button></div><p className="home-feedback">Сейчас продукт находится на этапе разработки. Доступны две функции для тестирования: диагностика уже работает, а викторина готовится к запуску. Пожалуйста, протестируйте сервис и поделитесь обратной связью.</p></section><Glass className="home-visual"><div className="landing-visual-glow" /><p className="eyebrow">ЭТАП РАЗРАБОТКИ</p><h3>Диагностика уже доступна. Викторина — на подходе.</h3><div className="landing-feature-list"><article><span>01</span><div><b>Диагностика атмосферы</b><small>{questionCount || '—'} вопросов · {Object.keys(categories).length} тем · личные и общие результаты</small></div></article><article><span>02</span><div><b>Библия: викторина</b><small>Следующий модуль «Атмосферы». Сейчас он показан как функция в разработке.</small></div></article></div><div className="landing-orbit"><i /><i /><strong>✦</strong></div></Glass></div><section className="home-steps"><p className="eyebrow">КАК НАЧАТЬ</p><div><article><b>1</b><h3>Создайте комнату</h3><p>Откройте обзор и создайте новую комнату для своей встречи.</p></article><article><b>2</b><h3>Запустите формат</h3><p>Выберите диагностику или в будущем — игру, затем начните встречу.</p></article><article><b>3</b><h3>Подключите участников</h3><p>Покажите QR-код или отправьте одну ссылку участникам.</p></article><article><b>4</b><h3>Посмотрите итоги</h3><p>Откройте общую картину, библиотеку результатов и экспорт.</p></article></div></section></div>
}

function RulesPanel({ onStart }: { onStart: () => void }) {
  const rules = [
    ['Создать комнату', 'Откройте «Обзор» и создайте комнату. Код комнаты и QR-код появятся автоматически.'],
    ['Запустить диагностику или игру', 'Когда участники подключатся, запустите диагностику. Викторина появится здесь после следующего этапа разработки.'],
    ['Подключить участников', 'Участники сканируют QR-код или открывают ту же ссылку под ним. Оба способа ведут в одну комнату.'],
    ['Завершить комнату', 'Нажмите «Завершить комнату» в обзоре или настройках. После этого новые ответы не принимаются.'],
    ['Посмотреть результаты', 'Откройте раздел «Результаты»: там хранится общая картина завершённых встреч.'],
    ['Экспортировать данные', 'В разделе «Экспорт» скачивается файл с никнеймами, вопросами и полными текстами ответов.'],
    ['Библиотека встреч', 'После завершения участники, ответы и результаты остаются в библиотеке вашей молодёжной группы.']
  ] as const
  return <div className="rules-panel"><div className="rules-intro"><p className="eyebrow">ПРАВИЛА РАБОТЫ</p><h2>Краткая инструкция ведущего</h2><p>Этот раздел рассчитан на дальнейшее расширение: сюда можно добавлять иллюстрации, подробные сценарии и пошаговые инструкции, не меняя навигацию.</p><Button onClick={onStart}>Перейти к обзору</Button></div><div className="rules-list">{rules.map(([title, description], index) => <Glass className="rule-card" key={title}><span>{String(index + 1).padStart(2, '0')}</span><div><h3>{title}</h3><p>{description}</p></div></Glass>)}</div></div>
}

function ProfilePanel({ profile }: { profile: LeaderProfile }) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  useEffect(() => subscribeWorkspace(profile.workspaceId, setWorkspace), [profile.workspaceId])
  return <div className="stack"><Glass className="profile-panel"><p className="eyebrow">ПРОФИЛЬ ВЕДУЩЕГО</p><h2>{profile.fullName}</h2><p>Ваш профиль и рабочее пространство сохранены отдельно от комнат и результатов.</p><dl><div><dt>Молодёжка</dt><dd>{workspace?.name || profile.workspaceId}</dd></div>{workspace?.city && <div><dt>Город</dt><dd>{workspace.city}</dd></div>}<div><dt>Email</dt><dd>{profile.email}</dd></div><div><dt>Телефон</dt><dd>{profile.phone}</dd></div></dl><Button secondary onClick={() => void logoutLeader().then(() => go('/login'))}>Выйти из аккаунта</Button></Glass></div>
}

type HostTab = 'main' | 'overview' | 'currentRoom' | 'rooms' | 'results' | 'questions' | 'export' | 'settings' | 'profile' | 'rules'
type HostMenuItem = [HostTab, string, string]
const hostTabs: HostTab[] = ['main', 'overview', 'currentRoom', 'rooms', 'results', 'questions', 'export', 'settings', 'profile', 'rules']
const readHostTab = (): HostTab | undefined => {
  const value = new URLSearchParams(window.location.search).get('tab')
  return value && hostTabs.includes(value as HostTab) ? value as HostTab : undefined
}

function HostLayout({ menu, tab, onTab, room, session, participants, menuOpen, setMenuOpen, children, resultsMode = false }: { menu: HostMenuItem[]; tab: HostTab; onTab: (tab: HostTab) => void; room: string; session: Session | null; participants: number; menuOpen: boolean; setMenuOpen: (value: boolean) => void; children: React.ReactNode; resultsMode?: boolean }) {
  const selectTab = (next: HostTab) => { onTab(next); if (next === 'results' || window.innerWidth < 980) setMenuOpen(false) }
  const canReturnToRoom = Boolean(room && session && session.phase !== 'closed' && tab !== 'overview' && tab !== 'currentRoom')
  return <main className={`host-shell ${menuOpen ? 'is-menu-open' : 'is-menu-collapsed'} ${resultsMode ? 'results-mode' : ''}`}><button type="button" className="host-menu-toggle" aria-label="Открыть меню" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}><i /><i /><i /></button><div className="host-edge-trigger" onMouseEnter={() => setMenuOpen(true)} />{menuOpen && <button type="button" aria-label="Закрыть меню" className="host-menu-backdrop" onClick={() => setMenuOpen(false)} />}<aside className="host-menu"><div className="brand"><span>✦</span><b>Атмосфера</b><small>панель ведущего</small></div><nav>{menu.map(([id, label, icon]) => <button key={id} className={tab === id ? 'selected' : ''} onClick={() => selectTab(id)}><span>{icon}</span>{label}</button>)}</nav>{room && <div className="menu-room"><small>{session?.phase === 'closed' ? 'ЗАВЕРШЁННАЯ КОМНАТА' : 'ТЕКУЩАЯ КОМНАТА'}</small><b>{session?.roomTitle || room}</b><span>Код {session?.displayCode || room} · {participants} участников</span></div>}</aside><section className="host-content">{canReturnToRoom && <button type="button" className="return-to-room" onClick={() => selectTab('currentRoom')}>← Вернуться к текущей комнате</button>}{children}</section></main>
}

function Host({ leader, initialTab, initialRoom }: { leader: LeaderProfile; initialTab?: HostTab; initialRoom?: string }) {
  const roomKey = `atmosphere-host-room-${leader.uid}`
  const lastRoomKey = `atmosphere-host-last-room-${leader.uid}`
  const [room, setRoom] = useState(() => initialRoom || localStorage.getItem(roomKey) || localStorage.getItem(lastRoomKey) || localStorage.getItem('atmosphere-host-room') || '')
  const [session, setSession] = useRoom(room)
  const [qr, setQr] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [createError, setCreateError] = useState('')
  const [lastClosedRoom, setLastClosedRoom] = useState('')
  const tabKey = `atmosphere-host-tab-${leader.uid}`
  const [tab, setTab] = useState<HostTab>(() => initialTab || 'main')
  const [menuOpen, setMenuOpen] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 1080)
  const [resultRoom, setResultRoom] = useState(() => initialTab === 'results' ? initialRoom || '' : '')
  const [archives, setArchives] = useState<Record<string, SessionArchive>>({})
  const [questionBank, setQuestionBank] = useState<Question[]>(() => firebaseReady ? [] : questions)
  const templateKey = `atmosphere-template-selection-${leader.workspaceId}`
  const [templateSelection, setTemplateSelection] = useState<TemplateSelection>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(templateKey) || 'null') as TemplateSelection | null
      return saved?.selectedPackId && (saved.templateSource === 'system' || saved.templateSource === 'workspace') ? saved : defaultDiagnosticTemplateSelection
    } catch { return defaultDiagnosticTemplateSelection }
  })
  const [systemPacks, setSystemPacks] = useState<Record<string, ContentPack>>({})
  const [systemPacksState, setSystemPacksState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [systemPacksError, setSystemPacksError] = useState('')
  const [workspacePack, setWorkspacePack] = useState<ContentPack | null>(null)
  const [questionDraft, setQuestionDraft] = useState({ category: 'communication' as Question['category'], title: '', options: ['', '', '', ''] })
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null)
  const [questionSaving, setQuestionSaving] = useState(false)
  const [questionError, setQuestionError] = useState('')
  const [questionEditorOpen, setQuestionEditorOpen] = useState(false)
  const [roomTitleDraft, setRoomTitleDraft] = useState('')
  const [roomTitleSaving, setRoomTitleSaving] = useState(false)
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [roomDetails, setRoomDetails] = useState<RoomPilotDetails>({ groupName: '', city: '', mode: 'diagnostic', estimatedParticipants: 30 })
  const [historyFilters, setHistoryFilters] = useState({ query: '', mode: 'all' as 'all' | RoomMode, from: '', to: '' })
  const [publicOrigin, setPublicOrigin] = useState(() => localStorage.getItem('atmosphere-public-origin') || import.meta.env.VITE_PUBLIC_ORIGIN || window.location.origin)
  const feedbackFormKey = `atmosphere-feedback-form-${leader.workspaceId}`
  const [feedbackFormUrl, setFeedbackFormUrl] = useState(() => localStorage.getItem(feedbackFormKey) || import.meta.env.VITE_GOOGLE_FEEDBACK_FORM_URL || '')
  const hostUrl = (path: string) => `${getAppBasePath()}${path}`
  const joinUrl = room ? createJoinUrl(room, publicOrigin) : ''
  const participants = Object.values(session?.participants || {})
  const finished = participants.filter(p => p.status === 'finished').length
  const answering = participants.filter(p => p.status === 'answering').length
  const allFinished = participants.length > 0 && finished === participants.length
  const menu: HostMenuItem[] = [['main', 'Главное', '✦'], ['overview', 'Обзор', '⌁'], ['currentRoom', 'Текущая комната', '▣'], ['rooms', 'Комнаты', '◫'], ['results', 'Результаты', '◉'], ['questions', 'Вопросы', '◌'], ['export', 'Экспорт', '↓'], ['settings', 'Настройки', '⚙'], ['profile', 'Профиль', '◐'], ['rules', 'Правила', '?']]
  const archiveEntries = useMemo(() => Object.values(archives).filter(archived => archived.hostUid === leader.uid && (!archived.workspaceId || archived.workspaceId === leader.workspaceId)).sort((a, b) => b.archivedAt - a.archivedAt), [archives, leader.uid, leader.workspaceId])
  const filteredArchiveEntries = useMemo(() => archiveEntries.filter(archived => {
    const query = historyFilters.query.trim().toLocaleLowerCase('ru-RU')
    const haystack = `${archived.roomTitle || ''} ${archived.groupName || ''} ${archived.city || ''} ${archived.displayCode || archived.roomId}`.toLocaleLowerCase('ru-RU')
    const created = new Date(archived.createdAt)
    const from = historyFilters.from ? new Date(`${historyFilters.from}T00:00:00`) : null
    const to = historyFilters.to ? new Date(`${historyFilters.to}T23:59:59`) : null
    return (!query || haystack.includes(query)) && (historyFilters.mode === 'all' || archived.mode === historyFilters.mode) && (!from || created >= from) && (!to || created <= to)
  }), [archiveEntries, historyFilters])
  const navigate = (next: HostTab, targetRoom = room) => {
    setTab(next)
    localStorage.setItem(tabKey, next)
    if (next === 'results') { setResultRoom(targetRoom); setMenuOpen(false) }
    const params = new URLSearchParams({ tab: next })
    if (targetRoom) params.set('room', targetRoom)
    go(`/host?${params.toString()}`)
  }

  // The URL is the source of truth for navigation. This prevents an old
  // localStorage value (for example, "profile") from becoming the default
  // after a fresh login or a browser reload.
  useEffect(() => {
    setTab(initialTab || 'main')
  }, [initialTab])

  // A closed room is kept in Firebase and its archive, but it must never be
  // restored as the active room for the leader after a reload.
  useEffect(() => {
    if (session?.phase !== 'closed') return
    if (localStorage.getItem(roomKey) === room) localStorage.removeItem(roomKey)
    if (localStorage.getItem('atmosphere-host-room') === room) localStorage.removeItem('atmosphere-host-room')
    localStorage.setItem(lastRoomKey, room)
    setLastClosedRoom(room)
  }, [room, roomKey, lastRoomKey, session?.phase])
  useEffect(() => {
    if (!joinUrl) return
    console.info('diagnostic joinUrl', { qr: joinUrl, copy: joinUrl, manual: joinUrl })
    void QRCode.toDataURL(joinUrl, { margin: 0, width: 216, color: { dark: '#03120e', light: '#eef5ee' } }).then(setQr)
  }, [joinUrl])
  useEffect(() => { localStorage.setItem('atmosphere-public-origin', publicOrigin) }, [publicOrigin])
  useEffect(() => {
    if (!firebaseReady) {
      const localArchives = JSON.parse(localStorage.getItem('atmosphere-archives') || '{}') as Record<string, SessionArchive>
      setArchives(localArchives)
      return
    }
    let unsubscribe: () => void = () => undefined
    void ensureAuth().then(() => {
      unsubscribe = subscribeSessionArchives(leader.workspaceId, value => setArchives(value))
    }).catch(() => undefined)
    return () => unsubscribe()
  }, [leader.uid, leader.workspaceId])
  useEffect(() => {
    if (!firebaseReady) return
    return subscribeWorkspace(leader.workspaceId, setWorkspace, () => setWorkspace(null))
  }, [leader.workspaceId])
  useEffect(() => {
    setRoomDetails(previous => ({
      ...previous,
      groupName: previous.groupName || workspace?.name || '',
      city: previous.city || workspace?.city || '',
    }))
  }, [workspace?.city, workspace?.name])
  useEffect(() => { localStorage.setItem(feedbackFormKey, feedbackFormUrl.trim()) }, [feedbackFormKey, feedbackFormUrl])
  useEffect(() => {
    if (!firebaseReady || !session || session.hostUid !== leader.uid) return
    void updateSessionPilotCounts(session.roomId, session.hostUid).catch(error => console.warn('pilot counts were not updated', error))
  }, [firebaseReady, leader.uid, session?.roomId, session?.hostUid, participants.length, finished])
  useEffect(() => {
    if (!firebaseReady) {
      const stored = JSON.parse(localStorage.getItem(`atmosphere-question-bank-${leader.workspaceId}`) || 'null') as Question[] | null
      setQuestionBank(stored?.length ? stored : questions)
      return
    }
    let stopSystem: () => void = () => undefined
    let stopWorkspace: () => void = () => undefined
    void ensureAuth().then(() => {
      setSystemPacksState('loading')
      stopSystem = subscribePublishedGlobalPacks(value => {
        setSystemPacks(value)
        setSystemPacksError('')
        setSystemPacksState('ready')
      }, error => {
        setSystemPacks({})
        setSystemPacksError(error.message || 'Не удалось загрузить опубликованные наборы.')
        setSystemPacksState('error')
      })
      stopWorkspace = subscribeWorkspacePack(leader.workspaceId, diagnosticPackId, setWorkspacePack, () => setWorkspacePack(null))
    }).catch(() => {
      setSystemPacks({})
      setSystemPacksState('error')
      setSystemPacksError('Не удалось подтвердить доступ к библиотеке наборов.')
      setWorkspacePack(null)
    })
    return () => { stopSystem(); stopWorkspace() }
  }, [leader.workspaceId])
  useEffect(() => {
    const selected = templateSelection.templateSource === 'workspace' ? workspacePack : systemPacks[templateSelection.selectedPackId] || null
    setQuestionBank(selected?.content.questions || (firebaseReady ? [] : questions))
  }, [systemPacks, templateSelection, workspacePack])
  // A stale selection from an earlier build must not make the published
  // catalogue appear empty. Prefer the canonical diagnostic pack, then the
  // first published pack, without ever changing an explicit workspace copy.
  useEffect(() => {
    if (templateSelection.templateSource !== 'system' || systemPacks[templateSelection.selectedPackId]) return
    const fallback = systemPacks[diagnosticPackId] || Object.values(systemPacks).sort((left, right) => left.title.localeCompare(right.title, 'ru'))[0]
    if (fallback) setTemplateSelection({ selectedPackId: fallback.packId, templateSource: 'system' })
  }, [systemPacks, templateSelection])
  useEffect(() => { localStorage.setItem(templateKey, JSON.stringify(templateSelection)) }, [templateKey, templateSelection])
  useEffect(() => {
    document.documentElement.classList.toggle('question-editor-open', questionEditorOpen)
    return () => document.documentElement.classList.remove('question-editor-open')
  }, [questionEditorOpen])
  useEffect(() => { setRoomTitleDraft(session?.phase === 'lobby' ? session.roomTitle || '' : '') }, [room, session?.phase, session?.roomTitle])
  const create = async (title = roomTitleDraft) => {
    setBusy(true); setActionError(''); setCreateError('')
    const newRoom = makeRoom()
    try {
      if (!roomDetails.groupName.trim() || !roomDetails.city.trim()) throw new Error('Подтвердите название молодёжки и город для анализа пилота.')
      if (roomDetails.mode !== 'diagnostic') throw new Error('Викторина пока готовится к запуску. Для пилота выберите диагностику.')
      if (firebaseReady) { if (!questionBank.length) throw new Error('Выбранный набор ещё не загружен или недоступен. Обновите страницу и попробуйте снова.'); const user = await ensureAuth(); if (!user) throw new Error('Не удалось войти в Firebase'); await createSession(newRoom, user.uid, questionBank, leader.workspaceId, templateSelection, title, roomDetails) }
      else setDemo(createSessionRecord(newRoom, 'demo-host', questionBank, leader.workspaceId, undefined, undefined, title, roomDetails))
      localStorage.setItem(roomKey, newRoom); localStorage.setItem(lastRoomKey, newRoom); localStorage.removeItem('atmosphere-host-room'); setLastClosedRoom(''); setResultRoom(''); setRoom(newRoom); navigate('overview', newRoom)
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'Не удалось создать комнату.')
    } finally { setBusy(false) }
  }
  const changePhase = async (next: SessionPhase) => {
    if (!session) return false
    setActionError('')
    try {
      if (firebaseReady) {
        if (next === 'closed') {
          // Closing the live room is the source of truth. Archiving is a
          // separate best-effort operation and must not keep the room live.
          await updatePhase(room, 'closed', session.hostUid)
          const closedSession: Session = { ...session, phase: 'closed', closedAt: Date.now() }
          setSession(closedSession)
          localStorage.removeItem(roomKey)
          localStorage.removeItem('atmosphere-host-room')
          localStorage.setItem(lastRoomKey, room)
          setLastClosedRoom(room)
          try {
            const archived = await archiveSession(closedSession)
            setArchives(prev => ({ ...prev, [room]: archived }))
          } catch (archiveError) {
            const message = archiveError instanceof Error ? archiveError.message : 'Не удалось сохранить архив комнаты.'
            setActionError(`Сессия завершена, но архив пока не сохранён: ${message}`)
          }
          return true
        }
        await updatePhase(room, next, session.hostUid)
      } else {
        const nextSession = { ...session, phase: next, ...(next === 'resultsIntro' ? { resultsIntroStartedAt: Date.now() } : {}), ...(next === 'closed' ? { closedAt: Date.now() } : {}) }
        setDemo(nextSession); setSession(nextSession)
        if (next === 'closed') {
          const archived = { ...nextSession, archivedAt: Date.now() } as SessionArchive
          const localArchives = JSON.parse(localStorage.getItem('atmosphere-archives') || '{}') as Record<string, SessionArchive>
          localStorage.setItem('atmosphere-archives', JSON.stringify({ ...localArchives, [room]: archived }))
          setArchives(prev => ({ ...prev, [room]: archived }))
          localStorage.removeItem(roomKey)
          localStorage.removeItem('atmosphere-host-room')
          localStorage.setItem(lastRoomKey, room)
          setLastClosedRoom(room)
        }
      }
      return true
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Не удалось изменить состояние сессии')
      return false
    }
  }
  const start = async () => {
    await changePhase('live')
  }
  const showResults = async () => {
    if (!session) return
    if (!await changePhase('resultsIntro')) return
    setResultRoom(room)
    navigate('results', room)
    window.setTimeout(() => { void changePhase('resultsReal') }, 20000)
  }
  const closeRoom = () => {
    if (!session || session.phase === 'closed') return
    if (!window.confirm('После завершения участники больше не смогут отвечать в этой комнате. Участники, ответы и результаты будут сохранены в архиве.')) return
    void changePhase('closed')
  }
  const saveRoomTitle = async () => {
    if (!session || session.phase !== 'lobby') return
    setRoomTitleSaving(true); setActionError('')
    try {
      if (firebaseReady) await updateRoomTitle(room, roomTitleDraft, session.hostUid)
      else { const next = { ...session, roomTitle: roomTitleDraft.trim() || defaultRoomTitle(session.createdAt) }; setDemo(next); setSession(next) }
    } catch (error) { setActionError(error instanceof Error ? error.message : 'Не удалось сохранить название комнаты.') } finally { setRoomTitleSaving(false) }
  }
  const openArchivedResult = (archived: SessionArchive | Session) => {
    setRoom(archived.roomId)
    setResultRoom(archived.roomId)
    localStorage.setItem(lastRoomKey, archived.roomId)
    navigate('results', archived.roomId)
  }
  const resultSession = resultRoom === room ? session : archives[resultRoom] || null
  if (tab === 'main') return <HostLayout menu={menu} tab={tab} onTab={navigate} room={room} session={session} participants={participants.length} menuOpen={menuOpen} setMenuOpen={setMenuOpen}><header className="host-header"><div><p className="eyebrow">РАБОЧЕЕ ПРОСТРАНСТВО</p><h1>Главное</h1></div><span className={`status ${firebaseReady ? '' : 'demo'}`}>{firebaseReady ? 'ЭФИР АКТИВЕН' : 'ДЕМО-РЕЖИМ'}</span></header><HomePanel name={leader.fullName} questionCount={questionBank.length} onStart={() => navigate('overview')} /></HostLayout>
  if (tab === 'rules') return <HostLayout menu={menu} tab={tab} onTab={navigate} room={room} session={session} participants={participants.length} menuOpen={menuOpen} setMenuOpen={setMenuOpen}><header className="host-header"><div><p className="eyebrow">ПОДСКАЗКИ ДЛЯ ВЕДУЩЕГО</p><h1>Правила</h1></div><span className={`status ${firebaseReady ? '' : 'demo'}`}>{firebaseReady ? 'ЭФИР АКТИВЕН' : 'ДЕМО-РЕЖИМ'}</span></header><RulesPanel onStart={() => navigate('overview')} /></HostLayout>
  if (tab === 'profile') return <HostLayout menu={menu} tab={tab} onTab={navigate} room={room} session={session} participants={participants.length} menuOpen={menuOpen} setMenuOpen={setMenuOpen}><header className="host-header"><div><p className="eyebrow">ВАШ АККАУНТ</p><h1>Профиль</h1></div><span className={`status ${firebaseReady ? '' : 'demo'}`}>{firebaseReady ? 'ЭФИР АКТИВЕН' : 'ДЕМО-РЕЖИМ'}</span></header><ProfilePanel profile={leader} /></HostLayout>
  if (tab === 'results' && resultRoom && resultSession) return <HostLayout menu={menu} tab={tab} onTab={navigate} room={room} session={resultSession} participants={Object.keys(resultSession.participants || {}).length} menuOpen={menuOpen} setMenuOpen={setMenuOpen} resultsMode><header className="host-header host-results-header"><div><p className="eyebrow">РЕЗУЛЬТАТЫ · {resultRoom}</p><h1>Общая картина</h1></div><span className="status">СОХРАНЕНО</span></header><Results room={resultRoom} sessionOverride={resultSession} embedded /></HostLayout>
  const resetQuestionDraft = (category: Question['category'] = 'communication') => {
    const wasEditing = Boolean(editingQuestionId)
    setEditingQuestionId(null)
    setQuestionDraft({ category, title: '', options: ['', '', '', ''] })
    setQuestionError('')
    setQuestionEditorOpen(!wasEditing)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const closeQuestionEditor = () => {
    setEditingQuestionId(null)
    setQuestionDraft({ category: 'communication', title: '', options: ['', '', '', ''] })
    setQuestionError('')
    setQuestionEditorOpen(false)
  }
  const editQuestion = (question: Question) => {
    setEditingQuestionId(question.id)
    setQuestionDraft({ category: question.category, title: question.title, options: [question.options.A, question.options.B, question.options.C, question.options.D] })
    setQuestionError('')
    setQuestionEditorOpen(true)
    navigate('questions')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const persistQuestionBank = async (nextBank: Question[]) => {
    const orderedBank = orderQuestionsByCategory(nextBank)
    setQuestionError('')
    if (firebaseReady) {
      try {
        await saveWorkspacePack(leader.workspaceId, orderedBank)
        setTemplateSelection({ selectedPackId: diagnosticPackId, templateSource: 'workspace' })
      } catch (error) {
        throw new Error(`Не удалось сохранить личную копию вопросника: ${error instanceof Error ? error.message : 'проверьте Firebase Rules'}`)
      }
    } else localStorage.setItem(`atmosphere-question-bank-${leader.workspaceId}`, JSON.stringify(orderedBank))
    setQuestionBank(orderedBank)
  }
  const saveQuestion = async () => {
    if (!questionDraft.title.trim() || questionDraft.options.some(option => !option.trim())) {
      setQuestionError('Заполните текст вопроса и все четыре варианта ответа.')
      return
    }
    setQuestionSaving(true)
    const currentQuestion = editingQuestionId ? questionBank.find(question => question.id === editingQuestionId) : undefined
    const categoryChanged = Boolean(currentQuestion && currentQuestion.category !== questionDraft.category)
    const categoryOrder = currentQuestion && !categoryChanged && currentQuestion.categoryOrder
      ? currentQuestion.categoryOrder
      : nextCategoryQuestionOrder(questionBank, questionDraft.category, editingQuestionId || undefined)
    const nextQuestion: Question = { id: editingQuestionId || `${questionDraft.category}-${Date.now()}`, category: questionDraft.category, categoryOrder, title: questionDraft.title.trim(), options: { A: questionDraft.options[0].trim(), B: questionDraft.options[1].trim(), C: questionDraft.options[2].trim(), D: questionDraft.options[3].trim() } }
    const nextBank = editingQuestionId
      ? categoryChanged
        ? [...questionBank.filter(question => question.id !== editingQuestionId), nextQuestion]
        : questionBank.map(question => question.id === editingQuestionId ? nextQuestion : question)
      : [...questionBank, nextQuestion]
    try {
      await persistQuestionBank(nextBank)
      closeQuestionEditor()
    } catch (error) {
      setQuestionError(error instanceof Error ? error.message : 'Не удалось сохранить вопрос')
    } finally { setQuestionSaving(false) }
  }
  const deleteQuestion = async (question: Question) => {
    if (!window.confirm(`Удалить вопрос «${question.title}»?`)) return
    setQuestionSaving(true)
    try {
      await persistQuestionBank(questionBank.filter(item => item.id !== question.id))
      if (editingQuestionId === question.id) closeQuestionEditor()
    } catch (error) {
      setQuestionError(error instanceof Error ? error.message : 'Не удалось удалить вопрос')
    } finally { setQuestionSaving(false) }
  }
  const warning = !firebaseReady ? 'Для работы с несколькими устройствами подключите Firebase: демо-режим синхронизируется только в этом браузере.' : /localhost|127\.0\.0\.1/.test(publicOrigin) ? 'Этот QR ведёт на адрес компьютера. После публикации сайта здесь будет общий интернет-адрес.' : ''
  const publishedSystemPacks = Object.values(systemPacks).sort((left, right) => left.title.localeCompare(right.title, 'ru'))
  const selectedSystemPack = systemPacks[templateSelection.selectedPackId] || null
  const packSelectionControl = <Glass className="pack-picker">
    <p className="eyebrow">НАБОР ДЛЯ НОВОЙ КОМНАТЫ</p>
    {templateSelection.templateSource === 'workspace' && workspacePack
      ? <><h3>{workspacePack.title}</h3><p>Используется ваша уже созданная личная копия. Глобальные материалы остаются без изменений.</p><Button secondary onClick={() => setTemplateSelection(defaultDiagnosticTemplateSelection)}>Выбрать системный набор</Button></>
      : systemPacksState === 'loading'
        ? <p>Загружаем опубликованные наборы…</p>
        : systemPacksState === 'error'
          ? <><h3>Библиотека недоступна</h3><p>{systemPacksError}</p></>
          : !publishedSystemPacks.length
            ? <><h3>Нет опубликованных наборов</h3><p>Владелец платформы пока не опубликовал материал для запуска.</p></>
            : <><label>Выберите опубликованный набор<select value={templateSelection.selectedPackId} onChange={event => setTemplateSelection({ selectedPackId: event.target.value, templateSource: 'system' })}>{publishedSystemPacks.map(pack => <option key={pack.packId} value={pack.packId}>{pack.title} · {pack.questions.length} вопросов · v{pack.packVersion}</option>)}</select></label>{selectedSystemPack?.questions.length === 0 ? <p className="connection-warning">В выбранном наборе пока нет вопросов. Его нельзя использовать для создания комнаты.</p> : <p>{selectedSystemPack?.description || 'Описание набора пока не заполнено.'}</p>}</>}
  </Glass>
  const roomPilotDetailsControl = <Glass className="room-pilot-details">
    <p className="eyebrow">ДАННЫЕ ВСТРЕЧИ · ПИЛОТ</p>
    <h3>Подтвердите параметры комнаты</h3>
    <p>Эти сведения попадут только в историю и CSV ведущего. Реальные имена участников не собираются.</p>
    <div className="room-pilot-fields">
      <label>Название молодёжки<input value={roomDetails.groupName} onChange={event => setRoomDetails(previous => ({ ...previous, groupName: event.target.value }))} placeholder="Например, Молодёжка «Атмосфера»" maxLength={100} /></label>
      <label>Город<input value={roomDetails.city} onChange={event => setRoomDetails(previous => ({ ...previous, city: event.target.value }))} placeholder="Например, Алматы" maxLength={80} /></label>
      <label>Формат<select value={roomDetails.mode} onChange={event => setRoomDetails(previous => ({ ...previous, mode: event.target.value as RoomMode }))}><option value="diagnostic">Диагностика</option><option value="quiz" disabled>Викторина · скоро</option></select></label>
      <label>Предполагаемое число участников<input type="number" min="1" max="30" value={roomDetails.estimatedParticipants} onChange={event => setRoomDetails(previous => ({ ...previous, estimatedParticipants: Math.max(1, Math.min(30, Number(event.target.value) || 1)) }))} /></label>
    </div>
  </Glass>
  const feedbackUrl = createFeedbackUrl(feedbackFormUrl, session)
  const historyFiltersControl = <Glass className="history-filters"><p className="eyebrow">ФИЛЬТРЫ ИСТОРИИ</p><div><input value={historyFilters.query} onChange={event => setHistoryFilters(previous => ({ ...previous, query: event.target.value }))} placeholder="Комната, молодёжка, город или код" /><select value={historyFilters.mode} onChange={event => setHistoryFilters(previous => ({ ...previous, mode: event.target.value as 'all' | RoomMode }))}><option value="all">Все форматы</option><option value="diagnostic">Диагностика</option><option value="quiz">Викторина</option></select><label>С<input type="date" value={historyFilters.from} onChange={event => setHistoryFilters(previous => ({ ...previous, from: event.target.value }))} /></label><label>По<input type="date" value={historyFilters.to} onChange={event => setHistoryFilters(previous => ({ ...previous, to: event.target.value }))} /></label></div></Glass>
  if (!session && tab === 'rooms') return <HostLayout menu={menu} tab={tab} onTab={navigate} room={lastClosedRoom} session={null} participants={0} menuOpen={menuOpen} setMenuOpen={setMenuOpen}>
    <header className="host-header"><div><p className="eyebrow">БИБЛИОТЕКА ВСТРЕЧ</p><h1>Комнаты</h1></div><span className={`status ${firebaseReady ? '' : 'demo'}`}>{firebaseReady ? 'ЭФИР АКТИВЕН' : 'ДЕМО-РЕЖИМ'}</span></header>
    <div className="stack"><Glass className="empty-state"><h3>Нет активной комнаты</h3><p>Создайте новую комнату в разделе «Обзор». Завершённые встречи остаются в результатах и истории.</p><Button onClick={() => navigate('overview')}>Создать комнату</Button><Button secondary onClick={() => navigate('results')}>Открыть результаты</Button></Glass></div>
  </HostLayout>
  if (!session && tab === 'export') return <HostLayout menu={menu} tab={tab} onTab={navigate} room={lastClosedRoom} session={null} participants={0} menuOpen={menuOpen} setMenuOpen={setMenuOpen}>
    <header className="host-header"><div><p className="eyebrow">ВЫГРУЗКА ДАННЫХ</p><h1>Экспорт</h1></div><span className={`status ${firebaseReady ? '' : 'demo'}`}>{firebaseReady ? 'ЭФИР АКТИВЕН' : 'ДЕМО-РЕЖИМ'}</span></header>
    <Glass className="empty-state"><h3>Выберите завершённую комнату</h3><p>Экспорт доступен в библиотеке результатов и в истории комнат. Данные активной комнаты не удаляются.</p><Button onClick={() => navigate('results')}>Открыть результаты</Button></Glass>
  </HostLayout>
  if (!session && tab === 'settings') return <HostLayout menu={menu} tab={tab} onTab={navigate} room={lastClosedRoom} session={null} participants={0} menuOpen={menuOpen} setMenuOpen={setMenuOpen}>
    <header className="host-header"><div><p className="eyebrow">НАСТРОЙКИ</p><h1>Настройки</h1></div><span className={`status ${firebaseReady ? '' : 'demo'}`}>{firebaseReady ? 'ЭФИР АКТИВЕН' : 'ДЕМО-РЕЖИМ'}</span></header>
    <div className="stack"><Glass className="settings-panel"><p className="eyebrow">ПОДКЛЮЧЕНИЕ УЧАСТНИКОВ</p><h2>Адрес для участников</h2><p>Настройка применяется к QR-коду и скопированной ссылке для будущих комнат.</p><input value={publicOrigin} onChange={event => setPublicOrigin(event.target.value)} placeholder="https://ваш-сайт.web.app" /></Glass><Glass className="settings-panel"><p className="eyebrow">ОБРАТНАЯ СВЯЗЬ</p><h2>Google Form</h2><p>Ссылка будет добавлена к завершённой комнате вместе с её идентификаторами.</p><input value={feedbackFormUrl} onChange={event => setFeedbackFormUrl(event.target.value)} placeholder="https://docs.google.com/forms/d/e/.../viewform" /></Glass></div>
  </HostLayout>
  if (!session && (tab === 'overview' || tab === 'currentRoom')) return <HostLayout menu={menu} tab={tab} onTab={navigate} room={lastClosedRoom} session={null} participants={0} menuOpen={menuOpen} setMenuOpen={setMenuOpen}>
    <header className="host-header"><div><p className="eyebrow">{lastClosedRoom ? `ЗАВЕРШЁННАЯ КОМНАТА · ${lastClosedRoom}` : 'ВЕДУЩИЙ · НОВАЯ ВСТРЕЧА'}</p><h1>{lastClosedRoom ? 'Комната завершена' : 'Диагностика атмосферы'}</h1></div><span className={`status ${firebaseReady ? '' : 'demo'}`}>{lastClosedRoom ? 'СОХРАНЕНО' : firebaseReady ? 'ЭФИР АКТИВЕН' : 'ДЕМО-РЕЖИМ'}</span></header>
    <Glass className="start-panel"><p className="eyebrow">{lastClosedRoom ? 'ВСТРЕЧА СОХРАНЕНА' : 'НОВАЯ ДИАГНОСТИКА'}</p><h2>{lastClosedRoom ? 'Эта диагностика завершена' : 'Готовы начать?'}</h2><p>{lastClosedRoom ? 'Участники и ответы сохранены. Чтобы провести новую диагностику или викторину, создайте новую комнату.' : 'Создайте комнату, покажите QR-код участникам и начните, когда все подключатся.'}</p>{roomPilotDetailsControl}{packSelectionControl}<label className="room-title-input">Название комнаты<input value={roomTitleDraft} onChange={event => setRoomTitleDraft(event.target.value)} placeholder={defaultRoomTitle()} maxLength={80} /></label><div className="control-actions"><Button disabled={busy || systemPacksState === 'loading' || (templateSelection.templateSource === 'system' && (!selectedSystemPack || selectedSystemPack.questions.length === 0))} onClick={() => void create()}>{busy ? 'Создаём…' : 'Создать новую комнату'}</Button>{lastClosedRoom && <Button secondary onClick={() => navigate('results')}>Посмотреть старые результаты</Button>}{lastClosedRoom && <Button secondary onClick={() => navigate('export')}>Открыть экспорт</Button>}</div>{createError && <p className="connection-warning">{createError}</p>}{actionError && <p className="connection-warning">{actionError}</p>}</Glass>
  </HostLayout>
  if (!session && tab === 'results') return <HostLayout menu={menu} tab={tab} onTab={navigate} room={lastClosedRoom} session={null} participants={0} menuOpen={menuOpen} setMenuOpen={setMenuOpen}>
    <header className="host-header"><div><p className="eyebrow">БИБЛИОТЕКА РЕЗУЛЬТАТОВ</p><h1>Результаты</h1></div><span className={`status ${firebaseReady ? '' : 'demo'}`}>{firebaseReady ? 'ЭФИР АКТИВЕН' : 'ДЕМО-РЕЖИМ'}</span></header>
    <Glass className="empty-state"><h3>{archiveEntries.length ? `Сохранено завершённых комнат: ${archiveEntries.length}` : 'Завершённых комнат пока нет'}</h3><p>{archiveEntries.length ? 'Откройте раздел «Комнаты», чтобы выбрать встречу и посмотреть её результаты или экспорт.' : 'После завершения первой комнаты её результаты останутся здесь и будут доступны после обновления страницы.'}</p><Button onClick={() => navigate('rooms')}>Открыть историю комнат</Button></Glass>
  </HostLayout>
  if (!session && tab === 'questions') return <HostLayout menu={menu} tab={tab} onTab={navigate} room={lastClosedRoom} session={null} participants={0} menuOpen={menuOpen} setMenuOpen={setMenuOpen}>
    <header className="host-header"><div><p className="eyebrow">МАТЕРИАЛЫ ДИАГНОСТИКИ</p><h1>Вопросы</h1></div><span className={`status ${firebaseReady ? '' : 'demo'}`}>{firebaseReady ? 'ЭФИР АКТИВЕН' : 'ДЕМО-РЕЖИМ'}</span></header>
    <Glass className="empty-state"><h3>{questionBank.length ? `Доступно вопросов: ${questionBank.length}` : 'Вопросник пока недоступен'}</h3><p>{questionBank.length ? 'Создайте комнату в разделе «Обзор», чтобы использовать выбранный набор. Личные изменения сохраняются в рабочем пространстве ведущего.' : 'Владелец платформы должен добавить и опубликовать системный набор в глобальной библиотеке.'}</p><Button onClick={() => navigate('overview')}>Перейти к созданию комнаты</Button></Glass>
  </HostLayout>
  if (!session) return <HostLayout menu={menu} tab={tab} onTab={navigate} room={lastClosedRoom} session={null} participants={0} menuOpen={menuOpen} setMenuOpen={setMenuOpen}><Glass className="empty-state"><h3>Нет активной комнаты</h3><Button onClick={() => navigate('overview')}>Перейти в обзор</Button></Glass></HostLayout>
  return <HostLayout menu={menu} tab={tab} onTab={navigate} room={room} session={session} participants={participants.length} menuOpen={menuOpen} setMenuOpen={setMenuOpen}>
    <header className="host-header"><div><p className="eyebrow">{session ? `СЕССИЯ · ${session.displayCode || room}` : 'РАБОЧЕЕ ПРОСТРАНСТВО'}</p><h1>{tab === 'overview' ? 'Обзор' : tab === 'currentRoom' ? 'Управление сессией' : menu.find(item => item[0] === tab)?.[1]}</h1>{session && <p className="room-header-title">{session.roomTitle || `Комната ${room}`}</p>}</div><span className={`status ${firebaseReady ? '' : 'demo'}`}>{firebaseReady ? 'ЭФИР АКТИВЕН' : 'ДЕМО-РЕЖИМ'}</span></header>
    {(tab === 'overview' || tab === 'currentRoom') && (session.phase === 'closed' ? <Glass className="closed-room-panel"><p className="eyebrow">КОМНАТА ЗАВЕРШЕНА</p><h2>Эта диагностика завершена</h2><p>Участники и ответы сохранены. Чтобы провести новую диагностику или викторину, создайте новую комнату.</p><label className="room-title-input">Название новой комнаты<input value={roomTitleDraft} onChange={event => setRoomTitleDraft(event.target.value)} placeholder={defaultRoomTitle()} maxLength={80} /></label><div className="control-actions"><Button disabled={busy} onClick={() => void create()}>{busy ? 'Создаём…' : 'Создать новую комнату'}</Button><Button secondary onClick={() => openArchivedResult(session)}>Посмотреть старые результаты</Button><Button secondary onClick={() => navigate('results')}>Библиотека результатов</Button><Button secondary onClick={() => navigate('export')}>Открыть экспорт</Button>{feedbackUrl && <Button secondary onClick={() => window.open(feedbackUrl, '_blank', 'noopener,noreferrer')}>Оставить обратную связь</Button>}</div>{!feedbackUrl && <p className="connection-warning">Добавьте ссылку на Google Form в настройках, чтобы после встречи собирать обратную связь.</p>}{actionError && <p className="connection-warning">{actionError}</p>}</Glass> : <><div className="metrics"><Metric label="Подключились" value={participants.length} note={`из ${session.maxParticipants} участников`} /><Metric label="Сейчас отвечают" value={answering} note="в своём темпе" /><Metric label="Завершили" value={finished} note={allFinished ? 'все готовы' : 'ждём завершения'} /></div><div className="overview-grid"><Glass className="control-panel"><p className="eyebrow">ТЕКУЩАЯ ФАЗА</p><h2>{phaseText(session.phase)}</h2><p>{session.phase === 'lobby' ? 'Покажите QR-код. После запуска у вас автоматически откроется отдельный экран с живым прогрессом.' : allFinished ? 'Все участники завершили ответы. Можно открыть общую визуализацию на большом экране.' : 'Экран прогресса обновляется в реальном времени — без личных ответов и имён.'}</p>{session.phase === 'lobby' && <div className="room-title-editor"><label className="room-title-input">Название комнаты<input value={roomTitleDraft} onChange={event => setRoomTitleDraft(event.target.value)} placeholder={defaultRoomTitle(session.createdAt)} maxLength={80} /></label><div><Button secondary disabled={roomTitleSaving || roomTitleDraft.trim() === (session.roomTitle || '')} onClick={() => void saveRoomTitle()}>{roomTitleSaving ? 'Сохраняем…' : 'Сохранить название'}</Button><Button secondary onClick={() => void navigator.clipboard.writeText(session.displayCode || room).catch(error => setActionError(error instanceof Error ? error.message : 'Не удалось скопировать код'))}>Скопировать код {session.displayCode || room}</Button></div><small>После запуска диагностики название будет заблокировано.</small></div>}<div className="control-actions">{session.phase === 'lobby' && <Button disabled={!participants.length} onClick={start}>Запустить диагностику</Button>}{session.phase !== 'lobby' && <Button secondary onClick={() => window.open(hostUrl(`/stage?room=${room}`), 'atmosphere-stage')}>Открыть экран прогресса</Button>}<Button onClick={showResults} disabled={!allFinished || session.phase === 'resultsIntro' || session.phase === 'resultsReal'}>Показать общие результаты</Button><Button secondary onClick={closeRoom}>Завершить комнату</Button></div><div className="results-lock"><span className={allFinished ? 'ready' : ''}>{allFinished ? '✓' : '⌕'}</span><div><b>{allFinished ? 'Общий результат готов' : 'Общий результат пока закрыт'}</b><small>{allFinished ? 'Нажмите кнопку выше, чтобы начать показ.' : `Завершили ${finished} из ${participants.length || '—'} участников.`}</small></div></div><div className="phase-track">{(['lobby', 'live', 'resultsIntro', 'resultsReal'] as SessionPhase[]).map(item => <span className={session.phase === item ? 'active' : ''} key={item}>{phaseText(item)}</span>)}</div></Glass><Glass className="qr-panel"><p className="eyebrow">ПОДКЛЮЧЕНИЕ УЧАСТНИКОВ</p>{qr && <img src={qr} alt="QR-код для подключения" className="qr" />}<code>{joinUrl}</code><Button secondary onClick={() => void navigator.clipboard.writeText(joinUrl).catch(error => setActionError(error instanceof Error ? error.message : 'Не удалось скопировать ссылку'))}>Скопировать ссылку</Button>{warning && <p className="connection-warning">{warning}</p>}</Glass></div><Glass className="participants-panel"><div className="participants-panel-header"><div><p className="eyebrow">УЧАСТНИКИ В КОМНАТЕ</p><h3>{participants.length ? `${participants.length} подключились` : 'Пока никто не подключился'}</h3></div><span>{session.displayCode || room}</span></div>{participants.length ? <ul className="participant-list">{participants.sort((a, b) => a.joinedAt - b.joinedAt).map(person => <li key={person.id}><span className={`participant-status ${person.status}`} /><div><b>{person.nickname}</b><small>{person.status === 'waiting' ? 'Ожидает' : person.status === 'answering' ? 'Отвечает' : 'Завершил'}</small></div></li>)}</ul> : <p className="participants-empty">Пока никто не подключился. Отправьте участникам QR-код или ссылку для подключения.</p>}</Glass></>) }
    {tab === 'rooms' && <div className="stack"><Glass className="room-row"><div><p className="eyebrow">{session.phase === 'closed' ? 'ЗАВЕРШЁННАЯ' : 'ТЕКУЩАЯ'}</p><h2>{session.roomTitle || `Комната ${room}`}</h2><p>Код {session.displayCode || room} · {phaseText(session.phase)} · {participants.length} подключились · {finished} завершили</p></div><Button disabled={busy} onClick={() => void create('')}>{busy ? 'Создаём…' : 'Создать новую комнату'}</Button></Glass>{actionError && <p className="connection-warning">{actionError}</p>}{historyFiltersControl}<div className="archive-list">{filteredArchiveEntries.map(archived => <Glass className="archive-card" key={archived.roomId}><div><p className="eyebrow">АРХИВ · {new Date(archived.archivedAt).toLocaleDateString('ru-RU')}</p><h3>{archived.roomTitle || `Комната ${archived.displayCode || archived.roomId}`}</h3><p>{archived.groupName || 'Молодёжка не указана'} · {archived.city || 'Город не указан'} · {archived.mode === 'quiz' ? 'Викторина' : 'Диагностика'}</p><p>Код {archived.displayCode || archived.roomId} · {archived.participantCount ?? Object.keys(archived.participants || {}).length} участников · {archived.completedCount ?? Object.values(archived.participants || {}).filter(person => person.status === 'finished').length} завершили</p></div><div className="archive-actions"><Button secondary onClick={() => openArchivedResult(archived)}>Открыть результаты</Button><Button secondary onClick={() => exportCsv(archived, leader)}>Экспортировать CSV</Button></div></Glass>)}</div>{!archiveEntries.length && <Glass className="empty-state"><h3>История комнат пока пуста</h3><p>После завершения комнаты она появится здесь вместе с ответами участников.</p></Glass>}{archiveEntries.length > 0 && !filteredArchiveEntries.length && <Glass className="empty-state"><h3>По фильтрам ничего не найдено</h3><p>Сбросьте поиск, формат или диапазон дат.</p></Glass>}</div>}
    {tab === 'results' && !resultRoom && <div className="results-library"><div className="results-library-intro"><p className="eyebrow">БИБЛИОТЕКА РЕЗУЛЬТАТОВ</p><h2>Завершённые встречи</h2><p>Выберите комнату, чтобы посмотреть общую картину или выгрузить ответы. Доступны только результаты вашей молодёжной группы.</p></div>{historyFiltersControl}<div className="archive-list">{filteredArchiveEntries.map(archived => <Glass className="archive-card results-library-card" key={archived.roomId}><div><p className="eyebrow">{archived.mode === 'quiz' ? 'ВИКТОРИНА' : 'ДИАГНОСТИКА'} · {new Date(archived.createdAt).toLocaleDateString('ru-RU')}</p><h3>{archived.roomTitle || `Комната ${archived.roomId}`}</h3><p>{archived.groupName || 'Молодёжка не указана'} · {archived.city || 'Город не указан'}</p><p>Завершена: {archived.closedAt ? new Date(archived.closedAt).toLocaleString('ru-RU') : 'дата не указана'} · {archived.participantCount ?? Object.keys(archived.participants || {}).length} участников · {archived.completedCount ?? Object.values(archived.participants || {}).filter(person => person.status === 'finished').length} завершили</p></div><div className="archive-actions"><Button onClick={() => openArchivedResult(archived)}>Открыть результаты</Button><Button secondary onClick={() => exportCsv(archived, leader)}>Экспортировать CSV</Button></div></Glass>)}</div>{!archiveEntries.length && <Glass className="empty-state"><h3>Библиотека пока пуста</h3><p>Завершите первую комнату — её результаты и экспорт останутся здесь после обновления и повторного входа.</p></Glass>}{archiveEntries.length > 0 && !filteredArchiveEntries.length && <Glass className="empty-state"><h3>По фильтрам ничего не найдено</h3><p>Сбросьте поиск, формат или диапазон дат.</p></Glass>}</div>}
    {tab === 'questions' && <div className="question-admin"><Glass className="question-editor"><p className="eyebrow">{editingQuestionId ? 'РЕДАКТИРОВАНИЕ' : 'НОВЫЙ ВОПРОС'}</p><h3>{editingQuestionId ? 'Изменить вопрос' : 'Добавить вопрос в банк'}</h3><select value={questionDraft.category} onChange={event => setQuestionDraft(prev => ({ ...prev, category: event.target.value as Question['category'] }))}>{Object.entries(categories).map(([id, title]) => <option value={id} key={id}>{title}</option>)}</select><input value={questionDraft.title} onChange={event => setQuestionDraft(prev => ({ ...prev, title: event.target.value }))} placeholder="Текст вопроса" />{questionDraft.options.map((option, index) => <input key={index} value={option} onChange={event => setQuestionDraft(prev => ({ ...prev, options: prev.options.map((item, itemIndex) => itemIndex === index ? event.target.value : item) }))} placeholder={`Вариант ${String.fromCharCode(65 + index)}`} />)}<div className="question-editor-actions"><Button disabled={questionSaving} onClick={() => void saveQuestion()}>{questionSaving ? 'Сохраняем…' : editingQuestionId ? 'Сохранить изменения' : 'Добавить вопрос'}</Button>{editingQuestionId && <Button secondary onClick={() => resetQuestionDraft()}>Отмена</Button>}</div>{questionError && <p className="connection-warning">{questionError}</p>}</Glass><div className="question-admin-list">{Object.entries(categories).map(([id, title]) => { const categoryId = id as Question['category']; const categoryQuestions = questionBank.filter(question => question.category === categoryId); return <Glass key={id} className="question-group"><div className="question-group-header"><div><p className="eyebrow">{categoryQuestions.length} ВОПРОСОВ</p><h3>{title}</h3></div><Button secondary onClick={() => resetQuestionDraft(categoryId)}>Добавить</Button></div>{categoryQuestions.map((question, index) => <div className="question-row" key={question.id}><span>{index + 1}</span><div className="question-row-content"><b>{question.title}</b><small>{question.options.A} · {question.options.B} · {question.options.C} · {question.options.D}</small></div><div className="question-row-actions"><button type="button" onClick={() => editQuestion(question)}>Редактировать</button><button type="button" onClick={() => void deleteQuestion(question)}>Удалить</button></div></div>)}</Glass> })}</div></div>}
    {tab === 'export' && <div className="stack"><Glass className="export-panel"><p className="eyebrow">ВЫГРУЗКА ДАННЫХ</p><h2>Результаты сессии {room}</h2><p>CSV содержит сведения для анализа пилота: ведущий, молодёжка, город, формат, даты и агрегированные показатели комнаты. Личные ответы участников в общий экран не попадают.</p><Button onClick={() => exportCsv(session, leader)}>Скачать CSV</Button></Glass></div>}
    {tab === 'settings' && <div className="stack"><Glass className="settings-panel"><p className="eyebrow">ПОДКЛЮЧЕНИЕ ПО QR</p><h2>Адрес для участников</h2><p>Один и тот же адрес используется в QR-коде, под ним и в кнопке копирования. Для GitHub Pages базовый путь добавляется ровно один раз.</p><input value={publicOrigin} onChange={event => setPublicOrigin(event.target.value)} placeholder="https://ваш-сайт.web.app" /><small>Firebase: {firebaseReady ? 'подключён' : 'не настроен'}</small></Glass><Glass className="settings-panel"><p className="eyebrow">ОБРАТНАЯ СВЯЗЬ ПОСЛЕ ВСТРЕЧИ</p><h2>Google Form</h2><p>Вставьте ссылку на форму. После закрытия комнаты кнопка добавит roomId, workspaceId, groupName и hostUid как query parameters. Для заполнения конкретных полей Google Form используйте её pre-filled URL и подставьте в него маркеры {'{{roomId}}'}, {'{{workspaceId}}'}, {'{{groupName}}'}, {'{{hostUid}}'}.</p><input value={feedbackFormUrl} onChange={event => setFeedbackFormUrl(event.target.value)} placeholder="https://docs.google.com/forms/d/e/.../viewform" />{feedbackFormUrl && !feedbackUrl && <p className="connection-warning">Проверьте адрес Google Form: ссылка должна быть полной, начиная с https://.</p>}</Glass><Glass className="settings-panel"><p className="eyebrow">СЕССИЯ</p><h2>Завершение</h2><p>После завершения участники больше не смогут отвечать. Участники, ответы, результаты и экспорт останутся в архиве.</p><Button secondary disabled={session.phase === 'closed'} onClick={closeRoom}>{session.phase === 'closed' ? 'Комната завершена' : 'Завершить комнату'}</Button>{actionError && <p className="connection-warning">{actionError}</p>}</Glass></div>}
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
