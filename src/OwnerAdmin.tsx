import { useEffect, useMemo, useState } from 'react'
import { categories, questions as starterQuestions } from './data/questions'
import { diagnosticGameTypeId, diagnosticPackId, diagnosticProductId, isPlatformOwner, logoutLeader, publishSafePackCatalogueAsOwner, saveGlobalPackAsOwner, seedDefaultGlobalPack, setLeaderStatusAsOwner, subscribeAuthUser, subscribePlatformArchives, subscribePlatformFeedback, subscribePlatformGlobalPacks, subscribePlatformLeaders, subscribePlatformProducts, subscribePlatformSessions, subscribePlatformWorkspaceProducts, subscribePlatformWorkspaces } from './repositories/firebaseRepository'
import { nextCategoryQuestionOrder, orderQuestionsByCategory } from './lib/questionOrder'
import type { ContentPack, DiagnosticQuestion, FeedbackItem, LeaderProfile, ProductConfig, Question, Session, SessionArchive, UserStatus, Workspace, WorkspaceProduct } from './types'
import { OwnerProducts } from './OwnerProducts'
import { Button, Surface } from './components/DesignSystem'

type OwnerTab = 'overview' | 'leaders' | 'products' | 'packs' | 'sessions' | 'feedback'

const formatDate = (value?: number) => value ? new Date(value).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }) : '—'
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const validValues = <T,>(value: Record<string, T>) => Object.values(value || {}).filter(isRecord) as T[]
const byNewest = <T extends { createdAt?: number }>(a: T, b: T) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0)
const archiveByNewest = (a: SessionArchive, b: SessionArchive) => (Number(b.archivedAt) || 0) - (Number(a.archivedAt) || 0)
const calendarDate = (value: unknown) => {
  const date = new Date(Number(value))
  return Number.isNaN(date.valueOf()) ? '' : date.toISOString().slice(0, 10)
}
const statusLabel: Record<UserStatus, string> = { pending: 'Ожидает', active: 'Активен', paused: 'Приостановлен', revoked: 'Отозван' }
const copyQuestions = (items: Question[]) => items.map(item => ({ ...item, options: { ...item.options } }))
const packIdFromTitle = (value: string) => `pack-${value.toLowerCase().replace(/[^a-zа-я0-9]+/gi, '-').replace(/(^-|-$)/g, '').slice(0, 36) || 'diagnostic'}-${Date.now().toString(36)}`

const OwnerButton = ({ children, secondary, danger, disabled, onClick }: { children: React.ReactNode; secondary?: boolean; danger?: boolean; disabled?: boolean; onClick?: () => void }) => <Button type="button" className="owner-button" secondary={secondary} danger={danger} disabled={disabled} onClick={onClick}>{children}</Button>
const OwnerCard = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => <Surface className={`owner-card ${className}`}>{children}</Surface>

