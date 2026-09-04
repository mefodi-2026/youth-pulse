import { useEffect, useMemo, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { categories, questions } from './data/questions'
import { defaultDiagnosticTemplateSelection, defaultRoomTitle, diagnosticPackId, ensureAuth, ensureParticipantRoomData, firebaseReady, isPlatformOwner, joinSession, loginLeader, logoutLeader, markPersonalViewed, quizGameTypeId, registerLeader, saveAnswer, subscribeAuthUser, subscribeGlobalPack, subscribeLeaderProfile, subscribePublishedGlobalPacks, subscribeRoomQuizResults, subscribeSession, subscribeSessionArchives, subscribeWorkspace, subscribeWorkspacePack, subscribeWorkspaceQuizPacks, updateRoomTitle, updateSessionPilotCounts, type RoomPilotDetails } from './repositories/firebaseRepository'
import { getGameModule } from './lib/gameRegistry'
import { resolveSessionScoring } from './lib/scoring'
import { downloadWishPng, printWish } from './lib/export'
import { StageDashboard } from './StageDashboard'
import { MobileParticipantFlow } from './MobileParticipantFlow'
import { type Answer, type ContentPack, type DiagnosticQuestion, type LeaderProfile, type Participant, type Question, type RoomMode, type Scores, type ScoringTemplateId, type Session, type SessionArchive, type SessionPhase, type TemplateSelection, type Workspace } from './types'
import { appBasePath as getAppBasePath, createJoinUrl } from './lib/urls'
import { orderQuestionsByCategory } from './lib/questionOrder'
import { OwnerAdmin } from './OwnerAdmin'
import { diagnosticMode, isDiagnosticPack } from './modes/diagnostic/contract'
import { isQuizPack, quizMode, workspaceQuizSelection } from './modes/quiz/contract'
import { getModeDefinition, getRoomModeTitle, getRoomResultsLabel, getRoomStatusDescription, getRoomStatusText, modeRegistry, productionModes } from './modes/modeRegistry'
import { createWheelRoom, stopWheelActivity } from './modes/wheel/repository'
import { changeRoomPhase, closeRoomAndArchive, createRoom } from './core/useCases/roomLifecycle'
import { copyQuizWorkspacePack } from './core/useCases/packOperations'
import { resolveResultSession, selectWorkspaceArchives } from './core/useCases/archiveResults'
import { getDemoSession as getDemo, setDemoSession as setDemo } from './core/demoSessionStore'
import { currentPath, go, queryRoom, replace, useRoute } from './core/navigation'
import { useRoom } from './core/hooks/useRoom'
import { useSessionLifecycle } from './core/hooks/useSessionLifecycle'
import { isSessionExpired } from './core/sessionLifecycle'
import { Modal } from './components/Modal'
import { Button, Icon, PageHeader, StatusBadge, Surface as Glass } from './components/DesignSystem'

const makeRoom = () => Math.random().toString(36).slice(2, 8).toUpperCase()

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

/** Compatibility copy for routes retained from pre-registry releases. */
const phaseText = (phase: SessionPhase) => ({ lobby: 'Сбор участников', live: 'Встреча идёт', personal: 'Личные результаты', resultsIntro: 'Готовим результаты', resultsReal: 'Результаты открыты', closed: 'Сессия завершена' })[phase]

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
        <p className="landing-lead">Пространство для бережных форматов «Проверь себя», викторин и интерактивных встреч молодёжных групп.</p>
        <div className="landing-actions"><Button onClick={() => go('/login')}>Войти</Button><Button secondary onClick={() => go('/register')}>Создать аккаунт</Button></div>
      </section>
      <Glass className="landing-visual">
        <div className="landing-visual-glow" />
        <p className="eyebrow">АТМОСФЕРА</p>
        <h2>Встречи, в которых слышен каждый.</h2>
        <div className="landing-feature-list">
          <article><span>01</span><div><b>Проверь себя</b><small>Соберите честную картину встречи без сравнения участников.</small></div></article>
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

const packLibraryErrorText = (error: unknown) => {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''
  if (code === 'PERMISSION_DENIED' || /permission_denied/i.test(error instanceof Error ? error.message : '')) {
    return 'Firebase Rules сейчас блокируют доступ к опубликованным наборам. Владельцу нужно опубликовать актуальный firebase-rules.json в Realtime Database → Rules.'
  }
  return error instanceof Error && error.message
    ? error.message
    : 'Не удалось загрузить опубликованные наборы.'
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
  return <main className="auth-page"><div className="orb orb-a" /><div className="orb orb-b" /><Glass className="auth-card"><p className="eyebrow">ПАНЕЛЬ ВЕДУЩЕГО</p><h1>{register ? 'Создать аккаунт' : 'Войти в аккаунт'}</h1><p>{register ? 'Создайте отдельный аккаунт для вашей молодёжки. Пароль хранится только в Firebase Authentication.' : 'Войдите, чтобы управлять комнатами и вопросами своей молодёжки.'}</p><form className="auth-form" onSubmit={event => void submit(event)}>{register && <><label>Имя и фамилия<input value={fullName} onChange={event => setFullName(event.target.value)} autoComplete="name" /></label><label>Телефон<input value={phone} onChange={event => setPhone(event.target.value)} autoComplete="tel" inputMode="tel" /></label><label>Название молодёжки<input value={workspaceName} onChange={event => setWorkspaceName(event.target.value)} /></label><label>Город<input value={city} onChange={event => setCity(event.target.value)} autoComplete="address-level2" /></label></>}<label>Email<input value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" inputMode="email" type="email" required /></label><label>Пароль<input value={password} onChange={event => setPassword(event.target.value)} autoComplete={register ? 'new-password' : 'current-password'} type="password" minLength={6} required /></label>{register && <label>Код приглашения <small>необязательно</small><input value={inviteCode} onChange={event => setInviteCode(event.target.value.toUpperCase())} /></label>}<Button disabled={busy}>{busy ? 'Подождите…' : register ? 'Зарегистрироваться' : 'Войти'}</Button></form>{error && <p className="auth-error">{error}</p>}<div className="auth-switch">{register ? <>Уже есть аккаунт? <button type="button" onClick={() => go('/login')}>Войти</button></> : <>Нет аккаунта? <button type="button" onClick={() => go('/register')}>Зарегистрироваться</button></>}</div><div className="auth-switch">Нужна панель владельца? <button type="button" onClick={() => go('/owner-login')}>Вход владельца</button></div></Glass></main>
}

function AccountPage({ profile }: { profile: LeaderProfile }) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  useEffect(() => subscribeWorkspace(profile.workspaceId, setWorkspace), [profile.workspaceId])
  const labels = { pending: 'Ожидает активации', active: 'Активен', paused: 'Приостановлен', revoked: 'Доступ отозван' }
  return <main className="auth-page"><Glass className="auth-card account-card"><p className="eyebrow">АККАУНТ ВЕДУЩЕГО</p><h1>{profile.fullName}</h1><p className={`account-status ${profile.status}`}>{labels[profile.status]}</p><dl><div><dt>Молодёжка</dt><dd>{workspace?.name || profile.workspaceId}</dd></div>{workspace?.city && <div><dt>Город</dt><dd>{workspace.city}</dd></div>}<div><dt>Email</dt><dd>{profile.email}</dd></div><div><dt>Телефон</dt><dd>{profile.phone}</dd></div></dl>{profile.status === 'pending' && <p>Заявка сохранена. Доступ к панели появится после активации или регистрации по действующей invite-ссылке.</p>}{profile.status === 'paused' && <p>Доступ к панели временно приостановлен.</p>}{profile.status === 'revoked' && <p>Доступ к панели отозван. Обратитесь к администратору.</p>}{profile.status === 'active' && <Button onClick={() => go('/host')}>Открыть панель ведущего</Button>}<Button secondary onClick={() => void logoutLeader().then(() => go('/login'))}>Выйти</Button></Glass></main>
}

function HomePanel({ name, questionCount, onChooseMode, activeSession, onResume, onCloseActive, notice }: { name: string; questionCount: number; onChooseMode: (mode: RoomMode) => void; activeSession: Session | null; onResume: () => void; onCloseActive: () => void; notice?: string }) {
  const modes = productionModes.map(mode => ({ ...mode, mode: mode.mode as RoomMode }))
  const expired = isSessionExpired(activeSession)
  return <div className="home-panel">{notice && <p className="connection-warning">{notice}</p>}{activeSession && <Glass className="home-active-room"><p className="eyebrow">НЕЗАВЕРШЁННАЯ КОМНАТА · {getRoomModeTitle(activeSession).toUpperCase()}</p><h3>{activeSession.roomTitle || activeSession.roomId}</h3><p>Последняя активность: {new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(activeSession.lastActivityAt || activeSession.createdAt))} · {expired ? 'срок активности истёк' : getRoomStatusText(activeSession)}</p><div className="control-actions">{!expired && <Button onClick={onResume}>Вернуться в комнату</Button>}<Button secondary onClick={onCloseActive}>Завершить старую комнату</Button></div>{expired && <small>Просроченную комнату нельзя продолжить. Её можно завершить, а затем открыть результаты и экспорт в истории.</small>}</Glass>}<div className="home-grid"><section className="home-copy"><p className="eyebrow">ГЛАВНОЕ · АТМОСФЕРА</p><h2>Рады видеть вас,<br />{name}</h2><p className="home-lead">«Атмосфера» помогает проводить «Проверь себя», викторины и интерактивные игры для молодёжных групп — бережно, понятно и без лишней подготовки.</p><p className="home-feedback">«Проверь себя», викторина и колесо фортуны доступны как самостоятельные режимы. Протестируйте их и оставьте обратную связь.</p></section><Glass className="home-visual"><div className="landing-visual-glow" /><p className="eyebrow">ДОСТУПНЫЕ РЕЖИМЫ</p><div className="landing-feature-list">{modes.map((mode, index) => <article key={mode.mode}><span>{String(index + 1).padStart(2, '0')}</span><div><b>{mode.title}</b><small>{mode.mode === diagnosticMode ? `${questionCount || '—'} вопросов · ${Object.keys(categories).length} тем · личные и общие результаты` : mode.description}</small><Button onClick={() => onChooseMode(mode.mode)}>{mode.setupScreen ? 'Открыть режим' : 'Создать комнату'}</Button></div></article>)}</div><div className="landing-orbit"><i /><i /><strong>✦</strong></div></Glass></div><section className="home-steps"><p className="eyebrow">КАК НАЧАТЬ</p><div><article><b>1</b><h3>Создайте комнату</h3><p>Выберите режим и настройте встречу.</p></article><article><b>2</b><h3>Запустите формат</h3><p>Подключите участников и начните игру или «Проверь себя».</p></article><article><b>3</b><h3>Подключите участников</h3><p>Покажите QR-код или отправьте одну ссылку участникам.</p></article><article><b>4</b><h3>Посмотрите итоги</h3><p>Откройте результаты и экспорт внутри комнаты или её истории.</p></article></div></section></div>
}

function RulesPanel({ onStart }: { onStart: () => void }) {
  const rules = [
    ['Создать комнату', 'Откройте «Текущую комнату» или выберите режим и создайте комнату. Код комнаты и QR-код появятся автоматически.'],
    ['Запустить «Проверь себя» или игру', 'Когда участники подключатся, запустите «Проверь себя» или викторину из обзора текущей комнаты.'],
    ['Подключить участников', 'Участники сканируют QR-код или открывают ту же ссылку под ним. Оба способа ведут в одну комнату.'],
    ['Завершить комнату', 'Нажмите «Завершить комнату» в обзоре или настройках. После этого новые ответы не принимаются.'],
    ['Посмотреть результаты', 'Откройте вкладку «Результаты» внутри текущей комнаты либо нужную встречу в истории.'],
    ['Экспортировать данные', 'Откройте вкладку «Экспорт» внутри текущей или архивной комнаты.'],
    ['Библиотека встреч', 'После завершения участники, ответы и результаты остаются в библиотеке вашей молодёжной группы.']
  ] as const
  return <div className="rules-panel"><div className="rules-intro"><p className="eyebrow">ПРАВИЛА РАБОТЫ</p><h2>Краткая инструкция ведущего</h2><p>Этот раздел рассчитан на дальнейшее расширение: сюда можно добавлять иллюстрации, подробные сценарии и пошаговые инструкции, не меняя навигацию.</p><Button onClick={onStart}>Перейти к текущей комнате</Button></div><div className="rules-list">{rules.map(([title, description], index) => <Glass className="rule-card" key={title}><span>{String(index + 1).padStart(2, '0')}</span><div><h3>{title}</h3><p>{description}</p></div></Glass>)}</div></div>
}

function ProfilePanel({ profile }: { profile: LeaderProfile }) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  useEffect(() => subscribeWorkspace(profile.workspaceId, setWorkspace), [profile.workspaceId])
  return <div className="stack"><Glass className="profile-panel"><p className="eyebrow">ПРОФИЛЬ ВЕДУЩЕГО</p><h2>{profile.fullName}</h2><p>Ваш профиль и рабочее пространство сохранены отдельно от комнат и результатов.</p><dl><div><dt>Молодёжка</dt><dd>{workspace?.name || profile.workspaceId}</dd></div>{workspace?.city && <div><dt>Город</dt><dd>{workspace.city}</dd></div>}<div><dt>Email</dt><dd>{profile.email}</dd></div><div><dt>Телефон</dt><dd>{profile.phone}</dd></div></dl><Button secondary onClick={() => void logoutLeader().then(() => go('/login'))}>Выйти из аккаунта</Button></Glass></div>
}

/** Legacy tabs remain readable so saved bookmarks keep working. */
type KnownHostTab = 'main' | 'roomSetup' | 'currentRoom' | 'rooms' | 'diagnostic' | 'quiz' | 'wheel' | 'settings' | 'profile' | 'rules' | 'overview' | 'results' | 'questions' | 'export'
// The open string branch keeps old bookmarked tabs harmlessly redirectable
// without letting TypeScript erase their compatibility branches as unreachable.
type HostTab = KnownHostTab | (string & {})
type HostMenuItem = [HostTab, string, string]
type RoomViewTab = 'overview' | 'participants' | 'results' | 'export'
type CanonicalHostTab = Exclude<HostTab, 'overview' | 'results' | 'questions' | 'export'>
const hostTabs: HostTab[] = ['main', 'roomSetup', 'currentRoom', 'rooms', ...productionModes.map(mode => mode.id as HostTab), 'settings', 'profile', 'rules', 'overview', 'results', 'questions', 'export']
const legacyTabRedirect: Record<'overview' | 'results' | 'questions' | 'export', { tab: CanonicalHostTab; roomView?: RoomViewTab }> = {
  overview: { tab: 'currentRoom', roomView: 'overview' },
  results: { tab: 'currentRoom', roomView: 'results' },
  questions: { tab: 'diagnostic' },
  export: { tab: 'currentRoom', roomView: 'export' },
}
const normalizeHostTab = (tab?: HostTab): { tab: CanonicalHostTab; roomView?: RoomViewTab } => {
  if (!tab) return { tab: 'main' }
  if (tab in legacyTabRedirect) return legacyTabRedirect[tab as keyof typeof legacyTabRedirect]
  return { tab: tab as CanonicalHostTab }
}
const readHostTab = (): HostTab | undefined => {
  const value = new URLSearchParams(window.location.search).get('tab')
  return value && hostTabs.includes(value as HostTab) ? value as HostTab : undefined
}
const readRoomView = (): RoomViewTab | undefined => {
  const value = new URLSearchParams(window.location.search).get('view')
  return value === 'overview' || value === 'participants' || value === 'results' || value === 'export' ? value : undefined
}
const readRoomSetupMode = (): RoomMode | undefined => {
  const value = new URLSearchParams(window.location.search).get('mode')
  return value && modeRegistry[value as RoomMode] ? value as RoomMode : undefined
}

function HostLayout({ menu, tab, onTab, room, session, participants, menuOpen, setMenuOpen, children, resultsMode = false }: { menu: HostMenuItem[]; tab: HostTab; onTab: (tab: HostTab) => void; room: string; session: Session | null; participants: number; menuOpen: boolean; setMenuOpen: (value: boolean) => void; children: React.ReactNode; resultsMode?: boolean }) {
  const selectTab = (next: HostTab) => { onTab(next); if (next === 'results' || window.innerWidth < 980) setMenuOpen(false) }
  const canReturnToRoom = Boolean(room && session && session.phase !== 'closed' && tab !== 'overview' && tab !== 'currentRoom')
  return <main data-host-tab={tab} className={`host-shell host-tab-${tab} ${menuOpen ? 'is-menu-open' : 'is-menu-collapsed'} ${resultsMode ? 'results-mode' : ''}`}><button type="button" className="host-menu-toggle" aria-label="Открыть меню" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}><i /><i /><i /></button><div className="host-edge-trigger" onMouseEnter={() => setMenuOpen(true)} />{menuOpen && <button type="button" aria-label="Закрыть меню" className="host-menu-backdrop" onClick={() => setMenuOpen(false)} />}<aside className="host-menu"><div className="brand"><span>✦</span><b>Атмосфера</b><small>панель ведущего</small></div><nav>{menu.map(([id, label, icon]) => <button key={id} className={tab === id ? 'selected' : ''} onClick={() => selectTab(id)}>{tab === 'main' ? <Icon>{icon}</Icon> : <span>{icon}</span>}{label}</button>)}</nav>{room && <div className="menu-room"><small>{session?.phase === 'closed' ? 'ЗАВЕРШЁННАЯ КОМНАТА' : 'ТЕКУЩАЯ КОМНАТА'}</small><b>{session?.roomTitle || room}</b><span>Код {session?.displayCode || room} · {participants} участников</span></div>}</aside><section className="host-content">{canReturnToRoom && <button type="button" className="return-to-room" onClick={() => selectTab('currentRoom')}>← Вернуться к текущей комнате</button>}{children}</section></main>
}