export function OwnerAdmin() {
  const [authState, setAuthState] = useState<'checking' | 'owner' | 'denied' | 'error'>('checking')
  const [authError, setAuthError] = useState('')
  const [dataState, setDataState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [tab, setTab] = useState<OwnerTab>('overview')
  const [leaders, setLeaders] = useState<Record<string, LeaderProfile>>({})
  const [workspaces, setWorkspaces] = useState<Record<string, Workspace>>({})
  const [sessions, setSessions] = useState<Record<string, Session>>({})
  const [archives, setArchives] = useState<Record<string, SessionArchive>>({})
  const [packs, setPacks] = useState<Record<string, ContentPack>>({})
  const [products, setProducts] = useState<Record<string, ProductConfig>>({})
  const [workspaceProducts, setWorkspaceProducts] = useState<Record<string, Record<string, WorkspaceProduct>>>({})
  const [feedback, setFeedback] = useState<Record<string, FeedbackItem>>({})
  const [selectedLeaderId, setSelectedLeaderId] = useState('')
  const [error, setError] = useState('')
  const [packNotice, setPackNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const [sessionFilter, setSessionFilter] = useState({ leader: '', workspace: '', status: '', date: '' })
  const [packDraft, setPackDraft] = useState<ContentPack | null>(null)
  const [questionDraft, setQuestionDraft] = useState({ category: 'communication' as DiagnosticQuestion['category'], title: '', options: ['', '', '', ''] })

  useEffect(() => {
    let alive = true
    const stop = subscribeAuthUser(user => {
      if (!user || user.isAnonymous) { if (alive) { setAuthError(''); setAuthState('denied') }; return }
      if (alive) { setAuthError(''); setAuthState('checking') }
      void isPlatformOwner().then(owner => { if (alive) setAuthState(owner ? 'owner' : 'denied') }).catch(reason => {
        if (!alive) return
        setAuthError(reason instanceof Error ? reason.message : 'Не удалось проверить Custom Claim владельца.')
        setAuthState('error')
      })
    })
    return () => { alive = false; stop() }
  }, [])

  useEffect(() => {
    if (authState !== 'owner') return
    let alive = true
    let completedSubscriptions = 0
    setDataState('loading')
    const onData = <T,>(setter: (value: T) => void) => (value: T) => {
      if (!alive) return
      setter(value)
      completedSubscriptions += 1
      if (completedSubscriptions >= 8) setDataState('ready')
    }
    const onError = (reason: Error) => {
      if (!alive) return
      setError(reason.message || 'Не удалось загрузить часть данных панели владельца.')
      setDataState('error')
    }
    const stops = [
      subscribePlatformLeaders(onData(setLeaders), onError),
      subscribePlatformWorkspaces(onData(setWorkspaces), onError),
      subscribePlatformSessions(onData(setSessions), onError),
      subscribePlatformArchives(onData(setArchives), onError),
      subscribePlatformGlobalPacks(onData(setPacks), onError),
      subscribePlatformFeedback(onData(setFeedback), onError),
      subscribePlatformProducts(onData(setProducts), onError),
      subscribePlatformWorkspaceProducts(onData(setWorkspaceProducts), onError),
    ]
    return () => { alive = false; stops.forEach(stop => stop()) }
  }, [authState])

  const leaderList = useMemo(() => validValues(leaders).sort(byNewest), [leaders])
  const sessionList = useMemo(() => validValues(sessions).filter(session => typeof session.roomId === 'string').sort(byNewest), [sessions])
  const archiveList = useMemo(() => validValues(archives).filter(archive => typeof archive.roomId === 'string').sort(archiveByNewest), [archives])
  const feedbackList = useMemo(() => validValues(feedback).filter(item => typeof item.id === 'string').sort(byNewest), [feedback])
  const selectedLeader = leaders[selectedLeaderId] || null
  const selectedWorkspace = selectedLeader ? workspaces[selectedLeader.workspaceId] : null
  const selectedSessions = selectedLeader ? sessionList.filter(item => item.hostUid === selectedLeader.uid) : []
  const selectedParticipants = selectedSessions.reduce((total, item) => total + Object.keys(item.participants || {}).length, 0)
  const selectedFeedback = selectedLeader ? feedbackList.filter(item => item.uid === selectedLeader.uid || item.workspaceId === selectedLeader.workspaceId) : []
  const activeRooms = sessionList.filter(item => item.phase !== 'closed').length

  const performLeaderAction = async (uid: string, status: UserStatus) => {
    setSaving(true); setError('')
    try { await setLeaderStatusAsOwner(uid, status) } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось изменить статус лидера.') } finally { setSaving(false) }
  }

  const createPack = () => {
    const title = 'Новый системный набор'
    setPackDraft({
      productId: diagnosticProductId,
      gameTypeId: diagnosticGameTypeId,
      packId: packIdFromTitle(title),
      packVersion: 0,
      status: 'draft',
      templateOrigin: 'system',
      title,
      description: 'Описание системного диагностического набора.',
      questions: copyQuestions(starterQuestions),
      content: { questions: copyQuestions(starterQuestions) },
      settings: { maxParticipants: 30, skippedAnswerScore: -1 },
      ruleConfig: { allowSkip: true, answerMode: 'single-choice', questionOrder: 'fixed', scoringMode: 'diagnostic-3-2-1-0' },
      contentSchemaVersion: 1,
    })
  }

  const seedSystemDiagnostic = async () => {
    setSaving(true); setError('')
    try { await seedDefaultGlobalPack() }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось создать системный диагностический набор.') }
    finally { setSaving(false) }
  }

  const publishSafeCatalogue = async () => {
    setSaving(true); setError(''); setPackNotice('')
    try {
      const synchronized = await publishSafePackCatalogueAsOwner()
      setPackNotice(`Опубликованы безопасные версии ${synchronized} наборов. Лидеры увидят только вопросы и варианты ответов, без ключей викторины.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось опубликовать безопасные версии наборов.')
    } finally { setSaving(false) }
  }

  const editPack = (pack: ContentPack) => {
    const packQuestions = copyQuestions(pack.questions?.length ? pack.questions : pack.content.questions)
    setPackDraft({ ...pack, questions: packQuestions, content: { questions: packQuestions }, settings: { ...pack.settings }, ruleConfig: pack.ruleConfig ? { ...pack.ruleConfig } : undefined })
    setQuestionDraft({ category: 'communication', title: '', options: ['', '', '', ''] })
  }

  const savePack = async () => {
    if (!packDraft) return
    if (!packDraft.title.trim()) return setError('Введите название системного набора.')
    if (!packDraft.content.questions.length) return setError('В наборе должен быть хотя бы один вопрос.')
    setSaving(true); setError('')
    try {
      const orderedQuestions = orderQuestionsByCategory(packDraft.content.questions)
      await saveGlobalPackAsOwner({ ...packDraft, title: packDraft.title.trim(), description: packDraft.description.trim(), questions: orderedQuestions, content: { questions: orderedQuestions } })
      setPackDraft(null)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось сохранить набор.') } finally { setSaving(false) }
  }

  const addQuestion = () => {
    if (!packDraft) return
    if (!questionDraft.title.trim() || questionDraft.options.some(value => !value.trim())) return setError('Заполните текст вопроса и все четыре варианта ответа.')
    const categoryQuestions = packDraft.content.questions.filter(question => question.category === questionDraft.category)
    const question: DiagnosticQuestion = {
      id: `global-${Date.now().toString(36)}`,
      category: questionDraft.category,
      categoryOrder: nextCategoryQuestionOrder(packDraft.content.questions, questionDraft.category),
      title: questionDraft.title.trim(),
      options: { A: questionDraft.options[0].trim(), B: questionDraft.options[1].trim(), C: questionDraft.options[2].trim(), D: questionDraft.options[3].trim() },
    }
    const nextQuestions = orderQuestionsByCategory([...packDraft.content.questions, question])
    setPackDraft({ ...packDraft, questions: nextQuestions, content: { questions: nextQuestions } })
    setQuestionDraft({ category: categoryQuestions.length ? questionDraft.category : 'communication', title: '', options: ['', '', '', ''] })
  }

  const exportFeedback = () => {
    const escape = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`
    const rows = [['Дата', 'Лидер', 'Молодёжка', 'Сообщение'], ...feedbackList.map(item => [formatDate(item.createdAt), leaders[item.uid]?.fullName || item.uid, workspaces[item.workspaceId]?.name || item.workspaceId, item.message])]
    const blob = new Blob(['\ufeff' + rows.map(row => row.map(escape).join(';')).join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'atmosphere-feedback.csv'; link.click(); URL.revokeObjectURL(url)
  }

  if (authState === 'checking') return <main className="auth-page"><OwnerCard className="owner-auth-card"><p className="eyebrow">ВЛАДЕЛЕЦ ПЛАТФОРМЫ</p><h1>Проверяем доступ…</h1></OwnerCard></main>
  if (authState === 'denied') return <main className="auth-page"><OwnerCard className="owner-auth-card"><p className="eyebrow">НЕТ ДОСТУПА</p><h1>Панель владельца недоступна</h1><p>Для входа требуется Firebase Custom Claim <code>platformAdmin: true</code>. URL и интерфейсные кнопки не дают этот доступ.</p><OwnerButton onClick={() => void logoutLeader().then(() => { window.location.assign(`${import.meta.env.BASE_URL.replace(/\/$/, '')}/login`) })}>Выйти</OwnerButton></OwnerCard></main>

  const tabs: Array<[OwnerTab, string]> = [['overview', 'Обзор'], ['leaders', 'Лидеры'], ['products', 'Продукты'], ['packs', 'Глобальная библиотека'], ['sessions', 'Сессии'], ['feedback', 'Feedback']]
  if (authState === 'error') return <main className="auth-page"><OwnerCard className="owner-auth-card"><p className="eyebrow">ОШИБКА ПРОВЕРКИ</p><h1>Не удалось открыть панель владельца</h1><p>{authError || 'Проверьте интернет-соединение и обновите страницу.'}</p><OwnerButton onClick={() => window.location.reload()}>Повторить проверку</OwnerButton><OwnerButton secondary onClick={() => void logoutLeader().then(() => { window.location.assign(`${import.meta.env.BASE_URL.replace(/\/$/, '')}/login`) })}>Выйти</OwnerButton></OwnerCard></main>

  const filteredSessions = sessionList.filter(session => {
    const leader = leaders[session.hostUid]
    const workspace = workspaces[session.workspaceId || leader?.workspaceId || '']
    const date = calendarDate(session.createdAt)
    return (!sessionFilter.leader || session.hostUid === sessionFilter.leader) && (!sessionFilter.workspace || workspace?.id === sessionFilter.workspace) && (!sessionFilter.status || session.phase === sessionFilter.status) && (!sessionFilter.date || date === sessionFilter.date)
  })

  return <main className="owner-shell"><aside className="owner-sidebar"><div className="brand"><span>✦</span><b>Атмосфера</b><small>владелец платформы</small></div><nav>{tabs.map(([id, label]) => <button type="button" key={id} className={tab === id ? 'selected' : ''} onClick={() => setTab(id)}>{label}</button>)}</nav><div className="owner-sidebar-foot"><small>Безопасная роль</small><b>platformAdmin</b><OwnerButton secondary onClick={() => void logoutLeader().then(() => { window.location.assign(`${import.meta.env.BASE_URL.replace(/\/$/, '')}/login`) })}>Выйти</OwnerButton></div></aside><section className="owner-content">{error && <p className="owner-error">{error}</p>}{dataState === 'loading' && <OwnerCard className="owner-note"><h2>Загружаем данные платформы…</h2><p>Панель останется доступной, даже если часть старых записей окажется неполной.</p></OwnerCard>}
    {tab === 'overview' && <><header className="owner-header"><div><p className="eyebrow">ПЛАТФОРМА · СВОДКА</p><h1>Обзор владельца</h1></div><span className="status">ЗАЩИЩЁННЫЙ ДОСТУП</span></header><div className="owner-metrics"><OwnerCard><small>Лидеры</small><b>{leaderList.length}</b><span>{leaderList.filter(item => item.status === 'active').length} активны</span></OwnerCard><OwnerCard><small>Активные комнаты</small><b>{activeRooms}</b><span>в реальном времени</span></OwnerCard><OwnerCard><small>Завершённые сессии</small><b>{archiveList.length}</b><span>история сохранена</span></OwnerCard><OwnerCard><small>Отзывы</small><b>{feedbackList.length}</b><span>собраны от лидеров</span></OwnerCard></div><OwnerCard className="owner-note"><h2>Что видно владельцу</h2><p>Здесь собрана только служебная сводка платформы. Кабинеты лидеров, их комнаты и личные наборы остаются изолированными друг от друга правилами Firebase.</p></OwnerCard></>}
    {tab === 'leaders' && <><header className="owner-header"><div><p className="eyebrow">ПОЛЬЗОВАТЕЛИ ПЛАТФОРМЫ</p><h1>Лидеры</h1></div></header><div className="owner-split"><OwnerCard className="owner-table-card"><div className="owner-table-scroll"><table className="owner-table"><thead><tr><th>Лидер</th><th>Телефон</th><th>Email</th><th>Молодёжка</th><th>Город</th><th>Регистрация</th><th>Активность</th><th>Статус</th></tr></thead><tbody>{leaderList.map(leader => <tr key={leader.uid} className={selectedLeaderId === leader.uid ? 'selected' : ''} onClick={() => setSelectedLeaderId(leader.uid)}><td>{leader.fullName}</td><td>{leader.phone}</td><td>{leader.email}</td><td>{workspaces[leader.workspaceId]?.name || '—'}</td><td>{workspaces[leader.workspaceId]?.city || '—'}</td><td>{formatDate(leader.createdAt)}</td><td>{formatDate(leader.lastActiveAt)}</td><td><span className={`owner-status ${leader.status}`}>{statusLabel[leader.status]}</span></td></tr>)}</tbody></table></div></OwnerCard>{selectedLeader && <OwnerCard className="leader-detail"><p className="eyebrow">КАРТОЧКА ЛИДЕРА</p><h2>{selectedLeader.fullName}</h2><dl><div><dt>Workspace</dt><dd>{selectedWorkspace?.name || selectedLeader.workspaceId}</dd></div><div><dt>Комнаты</dt><dd>{selectedSessions.length}</dd></div><div><dt>Участники</dt><dd>{selectedParticipants}</dd></div><div><dt>Feedback</dt><dd>{selectedFeedback.length}</dd></div></dl><div className="owner-actions"><OwnerButton disabled={saving || selectedLeader.status === 'active'} onClick={() => void performLeaderAction(selectedLeader.uid, 'active')}>Active / Restore</OwnerButton><OwnerButton secondary disabled={saving || selectedLeader.status === 'paused'} onClick={() => void performLeaderAction(selectedLeader.uid, 'paused')}>Pause</OwnerButton><OwnerButton danger disabled={saving || selectedLeader.status === 'revoked'} onClick={() => void performLeaderAction(selectedLeader.uid, 'revoked')}>Revoke</OwnerButton></div><p className="owner-help">Pause и Revoke сохраняют историю. Открытые комнаты автоматически переходят в <code>closed</code>, поэтому участники больше не могут отвечать.</p></OwnerCard>}</div></>}
    {tab === 'products' && <OwnerProducts products={products} workspaces={workspaces} workspaceProducts={workspaceProducts} saving={saving} onSaving={setSaving} onError={setError} />}
    {tab === 'packs' && <><header className="owner-header"><div><p className="eyebrow">СИСТЕМНЫЙ КОНТЕНТ</p><h1>Глобальная библиотека</h1></div><div className="owner-actions">{!packs[diagnosticPackId] && <OwnerButton secondary disabled={saving} onClick={() => void seedSystemDiagnostic()}>Добавить системные 70 вопросов</OwnerButton>}<OwnerButton secondary disabled={saving} onClick={() => void publishSafeCatalogue()}>Опубликовать безопасные версии</OwnerButton><OwnerButton onClick={createPack}>Создать набор</OwnerButton></div></header><OwnerCard className="owner-note"><h2>Стартовые наборы викторины</h2><p>Стартовое содержимое импортируется только защищённым серверным процессом, поэтому ключи правильных ответов не попадают в браузер. Эта панель публикует безопасную версию уже импортированных наборов для лидеров.</p>{packNotice && <p className="owner-help">{packNotice}</p>}</OwnerCard>{packDraft && <OwnerCard className="pack-editor"><p className="eyebrow">{packs[packDraft.packId] ? 'РЕДАКТИРОВАНИЕ' : 'НОВЫЙ НАБОР'}</p><div className="pack-editor-head"><label>Название<input value={packDraft.title} onChange={event => setPackDraft({ ...packDraft, title: event.target.value })} /></label><label>Статус<select value={packDraft.status || 'draft'} onChange={event => setPackDraft({ ...packDraft, status: event.target.value as ContentPack['status'] })}><option value="draft">Черновик</option><option value="active">Опубликован</option><option value="archived">Архив</option></select></label></div><p className="owner-help">Версия набора повышается при каждом сохранении. Уже созданные комнаты используют собственный неизменяемый snapshot.</p><div className="owner-question-add"><select value={questionDraft.category} onChange={event => setQuestionDraft({ ...questionDraft, category: event.target.value as DiagnosticQuestion['category'] })}>{Object.entries(categories).map(([id, title]) => <option key={id} value={id}>{title}</option>)}</select><input placeholder="Текст нового вопроса" value={questionDraft.title} onChange={event => setQuestionDraft({ ...questionDraft, title: event.target.value })} />{questionDraft.options.map((option, index) => <input key={index} placeholder={`Вариант ${String.fromCharCode(65 + index)}`} value={option} onChange={event => setQuestionDraft({ ...questionDraft, options: questionDraft.options.map((item, itemIndex) => itemIndex === index ? event.target.value : item) })} />)}<OwnerButton secondary onClick={addQuestion}>Добавить вопрос</OwnerButton></div><div className="owner-pack-questions">{Object.entries(categories).map(([id, label]) => <div key={id}><b>{label}</b><small>{packDraft.content.questions.filter(question => question.category === id).length} вопросов</small></div>)}</div><div className="owner-actions"><OwnerButton disabled={saving} onClick={() => void savePack()}>{saving ? 'Сохраняем…' : 'Сохранить'}</OwnerButton><OwnerButton secondary onClick={() => setPackDraft(null)}>Отмена</OwnerButton></div></OwnerCard>}<div className="owner-pack-list">{Object.values(packs).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).map(pack => <OwnerCard key={pack.packId} className="owner-pack-card"><div><p className="eyebrow">{pack.mode === 'quiz' ? 'ВИКТОРИНА · ' : ''}{pack.status === 'active' ? 'ОПУБЛИКОВАН' : pack.status === 'archived' ? 'АРХИВ' : 'ЧЕРНОВИК'} · v{pack.packVersion}</p><h2>{pack.title}</h2><p>{pack.content.questions.length} вопросов · обновлён {formatDate(pack.updatedAt)}</p></div><div className="owner-actions"><OwnerButton secondary onClick={() => editPack(pack)}>Изменить</OwnerButton><OwnerButton disabled={saving || pack.status === 'active'} onClick={() => void saveGlobalPackAsOwner({ ...pack, status: 'active' }).catch(reason => setError(reason.message))}>Опубликовать</OwnerButton><OwnerButton danger disabled={saving || pack.status === 'archived'} onClick={() => void saveGlobalPackAsOwner({ ...pack, status: 'archived' }).catch(reason => setError(reason.message))}>Архивировать</OwnerButton></div></OwnerCard>)}</div></>}
    {tab === 'sessions' && <><header className="owner-header"><div><p className="eyebrow">АКТИВНЫЕ И ЗАВЕРШЁННЫЕ</p><h1>Сессии</h1></div></header><OwnerCard className="owner-filters"><select value={sessionFilter.leader} onChange={event => setSessionFilter({ ...sessionFilter, leader: event.target.value })}><option value="">Все лидеры</option>{leaderList.map(item => <option value={item.uid} key={item.uid}>{item.fullName}</option>)}</select><select value={sessionFilter.workspace} onChange={event => setSessionFilter({ ...sessionFilter, workspace: event.target.value })}><option value="">Все молодёжки</option>{Object.values(workspaces).map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select><select value={sessionFilter.status} onChange={event => setSessionFilter({ ...sessionFilter, status: event.target.value })}><option value="">Все статусы</option><option value="lobby">Сбор</option><option value="live">Идёт</option><option value="closed">Завершена</option></select><input type="date" value={sessionFilter.date} onChange={event => setSessionFilter({ ...sessionFilter, date: event.target.value })} /></OwnerCard><div className="owner-session-list">{filteredSessions.map(session => <OwnerCard key={session.roomId} className="owner-session-card"><div><p className="eyebrow">{session.phase} · {formatDate(session.createdAt)}</p><h2>{session.roomTitle || session.roomId}</h2><p>{leaders[session.hostUid]?.fullName || session.hostUid} · {workspaces[session.workspaceId || '']?.name || '—'} · {Object.keys(session.participants || {}).length} участников</p></div><span className={`owner-status ${session.phase === 'closed' ? 'revoked' : 'active'}`}>{session.phase}</span></OwnerCard>)}</div></>}
    {tab === 'feedback' && <><header className="owner-header"><div><p className="eyebrow">ОБРАТНАЯ СВЯЗЬ</p><h1>Feedback</h1></div><OwnerButton disabled={!feedbackList.length} onClick={exportFeedback}>Скачать CSV</OwnerButton></header><div className="owner-feedback-list">{feedbackList.map(item => <OwnerCard key={item.id} className="owner-feedback-card"><p className="eyebrow">{formatDate(item.createdAt)} · {workspaces[item.workspaceId]?.name || 'Без workspace'}</p><h2>{leaders[item.uid]?.fullName || item.uid}</h2><p>{item.message}</p></OwnerCard>)}{!feedbackList.length && <OwnerCard><h2>Отзывов пока нет</h2><p>Когда в Firebase появятся записи в <code>feedback</code>, они сразу будут видны здесь и попадут в CSV.</p></OwnerCard>}</div></>}
  </section></main>
}