function Host({ leader, initialTab, initialRoom }: { leader: LeaderProfile; initialTab?: HostTab; initialRoom?: string }) {
  const roomKey = `atmosphere-host-room-${leader.uid}`
  const lastRoomKey = `atmosphere-host-last-room-${leader.uid}`
  // A persisted room is only a resume candidate. Reloading must begin at the
  // main menu instead of silently reopening a live room from an old URL.
  const [room, setRoom] = useState(() => localStorage.getItem(roomKey) || '')
  const [session, setSession] = useRoom(room)
  const [qr, setQr] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [createError, setCreateError] = useState('')
  const [lastClosedRoom, setLastClosedRoom] = useState('')
  const [roomConflictMode, setRoomConflictMode] = useState<RoomMode | null>(null)
  const [closeRequest, setCloseRequest] = useState<{ createMode?: RoomMode } | null>(null)
  const tabKey = `atmosphere-host-tab-${leader.uid}`
  const initialRoute = normalizeHostTab(initialTab)
  const initialRouteHandled = useRef(false)
  // Keep the legacy values in the state type while normalizeHostTab() keeps
  // URLs canonical. It lets old bookmarked tabs remain safely redirectable.
  const [tab, setTab] = useState<HostTab>('main')
  const [roomView, setRoomView] = useState<RoomViewTab>('overview')
  const [menuOpen, setMenuOpen] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 1080)
  const [resultRoom, setResultRoom] = useState('')
  const [archives, setArchives] = useState<Record<string, SessionArchive>>({})
  const [questionBank, setQuestionBank] = useState<DiagnosticQuestion[]>(() => firebaseReady ? [] : questions)
  const templateKey = `atmosphere-template-selection-${leader.workspaceId}`
  const [templateSelection, setTemplateSelection] = useState<TemplateSelection>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(templateKey) || 'null') as TemplateSelection | null
      return saved?.selectedPackId && (saved.templateSource === 'system' || saved.templateSource === 'workspace') ? saved : defaultDiagnosticTemplateSelection
    } catch { return defaultDiagnosticTemplateSelection }
  })
  const [systemPacks, setSystemPacks] = useState<Record<string, ContentPack>>({})
  const [systemDiagnosticPack, setSystemDiagnosticPack] = useState<ContentPack | null>(null)
  const [systemPacksState, setSystemPacksState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [systemPacksError, setSystemPacksError] = useState('')
  const [workspacePack, setWorkspacePack] = useState<ContentPack | null>(null)
  const [workspaceQuizPacks, setWorkspaceQuizPacks] = useState<Record<string, ContentPack>>({})
  const [quizPackActions, setQuizPackActions] = useState<Record<string, { state: 'adding' | 'copied' | 'existing' | 'error'; message?: string }>>({})
  const copyingQuizPacksRef = useRef(new Set<string>())
  const [questionEditingNotice, setQuestionEditingNotice] = useState(false)
  const [roomTitleDraft, setRoomTitleDraft] = useState('')
  const [roomTitleSaving, setRoomTitleSaving] = useState(false)
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [roomDetails, setRoomDetails] = useState<RoomPilotDetails>({ groupName: '', city: '', mode: initialTab === 'roomSetup' ? readRoomSetupMode() || 'diagnostic' : 'diagnostic', estimatedParticipants: 30 })
  const [scoringTemplateId, setScoringTemplateId] = useState<ScoringTemplateId>('standard-v1')
  const creatingRoomRef = useRef(false)
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
  const menu: HostMenuItem[] = [['main', 'Главное', '✦'], ['currentRoom', 'Текущая комната', '▣'], ['rooms', 'История комнат', '◫'], ...productionModes.map(mode => [mode.id as HostTab, mode.menuLabel, mode.icon] as HostMenuItem), ['settings', 'Настройки', '⚙'], ['profile', 'Профиль', '◐'], ['rules', 'Правила', '?']]
  const archiveEntries = useMemo(() => selectWorkspaceArchives(archives, leader), [archives, leader])
  const filteredArchiveEntries = useMemo(() => archiveEntries.filter(archived => {
    const query = historyFilters.query.trim().toLocaleLowerCase('ru-RU')
    const haystack = `${archived.roomTitle || ''} ${archived.groupName || ''} ${archived.city || ''} ${archived.displayCode || archived.roomId}`.toLocaleLowerCase('ru-RU')
    const created = new Date(archived.createdAt)
    const from = historyFilters.from ? new Date(`${historyFilters.from}T00:00:00`) : null
    const to = historyFilters.to ? new Date(`${historyFilters.to}T23:59:59`) : null
    return (!query || haystack.includes(query)) && (historyFilters.mode === 'all' || archived.mode === historyFilters.mode) && (!from || created >= from) && (!to || created <= to)
  }), [archiveEntries, historyFilters])
  const navigate = (next: HostTab, targetRoom = room, requestedRoomView?: RoomViewTab, requestedMode?: RoomMode) => {
    const normalized = normalizeHostTab(next)
    const nextView = requestedRoomView || normalized.roomView || (normalized.tab === 'currentRoom' ? 'overview' : undefined)
    setTab(normalized.tab)
    if (nextView) setRoomView(nextView)
    localStorage.setItem(tabKey, normalized.tab)
    if (nextView === 'results') { setResultRoom(targetRoom); setMenuOpen(false) }
    const params = new URLSearchParams({ tab: normalized.tab })
    if (nextView) params.set('view', nextView)
    if (normalized.tab === 'roomSetup' && requestedMode) params.set('mode', requestedMode)
    if (targetRoom) params.set('room', targetRoom)
    go(`/host?${params.toString()}`)
  }

  // The URL is the source of truth for navigation. This prevents an old
  // localStorage value (for example, "profile") from becoming the default
  // after a fresh login or a browser reload.
  useEffect(() => {
    if (!initialRouteHandled.current) {
      initialRouteHandled.current = true
      setTab('main')
      setRoomView('overview')
      setResultRoom('')
      if (currentPath().endsWith('/results') || initialTab !== 'main' || window.location.search) replace('/host?tab=main')
      return
    }
    const normalized = normalizeHostTab(initialTab)
    const requestedView = readRoomView() || normalized.roomView || (normalized.tab === 'currentRoom' ? 'overview' : undefined)
    const requestedMode = normalized.tab === 'roomSetup' ? readRoomSetupMode() : undefined
    setTab(normalized.tab)
    if (requestedView) setRoomView(requestedView)
    if (requestedMode) setRoomDetails(previous => ({ ...previous, mode: requestedMode }))
    if (requestedView === 'results' && initialRoom) setResultRoom(initialRoom)
    const params = new URLSearchParams({ tab: normalized.tab })
    if (requestedView) params.set('view', requestedView)
    if (requestedMode) params.set('mode', requestedMode)
    if (initialRoom) params.set('room', initialRoom)
    const canonicalPath = `/host?${params.toString()}`
    if (currentPath().endsWith('/results') || initialTab !== normalized.tab || window.location.search !== `?${params.toString()}`) replace(canonicalPath)
  }, [initialRoom, initialTab])

  useEffect(() => {
    if (tab === 'currentRoom' && session?.mode === 'wheel') setMenuOpen(false)
  }, [tab, session?.roomId, session?.mode])

  // A closed room is kept in Firebase and its archive, but it must never be
  // restored as the active room for the leader after a reload.
  useEffect(() => {
    if (session?.phase !== 'closed') return
    if (localStorage.getItem(roomKey) === room) localStorage.removeItem(roomKey)
    if (localStorage.getItem('atmosphere-host-room') === room) localStorage.removeItem('atmosphere-host-room')
    localStorage.setItem(lastRoomKey, room)
    setLastClosedRoom(room)
    if (room) setRoom('')
    if (tab !== 'main') navigate('main', '')
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
      const stored = JSON.parse(localStorage.getItem(`atmosphere-question-bank-${leader.workspaceId}`) || 'null') as DiagnosticQuestion[] | null
      setQuestionBank(stored?.length ? stored : questions)
      return
    }
    let stopSystem: () => void = () => undefined
    let stopDiagnostic: () => void = () => undefined
    let stopWorkspace: () => void = () => undefined
    let stopWorkspaceQuiz: () => void = () => undefined
    void ensureAuth().then(() => {
      setSystemPacksState('loading')
      stopSystem = subscribePublishedGlobalPacks(value => {
        setSystemPacks(value)
        setSystemPacksError('')
        setSystemPacksState('ready')
      }, error => {
        setSystemPacks({})
        setSystemPacksError(packLibraryErrorText(error))
        setSystemPacksState('error')
      })
      // The diagnostic pack is a mandatory system material. Keep a direct,
      // published-only subscription as well as the catalogue query so an
      // unrelated catalogue update can never make it look unavailable.
      stopDiagnostic = subscribeGlobalPack(diagnosticPackId, setSystemDiagnosticPack, () => setSystemDiagnosticPack(null))
      stopWorkspace = subscribeWorkspacePack(leader.workspaceId, diagnosticPackId, setWorkspacePack, () => setWorkspacePack(null))
      stopWorkspaceQuiz = subscribeWorkspaceQuizPacks(leader.workspaceId, setWorkspaceQuizPacks, () => setWorkspaceQuizPacks({}))
    }).catch(() => {
      setSystemPacks({})
      setSystemPacksState('error')
      setSystemPacksError('Не удалось подтвердить доступ к библиотеке наборов.')
      setWorkspacePack(null)
      setWorkspaceQuizPacks({})
      setSystemDiagnosticPack(null)
    })
    return () => { stopSystem(); stopDiagnostic(); stopWorkspace(); stopWorkspaceQuiz() }
  }, [leader.workspaceId])
  useEffect(() => {
    // The diagnostic library must never inherit a quiz selection left over
    // from room setup. Quiz has its own pack state; diagnostics use either
    // their explicit workspace copy or the published system diagnostic pack.
    const selected = templateSelection.templateSource === 'workspace' && templateSelection.selectedPackId === diagnosticPackId && workspacePack?.questions.length
      ? workspacePack
      : systemDiagnosticPack || systemPacks[diagnosticPackId] || null
    const selectedQuestions = selected?.questions?.length
      ? selected.questions
      : selected?.content?.questions
    setQuestionBank(selectedQuestions?.length ? orderQuestionsByCategory(selectedQuestions) : (firebaseReady ? [] : questions))
  }, [systemDiagnosticPack, systemPacks, templateSelection, workspacePack])
  // A stale selection from an earlier build must not make the published
  // catalogue appear empty. Prefer the canonical diagnostic pack, then the
  // first published pack, without ever changing an explicit workspace copy.
  useEffect(() => {
    if (templateSelection.templateSource !== 'system' || systemPacks[templateSelection.selectedPackId]) return
    const fallback = systemPacks[diagnosticPackId] || Object.values(systemPacks).sort((left, right) => left.title.localeCompare(right.title, 'ru'))[0]
    if (fallback) setTemplateSelection({ selectedPackId: fallback.packId, templateSource: 'system' })
  }, [systemPacks, templateSelection])
  useEffect(() => {
    if (roomDetails.mode !== 'quiz') return
    const selected = templateSelection.templateSource === 'workspace' ? workspaceQuizPacks[templateSelection.selectedPackId] : systemPacks[templateSelection.selectedPackId]
    if (selected?.mode === 'quiz') return
    const firstCopied = Object.values(workspaceQuizPacks).find(pack => pack.mode === 'quiz')
    if (firstCopied) setTemplateSelection({ selectedPackId: firstCopied.packId, templateSource: 'workspace' })
  }, [roomDetails.mode, systemPacks, templateSelection, workspaceQuizPacks])
  useEffect(() => { localStorage.setItem(templateKey, JSON.stringify(templateSelection)) }, [templateKey, templateSelection])
  useEffect(() => {
    if (tab === 'roomSetup') return
    setRoomTitleDraft(session?.phase === 'lobby' ? session.roomTitle || '' : '')
  }, [room, session?.phase, session?.roomTitle, tab])
  const workspaceModePacks = useMemo(() => ({
    ...workspaceQuizPacks,
    ...(workspacePack ? { [workspacePack.packId]: workspacePack } : {}),
  }), [workspacePack, workspaceQuizPacks])
  const systemModePacks = useMemo(() => ({
    ...systemPacks,
    ...(systemDiagnosticPack ? { [systemDiagnosticPack.packId]: systemDiagnosticPack } : {}),
  }), [systemDiagnosticPack, systemPacks])
  const modePackContext = (mode: RoomMode, selection: TemplateSelection = templateSelection) => ({
    defaultPackId: diagnosticPackId,
    selection,
    systemPacks: systemModePacks,
    workspacePacks: workspaceModePacks,
  })
  const openRoomSetup = (mode: RoomMode = 'diagnostic', forceNewRoom = false) => {
    if (!forceNewRoom && session && session.phase !== 'closed' && !isSessionExpired(session)) {
      setRoomConflictMode(mode)
      return
    }
    setCreateError('')
    setActionError('')
    setRoomTitleDraft('')
    setRoomDetails({
      groupName: workspace?.name || '',
      city: workspace?.city || '',
      mode,
      estimatedParticipants: 30,
    })
    const setupPolicy = getModeDefinition(mode).setupPolicy
    setScoringTemplateId(setupPolicy.defaultScoringTemplateId)
    const selection = setupPolicy.initialSelection(modePackContext(mode))
    if (selection) setTemplateSelection(selection)
    navigate('roomSetup', room, undefined, mode)
  }
  const create = async (title = roomTitleDraft) => {
    if (busy || creatingRoomRef.current) return
    creatingRoomRef.current = true
    setBusy(true); setActionError(''); setCreateError('')
    const newRoom = makeRoom()
    try {
      const detailsForRoom: RoomPilotDetails = {
        ...roomDetails,
        groupName: workspace?.name?.trim() || roomDetails.groupName.trim(),
        city: roomDetails.city.trim() || workspace?.city?.trim() || '',
        mode: roomDetails.mode,
      }
      const selectionForRoom = templateSelection
      const setupPolicy = getModeDefinition(roomDetails.mode).setupPolicy
      const packContext = modePackContext(roomDetails.mode, selectionForRoom)
      setupPolicy.validateSelection(packContext)
      const activePack = setupPolicy.resolvePack(packContext)
      if (!activePack && systemPacksState === 'error') throw new Error(`Не удалось загрузить опубликованный набор: ${systemPacksError || 'проверьте подключение к Firebase.'}`)
      const created = await createRoom({ roomId: newRoom, leaderUid: leader.uid, workspaceId: leader.workspaceId, pack: activePack, legacyQuestions: questionBank, selection: selectionForRoom, title, details: detailsForRoom, scoringTemplateId })
      if (created.demoSession) setDemo(created.demoSession)
      localStorage.setItem(roomKey, newRoom); localStorage.setItem(lastRoomKey, newRoom); localStorage.removeItem('atmosphere-host-room'); setLastClosedRoom(''); setResultRoom(''); setRoom(newRoom); navigate('overview', newRoom)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не удалось создать комнату. Проверьте подключение к Firebase и повторите попытку.'
      const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : 'unknown'
      console.error(`Не удалось создать комнату [${code}] для ${newRoom}: ${message}`)
      setCreateError(message)
    } finally { creatingRoomRef.current = false; setBusy(false) }
  }
  const changePhase = async (next: SessionPhase, options: { returnToMain?: boolean; inactivity?: boolean } = {}) => {
    if (!session) return false
    setActionError('')
    try {
      if (firebaseReady) {
        if (next === 'closed') {
          // Closing the live room is the source of truth. Archiving is a
          // separate best-effort operation and must not keep the room live.
          const outcome = await closeRoomAndArchive(session)
          const closedSession = outcome.closed
          setSession(closedSession)
          localStorage.removeItem(roomKey)
          localStorage.removeItem('atmosphere-host-room')
          localStorage.setItem(lastRoomKey, room)
          setLastClosedRoom(room)
          if (outcome.archive) setArchives(prev => ({ ...prev, [room]: outcome.archive! }))
          if (outcome.archiveError) setActionError(`Сессия завершена, но архив пока не сохранён: ${outcome.archiveError.message}`)
          setRoom('')
          if (options.returnToMain !== false) navigate('main', '')
          return true
        }
        await changeRoomPhase(session, next)
      } else {
        const timestamp = Date.now()
        const nextSession = { ...session, phase: next, status: next, lastActivityAt: timestamp, ...(next === 'resultsIntro' ? { resultsIntroStartedAt: timestamp } : {}), ...(next === 'closed' ? { closedAt: timestamp, endedAt: timestamp } : {}) }
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
          setRoom('')
          if (options.returnToMain !== false) navigate('main', '')
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
  const closeRoom = async (options: { returnToMain?: boolean; inactivity?: boolean } = {}) => {
    if (!session || session.phase === 'closed') return false
    return changePhase('closed', options)
  }
  const closeWheelRoom = async (options: { returnToMain?: boolean; inactivity?: boolean } = {}) => {
    if (!session || session.mode !== 'wheel' || session.phase === 'closed') return false
    try { await stopWheelActivity(session.roomId) }
    catch (error) { console.warn('wheel animation could not be cleared before closing', error) }
    return changePhase('closed', options)
  }
  const startWheelAgain = async () => {
    const previous = session
    if (!previous || previous.mode !== 'wheel' || !previous.wheel) return false
    if (!await closeWheelRoom({ returnToMain: false })) return false
    try {
      const nextRoom = await createWheelRoom({
        leaderUid: leader.uid,
        workspaceId: leader.workspaceId,
        title: previous.roomTitle || 'Колесо фортуны',
        config: previous.wheel.config,
      })
      localStorage.setItem(roomKey, nextRoom)
      localStorage.setItem(lastRoomKey, previous.roomId)
      localStorage.removeItem('atmosphere-host-room')
      setLastClosedRoom(previous.roomId)
      setResultRoom('')
      setRoom(nextRoom)
      navigate('currentRoom', nextRoom)
      return true
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Не удалось создать новую игру.')
      return false
    }
  }
  const exitWheelToMain = async () => {
    if (!await closeWheelRoom()) return false
    return true
  }
  const requestCloseCurrentRoom = (createMode?: RoomMode) => {
    if (!session || session.phase === 'closed') return
    setCloseRequest({ createMode })
  }
  const confirmCloseCurrentRoom = async () => {
    const request = closeRequest
    if (!request || !session) return
    const closed = session.mode === 'wheel'
      ? await closeWheelRoom({ returnToMain: request.createMode ? false : true })
      : await closeRoom({ returnToMain: request.createMode ? false : true })
    if (!closed) return
    setCloseRequest(null)
    setRoomConflictMode(null)
    if (request.createMode) openRoomSetup(request.createMode, true)
  }
  const resumeCurrentRoom = () => {
    if (!session || isSessionExpired(session)) {
      setActionError('Эта комната уже истекла. Завершите её и откройте историю, чтобы сохранить результаты.')
      return
    }
    navigate('currentRoom', room)
  }
  const expireCurrentRoom = async () => {
    if (!session || session.phase === 'closed') return true
    const closed = session.mode === 'wheel'
      ? closeWheelRoom({ returnToMain: true, inactivity: true })
      : closeRoom({ returnToMain: true, inactivity: true })
    const completed = await closed
    if (completed) setActionError('Сессия завершена автоматически после 10 минут бездействия.')
    return completed
  }
  const { expiringSoon } = useSessionLifecycle(session, expireCurrentRoom)
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
  const resultSession = resolveResultSession(resultRoom, room, session, archives)
  if (tab === 'main') return <HostLayout menu={menu} tab={tab} onTab={navigate} room={room} session={session} participants={participants.length} menuOpen={menuOpen} setMenuOpen={setMenuOpen}><PageHeader className="host-header" eyebrow="РАБОЧЕЕ ПРОСТРАНСТВО" title="Главное" status={<StatusBadge tone={firebaseReady ? 'accent' : 'muted'}>{firebaseReady ? 'ЭФИР АКТИВЕН' : 'ДЕМО-РЕЖИМ'}</StatusBadge>} /><HomePanel name={leader.fullName} questionCount={systemDiagnosticPack?.questions.length || questionBank.length} onChooseMode={openRoomSetup} activeSession={session?.phase === 'closed' ? null : session} onResume={resumeCurrentRoom} onCloseActive={() => requestCloseCurrentRoom()} notice={expiringSoon ? 'Сессия скоро завершится из-за отсутствия активности. Выполните действие в комнате, чтобы продолжить.' : actionError} />{roomConflictMode && session && <Modal open title="Незавершённая комната" onClose={() => setRoomConflictMode(null)}><p>Её данные не будут смешаны с новой игрой. Перед созданием новой старая комната будет корректно завершена и сохранена в архиве.</p><div className="app-modal-actions"><Button onClick={() => { setRoomConflictMode(null); resumeCurrentRoom() }}>Вернуться в комнату</Button><Button secondary onClick={() => requestCloseCurrentRoom()}>Завершить старую комнату</Button><Button secondary onClick={() => requestCloseCurrentRoom(roomConflictMode)}>Завершить и создать новую</Button></div></Modal>}{closeRequest && <Modal open title="Завершить комнату?" onClose={() => setCloseRequest(null)}><p>Участники больше не смогут отправлять данные. История, результаты и архив останутся сохранены.</p><div className="app-modal-actions"><Button onClick={() => void confirmCloseCurrentRoom()}>Подтвердить завершение</Button><Button secondary onClick={() => setCloseRequest(null)}>Отмена</Button></div></Modal>}{expiringSoon && <Modal open title="Сессия скоро завершится"><p>Через несколько минут она завершится из-за отсутствия реальных действий. Вернитесь в комнату и выполните действие, либо завершите её сейчас.</p><div className="app-modal-actions"><Button onClick={resumeCurrentRoom}>Вернуться в комнату</Button><Button secondary onClick={() => requestCloseCurrentRoom()}>Завершить сейчас</Button></div></Modal>}</HostLayout>
  if (tab === 'rules') return <HostLayout menu={menu} tab={tab} onTab={navigate} room={room} session={session} participants={participants.length} menuOpen={menuOpen} setMenuOpen={setMenuOpen}><header className="host-header"><div><p className="eyebrow">ПОДСКАЗКИ ДЛЯ ВЕДУЩЕГО</p><h1>Правила</h1></div><span className={`status ${firebaseReady ? '' : 'demo'}`}>{firebaseReady ? 'ЭФИР АКТИВЕН' : 'ДЕМО-РЕЖИМ'}</span></header><RulesPanel onStart={() => navigate('currentRoom')} /></HostLayout>
  if (tab === 'profile') return <HostLayout menu={menu} tab={tab} onTab={navigate} room={room} session={session} participants={participants.length} menuOpen={menuOpen} setMenuOpen={setMenuOpen}><header className="host-header"><div><p className="eyebrow">ВАШ АККАУНТ</p><h1>Профиль</h1></div><span className={`status ${firebaseReady ? '' : 'demo'}`}>{firebaseReady ? 'ЭФИР АКТИВЕН' : 'ДЕМО-РЕЖИМ'}</span></header><ProfilePanel profile={leader} /></HostLayout>
  if (tab === 'results' && resultRoom && resultSession) return <HostLayout menu={menu} tab={tab} onTab={navigate} room={room} session={resultSession} participants={Object.keys(resultSession.participants || {}).length} menuOpen={menuOpen} setMenuOpen={setMenuOpen} resultsMode><header className="host-header host-results-header"><div><p className="eyebrow">РЕЗУЛЬТАТЫ · {resultRoom}</p><h1>Общая картина</h1></div><span className="status">СОХРАНЕНО</span></header><Results room={resultRoom} sessionOverride={resultSession} embedded /></HostLayout>
  const warning = !firebaseReady ? 'Для работы с несколькими устройствами подключите Firebase: демо-режим синхронизируется только в этом браузере.' : /localhost|127\.0\.0\.1/.test(publicOrigin) ? 'Этот QR ведёт на адрес компьютера. После публикации сайта здесь будет общий интернет-адрес.' : ''
  const activeDiagnosticPack = isDiagnosticPack(systemDiagnosticPack) ? systemDiagnosticPack : isDiagnosticPack(systemPacks[diagnosticPackId]) ? systemPacks[diagnosticPackId] : null
  const diagnosticQuestions: DiagnosticQuestion[] = orderQuestionsByCategory(
    templateSelection.templateSource === 'workspace' && templateSelection.selectedPackId === diagnosticPackId && workspacePack?.questions.length
      ? workspacePack.questions
      : activeDiagnosticPack?.questions || questionBank,
  )
  const quizSystemPacks = Object.values(systemPacks).filter(pack => isQuizPack(pack) && pack.status === 'published')
  const quizWorkspacePacks = Object.values(workspaceQuizPacks).filter(isQuizPack)
  // A system quiz pack is only a candidate to copy. It must never look like
  // it was successfully added before Firebase confirms the workspace write.
  const selectedQuizWorkspacePack = templateSelection.templateSource === 'workspace'
    ? workspaceQuizPacks[templateSelection.selectedPackId] || null
    : null
  const activeSetupPolicy = getModeDefinition(roomDetails.mode).setupPolicy
  const activeSetupContext = modePackContext(roomDetails.mode)
  const activeSetupPack = activeSetupPolicy.resolvePack(activeSetupContext)
  let activeSetupValid = true
  try { activeSetupPolicy.validateSelection(activeSetupContext) } catch { activeSetupValid = false }
  const addQuizPack = async (pack: ContentPack) => {
    if (workspaceQuizPacks[pack.packId]) {
      setQuizPackActions(previous => ({ ...previous, [pack.packId]: { state: 'existing', message: 'Набор уже добавлен в ваш workspace.' } }))
      return
    }
    if (copyingQuizPacksRef.current.has(pack.packId)) return
    copyingQuizPacksRef.current.add(pack.packId)
    setQuizPackActions(previous => ({ ...previous, [pack.packId]: { state: 'adding' } }))
    try {
      const copied = await copyQuizWorkspacePack(leader.workspaceId, pack)
      // The realtime listener will confirm the same value. Updating this
      // local view only after the server write resolves gives instant, honest
      // feedback without pretending a rejected copy succeeded.
      setWorkspaceQuizPacks(previous => ({ ...previous, [copied.pack.packId]: copied.pack }))
      setQuizPackActions(previous => ({ ...previous, [pack.packId]: {
        state: copied.outcome,
        message: copied.outcome === 'copied' ? 'Набор добавлен в workspace.' : 'Набор уже добавлен в ваш workspace.',
      } }))
      setTemplateSelection(workspaceQuizSelection(copied.pack.packId))
    } catch (error) {
      setQuizPackActions(previous => ({ ...previous, [pack.packId]: { state: 'error', message: error instanceof Error ? error.message : 'Не удалось добавить набор викторины в workspace.' } }))
    } finally { copyingQuizPacksRef.current.delete(pack.packId) }
  }
  const displayPackTitle = (value?: string) => {
    const title = value?.trim() || ''
    return !title || /^\?+$/.test(title) ? 'Проверь себя' : title
  }
  const roomPilotDetailsControl = <Glass className="room-pilot-details">
    <p className="eyebrow">ПАРАМЕТРЫ КОМНАТЫ</p>
    <h3>Настройте новую комнату</h3>
    <p>Название, формат и ожидаемое число участников сохраняются только в истории и экспорте ведущего.</p>
    <div className="room-pilot-fields">
      <label>Формат<select value={roomDetails.mode} onChange={event => { const mode = event.target.value as RoomMode; const policy = getModeDefinition(mode).setupPolicy; setRoomDetails(previous => ({ ...previous, mode })); setScoringTemplateId(policy.defaultScoringTemplateId); const selection = policy.initialSelection(modePackContext(mode)); if (selection) setTemplateSelection(selection) }}><option value="diagnostic">Проверь себя</option><option value="quiz">Библейская викторина</option></select></label>
      <label>Предполагаемое количество участников<select value={roomDetails.estimatedParticipants} onChange={event => setRoomDetails(previous => ({ ...previous, estimatedParticipants: Number(event.target.value) }))}>{[10, 15, 20, 25, 30].map(count => <option value={count} key={count}>{count} участников</option>)}</select></label>
      {roomDetails.mode === 'diagnostic' ? <label>Шаблон подсчёта<select value={scoringTemplateId} onChange={event => setScoringTemplateId(event.target.value as ScoringTemplateId)}><option value="standard-v1">Стандартный: A 3 · B 2 · C 1 · D 0 · пропуск −1</option><option value="strict-v1">Строгий: A 2 · B 1 · C 0 · D −1 · пропуск −2</option></select></label> : <label>Подсчёт ответов<input disabled value="Верный ответ — 1 балл · неверный — 0" /></label>}
    </div>
    <p className="room-template-hint">Выбранный шаблон фиксируется в комнате и не изменится, даже если настройки набора обновят позже.</p>
  </Glass>
  const packSelectionControl = <Glass className="pack-picker">
    <p className="eyebrow">НАБОР ВОПРОСОВ</p>
    {systemPacksState === 'loading'
      ? <p>Загружаем опубликованные наборы…</p>
      : systemPacksState === 'error'
        ? <><h3>Библиотека недоступна</h3><p className="connection-warning">{systemPacksError || 'Не удалось получить набор из Firebase.'}</p></>
        : roomDetails.mode === 'diagnostic'
          ? !activeDiagnosticPack && firebaseReady
            ? <><h3>Нет опубликованного диагностического набора</h3><p className="connection-warning">Владелец платформы должен опубликовать системный набор перед созданием комнаты.</p></>
            : <><h3>{displayPackTitle(activeDiagnosticPack?.title)}</h3><p>{diagnosticQuestions.length} вопросов · версия {activeDiagnosticPack?.packVersion || 1}</p><p>{activeDiagnosticPack?.description || 'Системный набор вопросов для режима «Проверь себя». '}</p>{activeDiagnosticPack && activeDiagnosticPack.questions.length === 0 && <p className="connection-warning">В этом наборе пока нет вопросов, поэтому его нельзя использовать для создания комнаты.</p>}</>
          : <>
            <h3>Выберите набор викторины</h3>
            <p>Сначала добавьте опубликованный набор в свой workspace. Это создаст вашу отдельную копию и не изменит глобальную библиотеку.</p>
            {!quizSystemPacks.length && <p className="connection-warning">Пока нет опубликованных наборов викторины. Владелец может создать стартовые наборы в глобальной библиотеке.</p>}
            <div className="quiz-pack-list">
              {quizSystemPacks.map(pack => {
                const copied = workspaceQuizPacks[pack.packId]
                const action = quizPackActions[pack.packId]
                return <div className={`quiz-pack-row ${selectedQuizWorkspacePack?.packId === pack.packId ? 'selected' : ''}`} key={pack.packId}>
                  <div><b>{displayPackTitle(pack.title)}</b><small>{pack.difficulty === 'easy' ? 'Лёгкий уровень' : pack.difficulty === 'medium' ? 'Средний уровень' : 'Сложный уровень'} · {pack.questions.length} вопросов · v{pack.packVersion}</small></div>
                  {copied
                    ? <Button secondary onClick={() => setTemplateSelection(workspaceQuizSelection(copied.packId))}>{action?.state === 'copied' ? 'Добавлено в workspace' : templateSelection.templateSource === 'workspace' && templateSelection.selectedPackId === copied.packId ? 'Выбрано' : 'Уже добавлено'}</Button>
                    : <Button secondary disabled={action?.state === 'adding'} onClick={() => void addQuizPack(pack)}>{action?.state === 'adding' ? 'Добавляем…' : 'Добавить в мой workspace'}</Button>}
                  {action?.message && <small className={action.state === 'error' ? 'connection-warning' : 'room-template-hint'}>{action.message}</small>}
                </div>
              })}
            </div>
            {!!quizWorkspacePacks.length && <div className="quiz-pack-current"><p className="eyebrow">МОИ ДОБАВЛЕННЫЕ НАБОРЫ</p>{quizWorkspacePacks.map(pack => <button type="button" key={pack.packId} className={templateSelection.templateSource === 'workspace' && templateSelection.selectedPackId === pack.packId ? 'selected' : ''} onClick={() => setTemplateSelection({ selectedPackId: pack.packId, templateSource: 'workspace' })}>{displayPackTitle(pack.title)} <small>{pack.questions.length} вопросов · v{pack.packVersion}</small></button>)}</div>}
            {selectedQuizWorkspacePack && <p className="room-template-hint">Выбрано: {displayPackTitle(selectedQuizWorkspacePack.title)} · {selectedQuizWorkspacePack.questions.length} вопросов. Комната сохранит независимый snapshot этой версии.</p>}
          </>}
  </Glass>
  const setupModeManifest = getModeDefinition(roomDetails.mode)
  const ModeSetupScreen = setupModeManifest.setupScreen
  if (tab === 'roomSetup' && ModeSetupScreen) return <HostLayout menu={menu} tab={tab} onTab={navigate} room={room} session={session} participants={participants.length} menuOpen={menuOpen} setMenuOpen={setMenuOpen}>
    <header className="host-header"><div><p className="eyebrow">РЕЖИМ · {setupModeManifest.menuLabel.toUpperCase()}</p><h1>{setupModeManifest.title}</h1><p className="room-header-title">{setupModeManifest.description}</p></div></header>
    <ModeSetupScreen
      onBack={() => navigate(setupModeManifest.mode as HostTab)}
      leaderUid={leader.uid}
      workspaceId={leader.workspaceId}
      defaultTitle={roomTitleDraft || setupModeManifest.title}
      onCreated={createdRoom => {
        localStorage.setItem(roomKey, createdRoom)
        localStorage.setItem(lastRoomKey, createdRoom)
        localStorage.removeItem('atmosphere-host-room')
        setLastClosedRoom('')
        setResultRoom('')
        setRoom(createdRoom)
        navigate('currentRoom', createdRoom)
      }}
    />
  </HostLayout>
  if (tab === 'roomSetup') return <HostLayout menu={menu} tab={tab} onTab={navigate} room={room} session={session} participants={participants.length} menuOpen={menuOpen} setMenuOpen={setMenuOpen}>
    <header className="host-header"><div><p className="eyebrow">НОВАЯ ВСТРЕЧА</p><h1>Настройка комнаты</h1><p className="room-header-title">Сначала подтвердите параметры — комната появится только после нажатия кнопки ниже.</p></div><span className={`status ${firebaseReady ? '' : 'demo'}`}>{firebaseReady ? 'ЭФИР АКТИВЕН' : 'ДЕМО-РЕЖИМ'}</span></header>
    <Glass className="start-panel"><p className="eyebrow">ШАГ 1 · ПАРАМЕТРЫ</p><h2>Создайте новую комнату</h2><p>Выберите формат, ожидаемое число участников и набор вопросов. Комната и QR-код появятся только после подтверждения.</p>{roomPilotDetailsControl}{packSelectionControl}<label className="room-title-input">Название комнаты<input value={roomTitleDraft} onChange={event => setRoomTitleDraft(event.target.value)} placeholder={defaultRoomTitle()} maxLength={80} /></label><div className="control-actions"><Button disabled={busy || systemPacksState === 'loading' || (firebaseReady && (!activeSetupValid || !activeSetupPack || activeSetupPack.questions.length === 0))} onClick={() => void create()}>{busy ? 'Создаём…' : 'Подтвердить и создать комнату'}</Button><Button secondary disabled={busy} onClick={() => navigate(session && session.phase !== 'closed' ? 'currentRoom' : 'overview')}>Отмена</Button></div>{createError && <p className="connection-warning">{createError}</p>}{actionError && <p className="connection-warning">{actionError}</p>}</Glass>
  </HostLayout>
  const feedbackUrl = createFeedbackUrl(feedbackFormUrl, session)
  const selectedQuizPreview = selectedQuizWorkspacePack || quizSystemPacks[0] || null
  const currentRoomTabs = session ? <RoomTabs active={roomView} session={session} onChange={view => navigate('currentRoom', room, view)} /> : null

  // Phase 1–3: all leader-facing room work lives behind the one canonical
  // "currentRoom" destination. Legacy tabs are normalised before this point.
  if (tab === 'currentRoom' && roomView === 'results') {
    const viewedSession = resultRoom === room ? session : archives[resultRoom] || session
    if (viewedSession) return <HostLayout menu={menu} tab={tab} onTab={navigate} room={viewedSession.roomId} session={viewedSession} participants={Object.keys(viewedSession.participants || {}).length} menuOpen={menuOpen} setMenuOpen={setMenuOpen} resultsMode>
      <header className="host-header host-results-header"><div><p className="eyebrow">{getRoomModeTitle(viewedSession).toUpperCase()} · {getRoomResultsLabel(viewedSession).toUpperCase()}</p><h1>{viewedSession.roomTitle || viewedSession.displayCode || viewedSession.roomId}</h1></div></header>
      {currentRoomTabs}
      <Results room={viewedSession.roomId} sessionOverride={viewedSession} embedded />
    </HostLayout>
    return <HostLayout menu={menu} tab={tab} onTab={navigate} room={lastClosedRoom} session={null} participants={0} menuOpen={menuOpen} setMenuOpen={setMenuOpen}>
      <header className="host-header"><div><p className="eyebrow">РЕЗУЛЬТАТЫ</p><h1>Нет выбранной комнаты</h1></div></header>
      <Glass className="empty-state"><p>Откройте завершённую комнату из истории, чтобы увидеть результаты.</p><Button onClick={() => navigate('rooms')}>Открыть историю комнат</Button></Glass>
    </HostLayout>
  }

  if (tab === 'currentRoom' && roomView === 'participants' && session) return <HostLayout menu={menu} tab={tab} onTab={navigate} room={room} session={session} participants={participants.length} menuOpen={menuOpen} setMenuOpen={setMenuOpen}>
    <header className="host-header"><div><p className="eyebrow">{session.phase === 'closed' ? 'АРХИВНАЯ КОМНАТА' : 'ПОДКЛЮЧЕНИЕ УЧАСТНИКОВ'}</p><h1>Участники и QR</h1><p className="room-header-title">{session.roomTitle || session.displayCode || room}</p></div><span className={`status ${firebaseReady ? '' : 'demo'}`}>{session.phase === 'closed' ? 'ЗАВЕРШЕНА' : firebaseReady ? 'ЭФИР АКТИВЕН' : 'ДЕМО'}</span></header>
    {currentRoomTabs}
    <div className="host-grid room-participants-grid"><Glass className="qr-card"><p className="eyebrow">ПОДКЛЮЧЕНИЕ</p>{qr ? <img src={qr} alt="QR-код комнаты" /> : <p>Генерируем QR-код…</p>}<code>{joinUrl}</code><Button secondary onClick={() => void navigator.clipboard?.writeText(joinUrl)}>Скопировать ссылку</Button></Glass><Glass className="participant-list"><p className="eyebrow">УЧАСТНИКИ · {participants.length}</p><h2>{session.phase === 'closed' ? 'Комната завершена' : 'Кто уже подключился'}</h2>{participants.length ? <div className="participant-rows">{participants.map(person => <div key={person.id}><b>{person.nickname}</b><span>{person.status === 'finished' ? 'Завершил(а)' : person.status === 'answering' ? 'Отвечает' : 'Ожидает'}</span></div>)}</div> : <p>Пока никто не подключился. Покажите QR-код или отправьте ссылку.</p>}</Glass></div>
  </HostLayout>

  if (tab === 'currentRoom' && roomView === 'export') {
    const exportRoom = session || (lastClosedRoom ? archives[lastClosedRoom] : null)
    return <HostLayout menu={menu} tab={tab} onTab={navigate} room={exportRoom?.roomId || lastClosedRoom} session={exportRoom || null} participants={Object.keys(exportRoom?.participants || {}).length} menuOpen={menuOpen} setMenuOpen={setMenuOpen}>
      <header className="host-header"><div><p className="eyebrow">ВЫГРУЗКА ДАННЫХ</p><h1>Экспорт комнаты</h1></div></header>{currentRoomTabs}
      {exportRoom ? <Glass className="export-panel"><p className="eyebrow">{getRoomModeTitle(exportRoom).toUpperCase()}</p><h2>{exportRoom.roomTitle || exportRoom.displayCode || exportRoom.roomId}</h2><p>CSV содержит данные лидера, параметры комнаты, статус участников и ответы. Личные ответы не выводятся на общем экране.</p><Button onClick={() => exportCsv(exportRoom, leader)}>Скачать CSV</Button></Glass> : <Glass className="empty-state"><h3>Выберите комнату для экспорта</h3><p>Завершённые комнаты доступны в истории.</p><Button onClick={() => navigate('rooms')}>Открыть историю комнат</Button></Glass>}
    </HostLayout>
  }

  if (tab === 'currentRoom') {
    if (!session || session.phase === 'closed') return <HostLayout menu={menu} tab={tab} onTab={navigate} room={lastClosedRoom} session={null} participants={0} menuOpen={menuOpen} setMenuOpen={setMenuOpen}>
      <header className="host-header"><div><p className="eyebrow">ТЕКУЩАЯ КОМНАТА</p><h1>У вас пока нет активной комнаты</h1></div></header>
      <Glass className="empty-state"><p>Создайте комнату, чтобы увидеть участников, статистику и результаты.</p><Button onClick={() => openRoomSetup(diagnosticMode)}>Создать комнату</Button>{lastClosedRoom && <Button secondary onClick={() => navigate('rooms')}>Посмотреть историю комнат</Button>}</Glass>
    </HostLayout>
    const ModeHostScreen = getModeDefinition(session.gameTypeId || session.mode).hostScreen
    if (ModeHostScreen) return <HostLayout menu={menu} tab={tab} onTab={navigate} room={room} session={session} participants={Object.keys(session.wheel?.participants || {}).length} menuOpen={menuOpen} setMenuOpen={setMenuOpen}>
      <ModeHostScreen session={session} joinUrl={joinUrl} onClose={session.mode === 'wheel' ? closeWheelRoom : closeRoom} onPlayAgain={session.mode === 'wheel' ? startWheelAgain : undefined} onExitToMain={session.mode === 'wheel' ? exitWheelToMain : undefined} />
    </HostLayout>
    return <HostLayout menu={menu} tab={tab} onTab={navigate} room={room} session={session} participants={participants.length} menuOpen={menuOpen} setMenuOpen={setMenuOpen}>
      <header className="host-header"><div><p className="eyebrow">ТЕКУЩАЯ КОМНАТА · {getRoomModeTitle(session).toUpperCase()}</p><h1>{session.roomTitle || session.displayCode || room}</h1><p className="room-header-title">{getRoomStatusText(session)}</p></div><span className={`status ${firebaseReady ? '' : 'demo'}`}>{firebaseReady ? 'ЭФИР АКТИВЕН' : 'ДЕМО'}</span></header>
      {currentRoomTabs}
      <div className="metrics"><Metric label="Подключились" value={participants.length} note={`из ${session.maxParticipants} участников`} /><Metric label="Сейчас отвечают" value={answering} note="в своём темпе" /><Metric label="Завершили" value={finished} note={allFinished ? 'все готовы' : 'ждём завершения'} /></div>
      <Glass className="control-panel"><p className="eyebrow">ТЕКУЩАЯ ФАЗА</p><h2>{getRoomStatusText(session)}</h2><p>{getRoomStatusDescription(session)}</p><div className="control-actions">{session.phase === 'lobby' && <Button onClick={() => void start()}>Запустить {getRoomModeTitle(session).toLocaleLowerCase('ru-RU')}</Button>}<Button secondary onClick={() => navigate('currentRoom', room, 'participants')}>Участники и QR</Button><Button disabled={!allFinished && session.phase === 'live'} onClick={() => void showResults()}>{getRoomResultsLabel(session)}</Button><Button secondary onClick={() => requestCloseCurrentRoom()}>Завершить сессию</Button></div></Glass>
      {closeRequest && <Modal open title="Завершить комнату?" onClose={() => setCloseRequest(null)}><p>Участники больше не смогут отправлять данные. История, результаты и архив останутся сохранены.</p><div className="app-modal-actions"><Button onClick={() => void confirmCloseCurrentRoom()}>Подтвердить завершение</Button><Button secondary onClick={() => setCloseRequest(null)}>Отмена</Button></div></Modal>}
      {actionError && <Modal open title="Не удалось выполнить действие" onClose={() => setActionError('')}><p>{actionError}</p></Modal>}
    </HostLayout>
  }

  if (tab === 'rooms') return <HostLayout menu={menu} tab={tab} onTab={navigate} room={room} session={session} participants={participants.length} menuOpen={menuOpen} setMenuOpen={setMenuOpen}>
    <header className="host-header"><div><p className="eyebrow">БИБЛИОТЕКА ВСТРЕЧ</p><h1>История комнат</h1><p className="room-header-title">Завершённые комнаты доступны для просмотра результатов и выгрузки.</p></div></header>
    <Glass className="history-filters"><p className="eyebrow">ФИЛЬТРЫ ИСТОРИИ</p><div><label>Поиск<input value={historyFilters.query} placeholder="Название, код или молодёжка" onChange={event => setHistoryFilters(previous => ({ ...previous, query: event.target.value }))} /></label><label>Формат<select value={historyFilters.mode} onChange={event => setHistoryFilters(previous => ({ ...previous, mode: event.target.value as typeof previous.mode }))}><option value="all">Все форматы</option><option value="diagnostic">Проверь себя</option><option value="quiz">Викторина</option><option value="wheel">Колесо фортуны</option></select></label><label>От<input type="date" value={historyFilters.from} onChange={event => setHistoryFilters(previous => ({ ...previous, from: event.target.value }))} /></label><label>До<input type="date" value={historyFilters.to} onChange={event => setHistoryFilters(previous => ({ ...previous, to: event.target.value }))} /></label></div></Glass>
    <div className="stack">{filteredArchiveEntries.length ? filteredArchiveEntries.map(archived => <Glass className="room-row archive-card" key={archived.roomId}><div><p className="eyebrow">{getRoomModeTitle(archived).toUpperCase()}</p><h2>{archived.roomTitle || archived.displayCode || archived.roomId}</h2><p>{new Date(archived.createdAt).toLocaleDateString('ru-RU')} · {Object.keys(archived.participants || {}).length} участников</p></div><div className="archive-actions"><Button secondary onClick={() => openArchivedResult(archived)}>{getRoomResultsLabel(archived)}</Button><Button secondary onClick={() => { setRoom(archived.roomId); setResultRoom(archived.roomId); navigate('currentRoom', archived.roomId, 'export') }}>Экспорт</Button></div></Glass>) : <Glass className="empty-state"><h3>Завершённых комнат пока нет</h3><p>После завершения комнаты её результаты и экспорт появятся здесь.</p><Button onClick={() => openRoomSetup(diagnosticMode)}>Создать комнату</Button></Glass>}</div>
  </HostLayout>

  const activeModeManifest = modeRegistry[tab as RoomMode]
  const ModeLandingScreen = activeModeManifest?.landingScreen
  if (activeModeManifest && ModeLandingScreen) return <HostLayout menu={menu} tab={tab} onTab={navigate} room={room} session={session} participants={participants.length} menuOpen={menuOpen} setMenuOpen={setMenuOpen}>
    <header className="host-header"><div><p className="eyebrow">РЕЖИМ · {activeModeManifest.menuLabel.toUpperCase()}</p><h1>{activeModeManifest.title}</h1><p className="room-header-title">{activeModeManifest.description}</p></div></header>
    <ModeLandingScreen onSetup={() => openRoomSetup(activeModeManifest.mode as RoomMode)} />
  </HostLayout>

  if (tab === 'diagnostic') return <HostLayout menu={menu} tab={tab} onTab={navigate} room={room} session={session} participants={participants.length} menuOpen={menuOpen} setMenuOpen={setMenuOpen}>
    <header className="host-header"><div><p className="eyebrow">РЕЖИМ · ПРОВЕРЬ СЕБЯ</p><h1>{getModeDefinition(diagnosticMode).title}</h1><p className="room-header-title">{getModeDefinition(diagnosticMode).description}</p></div></header>
    <Glass className="mode-intro"><p className="eyebrow">ОПУБЛИКОВАННЫЙ НАБОР</p><h2>{displayPackTitle(activeDiagnosticPack?.title)}</h2><p>{diagnosticQuestions.length} вопросов · категории, проценты, пропуск и личные пожелания доступны только в режиме «Проверь себя».</p><div className="control-actions"><Button onClick={() => openRoomSetup(diagnosticMode)}>Создать комнату</Button><Button secondary onClick={() => setQuestionEditingNotice(true)}>О редактировании</Button></div><small>Набор доступен только для просмотра и запуска.</small></Glass>
    <div className="question-groups">{Object.entries(categories).map(([categoryId, title]) => { const group = orderQuestionsByCategory(diagnosticQuestions.filter(question => question.category === categoryId)); return <Glass className="question-group" key={categoryId}><p className="eyebrow">{group.length} ВОПРОСОВ</p><h2>{title}</h2><p className="question-scoring">Стандартный scoring: 3 · 2 · 1 · 0</p>{group.map(question => <article className="question-row" key={question.id}><div><b>{question.categoryOrder || group.indexOf(question) + 1}. {question.title}</b><small>{Object.entries(question.options).map(([key, value]) => `${key}: ${value}`).join(' · ')}</small></div></article>)}</Glass> })}</div>
    <Modal open={questionEditingNotice} title="Редактирование недоступно" onClose={() => setQuestionEditingNotice(false)}><p>Редактирование вопросов будет доступно после выпуска полноценного приложения.</p><div className="app-modal-actions"><Button secondary onClick={() => setQuestionEditingNotice(false)}>Понятно</Button></div></Modal>
  </HostLayout>

  if (tab === 'quiz') return <HostLayout menu={menu} tab={tab} onTab={navigate} room={room} session={session} participants={participants.length} menuOpen={menuOpen} setMenuOpen={setMenuOpen}>
    <header className="host-header"><div><p className="eyebrow">РЕЖИМ · ВИКТОРИНА</p><h1>{getModeDefinition(quizMode).title}</h1><p className="room-header-title">{getModeDefinition(quizMode).description}</p></div></header>
    <Glass className="mode-intro"><p className="eyebrow">НОВАЯ ВИКТОРИНА</p><h2>Выберите уровень и начните игру</h2><p>Викторина использует отдельные вопросы, правильные ответы, подсчёт баллов и топ-3. Наборы доступны для просмотра и запуска.</p><div className="control-actions"><Button onClick={() => openRoomSetup(quizMode)}>Создать комнату викторины</Button><Button secondary onClick={() => setQuestionEditingNotice(true)}>О редактировании</Button></div></Glass>
    <div className="quiz-pack-list">{quizSystemPacks.map(pack => { const copied = workspaceQuizPacks[pack.packId]; const action = quizPackActions[pack.packId]; return <Glass className="quiz-pack-row" key={pack.packId}><div><p className="eyebrow">{pack.difficulty === 'easy' ? 'ЛЁГКИЙ УРОВЕНЬ' : pack.difficulty === 'medium' ? 'СРЕДНИЙ УРОВЕНЬ' : 'СЛОЖНЫЙ УРОВЕНЬ'}</p><h3>{displayPackTitle(pack.title)}</h3><small>{pack.questions.length} вопросов · версия {pack.packVersion}</small>{action?.message && <small className={action.state === 'error' ? 'connection-warning' : 'room-template-hint'}>{action.message}</small>}</div>{copied ? <Button secondary onClick={() => setTemplateSelection(workspaceQuizSelection(pack.packId))}>{action?.state === 'copied' ? 'Добавлено в workspace' : 'Уже добавлено'}</Button> : <Button secondary disabled={action?.state === 'adding'} onClick={() => void addQuizPack(pack)}>{action?.state === 'adding' ? 'Добавляем…' : 'Добавить в мой workspace'}</Button>}</Glass> })}</div>
    {selectedQuizPreview && <Glass className="question-group"><p className="eyebrow">ПРОСМОТР НАБОРА</p><h2>{displayPackTitle(selectedQuizPreview.title)}</h2>{selectedQuizPreview.questions.map((question, index) => <article className="question-row" key={question.id}><div><b>{index + 1}. {question.title}</b><small>{Object.entries(question.options).map(([key, value]) => `${key}: ${value}`).join(' · ')}</small></div></article>)}<small>Набор доступен для просмотра и запуска. Ключи ответов и проверка результатов хранятся только в защищённом серверном слое.</small></Glass>}
  </HostLayout>
  if (tab === 'questions') return <HostLayout menu={menu} tab={tab} onTab={navigate} room={room} session={session} participants={participants.length} menuOpen={menuOpen} setMenuOpen={setMenuOpen}><header className="host-header"><div><p className="eyebrow">МАТЕРИАЛЫ · ПРОВЕРЬ СЕБЯ</p><h1>Вопросы</h1></div></header><Glass className="mode-intro"><h2>Набор доступен только для просмотра</h2><p>Редактирование вопросов будет доступно после выпуска полноценного приложения.</p><Button secondary onClick={() => setQuestionEditingNotice(true)}>Понятно</Button></Glass><Modal open={questionEditingNotice} title="Редактирование недоступно" onClose={() => setQuestionEditingNotice(false)}><p>Редактирование вопросов будет доступно после выпуска полноценного приложения.</p><div className="app-modal-actions"><Button secondary onClick={() => setQuestionEditingNotice(false)}>Понятно</Button></div></Modal></HostLayout>
  const historyFiltersControl = <Glass className="history-filters"><p className="eyebrow">ФИЛЬТРЫ ИСТОРИИ</p><div><input value={historyFilters.query} onChange={event => setHistoryFilters(previous => ({ ...previous, query: event.target.value }))} placeholder="Комната, молодёжка, город или код" /><select value={historyFilters.mode} onChange={event => setHistoryFilters(previous => ({ ...previous, mode: event.target.value as 'all' | RoomMode }))}><option value="all">Все форматы</option><option value="diagnostic">Проверь себя</option><option value="quiz">Викторина</option><option value="wheel">Колесо фортуны</option></select><label>С<input type="date" value={historyFilters.from} onChange={event => setHistoryFilters(previous => ({ ...previous, from: event.target.value }))} /></label><label>По<input type="date" value={historyFilters.to} onChange={event => setHistoryFilters(previous => ({ ...previous, to: event.target.value }))} /></label></div></Glass>
  if (!session && tab === 'rooms') return <HostLayout menu={menu} tab={tab} onTab={navigate} room={lastClosedRoom} session={null} participants={0} menuOpen={menuOpen} setMenuOpen={setMenuOpen}>
    <header className="host-header"><div><p className="eyebrow">БИБЛИОТЕКА ВСТРЕЧ</p><h1>Комнаты</h1></div><span className={`status ${firebaseReady ? '' : 'demo'}`}>{firebaseReady ? 'ЭФИР АКТИВЕН' : 'ДЕМО-РЕЖИМ'}</span></header>
    <div className="stack"><Glass className="empty-state"><h3>Нет активной комнаты</h3><p>Перед созданием настройте параметры новой встречи. Завершённые встречи остаются в результатах и истории.</p><Button onClick={openRoomSetup}>Создать комнату</Button><Button secondary onClick={() => navigate('results')}>Открыть результаты</Button></Glass></div>
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
    <header className="host-header"><div><p className="eyebrow">{lastClosedRoom ? `ЗАВЕРШЁННАЯ КОМНАТА · ${lastClosedRoom}` : 'ВЕДУЩИЙ · НОВАЯ ВСТРЕЧА'}</p><h1>{lastClosedRoom ? 'Комната завершена' : 'Проверь себя'}</h1></div><span className={`status ${firebaseReady ? '' : 'demo'}`}>{lastClosedRoom ? 'СОХРАНЕНО' : firebaseReady ? 'ЭФИР АКТИВЕН' : 'ДЕМО-РЕЖИМ'}</span></header>
    <Glass className="start-panel"><p className="eyebrow">{lastClosedRoom ? 'ВСТРЕЧА СОХРАНЕНА' : 'НОВАЯ ВСТРЕЧА'}</p><h2>{lastClosedRoom ? 'Комната завершена' : 'Готовы начать?'}</h2><p>{lastClosedRoom ? 'Участники и ответы сохранены. Чтобы провести новый формат, создайте новую комнату.' : 'Перед созданием выберите параметры встречи и подтвердите их на отдельном экране.'}</p><div className="control-actions"><Button onClick={openRoomSetup}>Создать новую комнату</Button>{lastClosedRoom && <Button secondary onClick={() => navigate('results')}>Посмотреть старые результаты</Button>}{lastClosedRoom && <Button secondary onClick={() => navigate('export')}>Открыть экспорт</Button>}</div>{actionError && <p className="connection-warning">{actionError}</p>}</Glass>
  </HostLayout>
  if (!session && tab === 'results') return <HostLayout menu={menu} tab={tab} onTab={navigate} room={lastClosedRoom} session={null} participants={0} menuOpen={menuOpen} setMenuOpen={setMenuOpen}>
    <header className="host-header"><div><p className="eyebrow">БИБЛИОТЕКА РЕЗУЛЬТАТОВ</p><h1>Результаты</h1></div><span className={`status ${firebaseReady ? '' : 'demo'}`}>{firebaseReady ? 'ЭФИР АКТИВЕН' : 'ДЕМО-РЕЖИМ'}</span></header>
    <Glass className="empty-state"><h3>{archiveEntries.length ? `Сохранено завершённых комнат: ${archiveEntries.length}` : 'Завершённых комнат пока нет'}</h3><p>{archiveEntries.length ? 'Откройте раздел «Комнаты», чтобы выбрать встречу и посмотреть её результаты или экспорт.' : 'После завершения первой комнаты её результаты останутся здесь и будут доступны после обновления страницы.'}</p><Button onClick={() => navigate('rooms')}>Открыть историю комнат</Button></Glass>
  </HostLayout>
  if (!session) return <HostLayout menu={menu} tab={tab} onTab={navigate} room={lastClosedRoom} session={null} participants={0} menuOpen={menuOpen} setMenuOpen={setMenuOpen}><Glass className="empty-state"><h3>Нет активной комнаты</h3><Button onClick={openRoomSetup}>Создать комнату</Button></Glass></HostLayout>
  return <HostLayout menu={menu} tab={tab} onTab={navigate} room={room} session={session} participants={participants.length} menuOpen={menuOpen} setMenuOpen={setMenuOpen}>
    <header className="host-header"><div><p className="eyebrow">{session ? `СЕССИЯ · ${session.displayCode || room}` : 'РАБОЧЕЕ ПРОСТРАНСТВО'}</p><h1>{tab === 'overview' ? 'Обзор' : tab === 'currentRoom' ? 'Управление сессией' : menu.find(item => item[0] === tab)?.[1]}</h1>{session && <p className="room-header-title">{session.roomTitle || `Комната ${room}`}</p>}</div><span className={`status ${firebaseReady ? '' : 'demo'}`}>{firebaseReady ? 'ЭФИР АКТИВЕН' : 'ДЕМО-РЕЖИМ'}</span></header>
    {(tab === 'overview' || tab === 'currentRoom') && (session.phase === 'closed' ? <Glass className="closed-room-panel"><p className="eyebrow">КОМНАТА ЗАВЕРШЕНА</p><h2>Эта комната завершена</h2><p>Участники и ответы сохранены. Чтобы провести новый формат, сначала настройте новую комнату.</p><div className="control-actions"><Button onClick={openRoomSetup}>Создать новую комнату</Button><Button secondary onClick={() => openArchivedResult(session)}>Посмотреть старые результаты</Button><Button secondary onClick={() => navigate('results')}>Библиотека результатов</Button><Button secondary onClick={() => navigate('export')}>Открыть экспорт</Button>{feedbackUrl && <Button secondary onClick={() => window.open(feedbackUrl, '_blank', 'noopener,noreferrer')}>Оставить обратную связь</Button>}</div>{!feedbackUrl && <p className="connection-warning">Добавьте ссылку на Google Form в настройках, чтобы после встречи собирать обратную связь.</p>}{actionError && <p className="connection-warning">{actionError}</p>}</Glass> : <><div className="metrics"><Metric label="Подключились" value={participants.length} note={`из ${session.maxParticipants} участников`} /><Metric label="Сейчас отвечают" value={answering} note="в своём темпе" /><Metric label="Завершили" value={finished} note={allFinished ? 'все готовы' : 'ждём завершения'} /></div><div className="overview-grid"><Glass className="control-panel"><p className="eyebrow">ТЕКУЩАЯ ФАЗА</p><h2>{phaseText(session.phase)}</h2><p>{session.phase === 'lobby' ? 'Покажите QR-код. После запуска у вас автоматически откроется отдельный экран с живым прогрессом.' : allFinished ? 'Все участники завершили ответы. Можно открыть общую визуализацию на большом экране.' : 'Экран прогресса обновляется в реальном времени — без личных ответов и имён.'}</p>{session.phase === 'lobby' && <div className="room-title-editor"><label className="room-title-input">Название комнаты<input value={roomTitleDraft} onChange={event => setRoomTitleDraft(event.target.value)} placeholder={defaultRoomTitle(session.createdAt)} maxLength={80} /></label><div><Button secondary disabled={roomTitleSaving || roomTitleDraft.trim() === (session.roomTitle || '')} onClick={() => void saveRoomTitle()}>{roomTitleSaving ? 'Сохраняем…' : 'Сохранить название'}</Button><Button secondary onClick={() => void navigator.clipboard.writeText(session.displayCode || room).catch(error => setActionError(error instanceof Error ? error.message : 'Не удалось скопировать код'))}>Скопировать код {session.displayCode || room}</Button></div><small>После запуска режима название будет заблокировано.</small></div>}<div className="control-actions">{session.phase === 'lobby' && <Button disabled={!participants.length} onClick={start}>Запустить {getRoomModeTitle(session)}</Button>}{session.phase !== 'lobby' && <Button secondary onClick={() => window.open(hostUrl(`/stage?room=${room}`), 'atmosphere-stage')}>Открыть экран прогресса</Button>}<Button onClick={showResults} disabled={!allFinished || session.phase === 'resultsIntro' || session.phase === 'resultsReal'}>Показать общие результаты</Button><Button secondary onClick={closeRoom}>Завершить комнату</Button></div><div className="results-lock"><span className={allFinished ? 'ready' : ''}>{allFinished ? '✓' : '⌕'}</span><div><b>{allFinished ? 'Общий результат готов' : 'Общий результат пока закрыт'}</b><small>{allFinished ? 'Нажмите кнопку выше, чтобы начать показ.' : `Завершили ${finished} из ${participants.length || '—'} участников.`}</small></div></div><div className="phase-track">{(['lobby', 'live', 'resultsIntro', 'resultsReal'] as SessionPhase[]).map(item => <span className={session.phase === item ? 'active' : ''} key={item}>{phaseText(item)}</span>)}</div></Glass><Glass className="qr-panel"><p className="eyebrow">ПОДКЛЮЧЕНИЕ УЧАСТНИКОВ</p>{qr && <img src={qr} alt="QR-код для подключения" className="qr" />}<code>{joinUrl}</code><Button secondary onClick={() => void navigator.clipboard.writeText(joinUrl).catch(error => setActionError(error instanceof Error ? error.message : 'Не удалось скопировать ссылку'))}>Скопировать ссылку</Button>{warning && <p className="connection-warning">{warning}</p>}</Glass></div><Glass className="participants-panel"><div className="participants-panel-header"><div><p className="eyebrow">УЧАСТНИКИ В КОМНАТЕ</p><h3>{participants.length ? `${participants.length} подключились` : 'Пока никто не подключился'}</h3></div><span>{session.displayCode || room}</span></div>{participants.length ? <ul className="participant-list">{participants.sort((a, b) => a.joinedAt - b.joinedAt).map(person => <li key={person.id}><span className={`participant-status ${person.status}`} /><div><b>{person.nickname}</b><small>{person.status === 'waiting' ? 'Ожидает' : person.status === 'answering' ? 'Отвечает' : 'Завершил'}</small></div></li>)}</ul> : <p className="participants-empty">Пока никто не подключился. Отправьте участникам QR-код или ссылку для подключения.</p>}</Glass></>) }
    {tab === 'rooms' && <div className="stack"><Glass className="room-row"><div><p className="eyebrow">{session.phase === 'closed' ? 'ЗАВЕРШЁННАЯ' : 'ТЕКУЩАЯ'}</p><h2>{session.roomTitle || `Комната ${room}`}</h2><p>Код {session.displayCode || room} · {phaseText(session.phase)} · {participants.length} подключились · {finished} завершили</p></div><Button onClick={openRoomSetup}>Создать новую комнату</Button></Glass>{actionError && <p className="connection-warning">{actionError}</p>}{historyFiltersControl}<div className="archive-list">{filteredArchiveEntries.map(archived => <Glass className="archive-card" key={archived.roomId}><div><p className="eyebrow">АРХИВ · {new Date(archived.archivedAt).toLocaleDateString('ru-RU')}</p><h3>{archived.roomTitle || `Комната ${archived.displayCode || archived.roomId}`}</h3><p>{archived.groupName || 'Молодёжка не указана'} · {archived.city || 'Город не указан'} · {getRoomModeTitle(archived)}</p><p>Код {archived.displayCode || archived.roomId} · {archived.participantCount ?? Object.keys(archived.participants || {}).length} участников · {archived.completedCount ?? Object.values(archived.participants || {}).filter(person => person.status === 'finished').length} завершили</p></div><div className="archive-actions"><Button secondary onClick={() => openArchivedResult(archived)}>Открыть результаты</Button><Button secondary onClick={() => exportCsv(archived, leader)}>Экспортировать CSV</Button></div></Glass>)}</div>{!archiveEntries.length && <Glass className="empty-state"><h3>История комнат пока пуста</h3><p>После завершения комнаты она появится здесь вместе с ответами участников.</p></Glass>}{archiveEntries.length > 0 && !filteredArchiveEntries.length && <Glass className="empty-state"><h3>По фильтрам ничего не найдено</h3><p>Сбросьте поиск, формат или диапазон дат.</p></Glass>}</div>}
    {tab === 'results' && !resultRoom && <div className="results-library"><div className="results-library-intro"><p className="eyebrow">БИБЛИОТЕКА РЕЗУЛЬТАТОВ</p><h2>Завершённые встречи</h2><p>Выберите комнату, чтобы посмотреть общую картину или выгрузить ответы. Доступны только результаты вашей молодёжной группы.</p></div>{historyFiltersControl}<div className="archive-list">{filteredArchiveEntries.map(archived => <Glass className="archive-card results-library-card" key={archived.roomId}><div><p className="eyebrow">{getRoomModeTitle(archived).toUpperCase()} · {new Date(archived.createdAt).toLocaleDateString('ru-RU')}</p><h3>{archived.roomTitle || `Комната ${archived.roomId}`}</h3><p>{archived.groupName || 'Молодёжка не указана'} · {archived.city || 'Город не указан'}</p><p>Завершена: {archived.closedAt ? new Date(archived.closedAt).toLocaleString('ru-RU') : 'дата не указана'} · {archived.participantCount ?? Object.keys(archived.participants || {}).length} участников · {archived.completedCount ?? Object.values(archived.participants || {}).filter(person => person.status === 'finished').length} завершили</p></div><div className="archive-actions"><Button onClick={() => openArchivedResult(archived)}>Открыть результаты</Button><Button secondary onClick={() => exportCsv(archived, leader)}>Экспортировать CSV</Button></div></Glass>)}</div>{!archiveEntries.length && <Glass className="empty-state"><h3>Библиотека пока пуста</h3><p>Завершите первую комнату — её результаты и экспорт останутся здесь после обновления и повторного входа.</p></Glass>}{archiveEntries.length > 0 && !filteredArchiveEntries.length && <Glass className="empty-state"><h3>По фильтрам ничего не найдено</h3><p>Сбросьте поиск, формат или диапазон дат.</p></Glass>}</div>}
    {tab === 'export' && <div className="stack"><Glass className="export-panel"><p className="eyebrow">ВЫГРУЗКА ДАННЫХ</p><h2>Результаты сессии {room}</h2><p>CSV содержит сведения для анализа пилота: ведущий, молодёжка, город, формат, даты и агрегированные показатели комнаты. Личные ответы участников в общий экран не попадают.</p><Button onClick={() => exportCsv(session, leader)}>Скачать CSV</Button></Glass></div>}
    {tab === 'settings' && <div className="stack"><Glass className="settings-panel"><p className="eyebrow">ПОДКЛЮЧЕНИЕ ПО QR</p><h2>Адрес для участников</h2><p>Один и тот же адрес используется в QR-коде, под ним и в кнопке копирования. Для GitHub Pages базовый путь добавляется ровно один раз.</p><input value={publicOrigin} onChange={event => setPublicOrigin(event.target.value)} placeholder="https://ваш-сайт.web.app" /><small>Firebase: {firebaseReady ? 'подключён' : 'не настроен'}</small></Glass><Glass className="settings-panel"><p className="eyebrow">ОБРАТНАЯ СВЯЗЬ ПОСЛЕ ВСТРЕЧИ</p><h2>Google Form</h2><p>Вставьте ссылку на форму. После закрытия комнаты кнопка добавит roomId, workspaceId, groupName и hostUid как query parameters. Для заполнения конкретных полей Google Form используйте её pre-filled URL и подставьте в него маркеры {'{{roomId}}'}, {'{{workspaceId}}'}, {'{{groupName}}'}, {'{{hostUid}}'}.</p><input value={feedbackFormUrl} onChange={event => setFeedbackFormUrl(event.target.value)} placeholder="https://docs.google.com/forms/d/e/.../viewform" />{feedbackFormUrl && !feedbackUrl && <p className="connection-warning">Проверьте адрес Google Form: ссылка должна быть полной, начиная с https://.</p>}</Glass><Glass className="settings-panel"><p className="eyebrow">СЕССИЯ</p><h2>Завершение</h2><p>После завершения участники больше не смогут отвечать. Участники, ответы, результаты и экспорт останутся в архиве.</p><Button secondary disabled={session.phase === 'closed'} onClick={closeRoom}>{session.phase === 'closed' ? 'Комната завершена' : 'Завершить комнату'}</Button>{actionError && <p className="connection-warning">{actionError}</p>}</Glass></div>}
  </HostLayout>
}

function exportCsv(session: Session, leader: LeaderProfile) {
  const questionSet = getGameModule(session?.gameTypeId).getQuestions(session, questions)
  const scoring = resolveSessionScoring(session)
  const participantRecords = session.participants || {}
  const participantCount = session.participantCount ?? Object.keys(participantRecords).length
  const completedCount = session.completedCount ?? Object.values(participantRecords).filter(participant => participant.status === 'finished').length
  const common = [leader.fullName, leader.email, session.workspaceId || leader.workspaceId, session.hostUid, session.groupName || '', session.city || '', getRoomModeTitle(session), session.packId || '', session.packVersion || '', new Date(session.createdAt).toISOString(), session.startedAt ? new Date(session.startedAt).toISOString() : '', session.closedAt ? new Date(session.closedAt).toISOString() : '', session.estimatedParticipants ?? '', participantCount, completedCount]
  const rows = Object.values(participantRecords).map(participant => {
    const answers = participant.answers || {}
    const scores = getGameModule(session?.gameTypeId).score(answers, questionSet, session)
    return [...common, participant.id, participant.nickname, participant.status, ...questionSet.flatMap(question => { const selected = answers[question.id]; return [question.title, selected === 'SKIP' ? `Пропущен (${scoring.scoringMap.SKIP} балл.)` : selected ? question.options[selected] : ''] }), scores.total, ...Object.values(scores.categories)]
  })
  const headers = ['leaderName', 'leaderEmail', 'workspaceId', 'hostUid', 'groupName', 'city', 'mode', 'packId', 'packVersion', 'createdAt', 'startedAt', 'closedAt', 'estimatedParticipants', 'participantCount', 'completedCount', 'participantId', 'nickname', 'status', ...questionSet.flatMap((_, index) => [`Вопрос ${index + 1}`, `Ответ ${index + 1}`]), 'total', ...Object.values(categories)]
  const csv = [headers, ...rows].map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(';')).join('\n')
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `atmosfera-${session.roomId}.csv`; anchor.click(); URL.revokeObjectURL(url)
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
  if (!participant) return <MobileShell><p className="eyebrow">ПРОВЕРЬ СЕБЯ</p><h1>Проверь<br />себя</h1><p>Никнейм нужен только для твоей личной карточки. Реальное имя указывать не обязательно.</p><input value={name} onChange={event => setName(event.target.value)} placeholder="Например, «Свет»" maxLength={20} /><Button onClick={() => void join()}>Продолжить</Button>{notice && <p className="notice">{notice}</p>}</MobileShell>
  if (!session || session.phase === 'lobby') return <MobileShell><p className="eyebrow">ТЫ ПОДКЛЮЧЁН(А)</p><h1>Ждём ведущего</h1><p>Как только режим «Проверь себя» начнётся, первый вопрос появится здесь автоматически.</p><div className="waiting-dot" /></MobileShell>
  const openPersonal = async () => {
    if (!participant) return
    if (firebaseReady) await markPersonalViewed(room, participant.id)
    else if (session) { const next = { ...participant, personalViewedAt: Date.now() }; const nextSession = { ...session, participants: { ...session.participants, [participant.id]: next } }; setDemo(nextSession); setSession(nextSession); setParticipant(next) }
    setShowPersonal(true)
  }
  if (participant.status === 'finished' && showPersonal) return <PersonalResult participant={participant} scores={getGameModule(session?.gameTypeId).score(participant.answers || {}, getGameModule(session?.gameTypeId).getQuestions(session, questions), session)} onBack={() => setShowPersonal(false)} />
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
  return <main className="stage"><div className="stage-glow" /><p className="eyebrow">ПРОВЕРЬ СЕБЯ</p><h1>{session?.phase === 'lobby' ? 'Скоро начнём' : session?.phase === 'resultsIntro' ? 'Собираем общую картину' : session?.phase === 'resultsReal' ? 'Результаты готовы' : session ? 'Мы идём вместе' : 'Ожидаем комнату'}</h1><p className="stage-caption">{session?.phase === 'lobby' ? 'Участники подключаются по QR-коду.' : session?.phase === 'live' ? 'Каждый отвечает в своём темпе. Здесь — только общий прогресс.' : 'Спасибо каждому, кто ответил честно.'}</p><div className="stage-metrics"><Metric label="Подключились" value={people.length} note="участников" /><Metric label="Отвечают" value={people.filter(person => person.status === 'answering').length} note="в своём темпе" /><Metric label="Завершили" value={people.filter(person => person.status === 'finished').length} note="готовы к итогу" /></div><Glass className="stage-progress"><p>Общий прогресс</p><strong>{answers} <small>из {total} ответов</small></strong><div className="progress large"><i style={{ width: `${progress}%` }} /></div><span>{progress}%</span></Glass><small className="privacy">На этом экране отображаются только общие числа.</small></main>
}

function Results({ room, sessionOverride, embedded = false }: { room: string; sessionOverride?: Session | null; embedded?: boolean }) {
  const [liveSession] = useRoom(room)
  const session = sessionOverride || liveSession
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 250); return () => clearInterval(timer) }, [])
  const elapsed = session?.resultsIntroStartedAt ? now - session.resultsIntroStartedAt : 0
  const showReal = session?.phase === 'resultsReal' || elapsed >= 20000
  const people = Object.values(session?.participants || {})
  if (session?.mode === 'quiz' || session?.gameTypeId === quizGameTypeId) return <QuizResults session={session} embedded={embedded} />
  if (session?.mode === 'wheel' || session?.gameTypeId === 'wheel') {
    const WheelResults = getModeDefinition('wheel').mainScreen
    return WheelResults ? <div className={embedded ? 'results wheel-results' : 'wheel-results'}><WheelResults session={session} /></div> : <main className="results"><p>История игры недоступна.</p></main>
  }
  const real = useMemo(() => { if (!people.length) return { communication: 84, forgiveness: 71, service: 79, care: 68, honesty: 76 }; const game = getGameModule(session?.gameTypeId); const values = people.map(person => game.score(person.answers || {}, game.getQuestions(session, questions), session).categories); return Object.fromEntries(Object.keys(categories).map(key => [key, Math.round(values.reduce((sum, item) => sum + item[key as keyof typeof item], 0) / values.length)])) as Record<keyof typeof categories, number> }, [people, session?.gameTypeId, session?.questions, session?.templateSnapshot, session?.scoringTemplateId, session?.scoringTemplateVersion])
  const shown = showReal ? real : { communication: 96, forgiveness: 94, service: 97, care: 93, honesty: 95 }
  const overall = Math.round(Object.values(shown).reduce((a, b) => a + b, 0) / Object.keys(categories).length)
  const countdown = Math.max(0, Math.ceil((20000 - elapsed) / 1000))
  if (embedded) return <div className={`results ${showReal ? 'reveal' : 'intro'}`}><p className="eyebrow">ОБЩИЙ РЕЗУЛЬТАТ · {showReal ? 'РЕАЛЬНЫЕ ДАННЫЕ' : `ИДЕАЛЬНЫЙ ОРИЕНТИР · ${countdown} СЕК.`}</p><h1>{showReal ? 'Наша общая картина' : 'Какими мы можем быть вместе'}</h1>{!showReal && <div className="result-loader"><i /><span>Через несколько секунд увидим реальную картину группы</span></div>}<Glass className="result-board"><ResultRing value={overall} /><div className="result-bars">{Object.entries(shown).map(([id, value]) => <div key={id}><span>{categories[id as keyof typeof categories]}</span><b className={value < 0 ? 'negative' : ''}>{value}%</b><i><em style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></i></div>)}</div></Glass><p className="closing">Любовь и единство начинаются не с других, а лично с каждого из нас.</p></div>
  return <main className={`results ${showReal ? 'reveal' : 'intro'}`}><p className="eyebrow">ОБЩИЙ РЕЗУЛЬТАТ · {showReal ? 'РЕАЛЬНЫЕ ДАННЫЕ' : `ИДЕАЛЬНЫЙ ОРИЕНТИР · ${countdown} СЕК.`}</p><h1>{showReal ? 'Наша общая картина' : 'Какими мы можем быть вместе'}</h1>{!showReal && <div className="result-loader"><i /><span>Через несколько секунд увидим реальную картину группы</span></div>}<Glass className="result-board"><ResultRing value={overall} /><div className="result-bars">{Object.entries(shown).map(([id, value]) => <div key={id}><span>{categories[id as keyof typeof categories]}</span><b className={value < 0 ? 'negative' : ''}>{value}%</b><i><em style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></i></div>)}</div></Glass><p className="closing">Любовь и единство начинаются не с других, а лично с каждого из нас.</p><small className="privacy">Показаны только агрегированные результаты — без имён и личных ответов.</small></main>
  return <main className={`results ${showReal ? 'reveal' : 'intro'}`}><p className="eyebrow">ОБЩИЙ РЕЗУЛЬТАТ · {showReal ? 'РЕАЛЬНЫЕ ДАННЫЕ' : `ИДЕАЛЬНЫЙ ОРИЕНТИР · ${countdown} СЕК.`}</p><h1>{showReal ? 'Наша общая картина' : 'Какими мы можем быть вместе'}</h1>{!showReal && <div className="result-loader"><i /><span>Через несколько секунд увидим реальную картину группы</span></div>}<Glass className="result-board"><div className="big-score"><b>{Math.round(Object.values(shown).reduce((a, b) => a + b, 0) / Object.keys(categories).length)}%</b><span>общий ориентир</span></div><div className="result-bars">{Object.entries(shown).map(([id, value]) => <div key={id}><span>{categories[id as keyof typeof categories]}</span><b>{value}%</b><i><em style={{ width: `${value}%` }} /></i></div>)}</div></Glass><p className="closing">Любовь и единство начинаются не с других, а лично с каждого из нас.</p><small className="privacy">Показаны только агрегированные результаты — без имён и личных ответов.</small></main>
}

function RoomTabs({ active, session, onChange }: { active: RoomViewTab; session: Pick<Session, 'mode' | 'gameTypeId'>; onChange: (tab: RoomViewTab) => void }) {
  const items: Array<[RoomViewTab, string]> = [['overview', 'Обзор'], ['participants', 'Участники и QR'], ['results', getRoomResultsLabel(session)], ['export', 'Экспорт']]
  return <nav className="room-tabs" aria-label="Разделы текущей комнаты">{items.map(([id, label]) => <button type="button" className={active === id ? 'selected' : ''} onClick={() => onChange(id)} key={id}>{label}</button>)}</nav>
}

function QuizResults({ session, embedded }: { session: Session; embedded: boolean }) {
  const [scoreRecords, setScoreRecords] = useState<Record<string, import('./types').ParticipantQuizResult>>({})
  useEffect(() => subscribeRoomQuizResults(session.roomId, setScoreRecords), [session.roomId])
  const people = Object.values(session.participants || {})
  const rows = people.filter(person => person.status === 'finished').map(person => {
    const score = scoreRecords[person.id]
    return { person, correct: score?.correct || 0, total: score?.total || 0, percentage: score?.percentage || 0 }
  }).sort((left, right) => right.correct - left.correct || (left.person.completedAt || Number.MAX_SAFE_INTEGER) - (right.person.completedAt || Number.MAX_SAFE_INTEGER) || left.person.nickname.localeCompare(right.person.nickname, 'ru'))
  const content = <><p className="eyebrow">БИБЛЕЙСКАЯ ВИКТОРИНА · РЕЗУЛЬТАТЫ</p><h1>{session.roomTitle || session.packSnapshot?.title || 'Результаты викторины'}</h1><Glass className="quiz-results-board"><div><b>{rows.length}</b><span>завершили игру</span></div><ol>{rows.slice(0, 3).map((row, index) => <li key={row.person.id}><em>{index + 1}</em><span>{row.person.nickname}</span><strong>{row.correct} из {row.total} · {row.percentage}%</strong></li>)}</ol>{!rows.length && <p>Пока нет завершённых ответов.</p>}</Glass><p className="privacy">Показаны только никнеймы и итоговые баллы. Ответы участников не раскрываются.</p></>
  return embedded ? <div className="results quiz-results">{content}</div> : <main className="results quiz-results">{content}</main>
}

export default App
