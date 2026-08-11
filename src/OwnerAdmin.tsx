import { useEffect, useMemo, useState } from 'react'
import { categories, questions as starterQuestions } from './data/questions'
import { diagnosticGameTypeId, diagnosticProductId, isPlatformOwner, logoutLeader, saveGlobalPackAsOwner, setLeaderStatusAsOwner, subscribeAuthUser, subscribePlatformArchives, subscribePlatformFeedback, subscribePlatformGlobalPacks, subscribePlatformLeaders, subscribePlatformSessions, subscribePlatformWorkspaces } from './lib/firebase'
import { nextCategoryQuestionOrder, orderQuestionsByCategory } from './lib/questionOrder'
import type { ContentPack, FeedbackItem, LeaderProfile, Question, Session, SessionArchive, UserStatus, Workspace } from './types'

type OwnerTab = 'overview' | 'leaders' | 'packs' | 'sessions' | 'feedback'

const formatDate = (value?: number) => value ? new Date(value).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }) : '—'
const statusLabel: Record<UserStatus, string> = { pending: 'Ожидает', active: 'Активен', paused: 'Приостановлен', revoked: 'Отозван' }
const copyQuestions = (items: Question[]) => items.map(item => ({ ...item, options: { ...item.options } }))
const packIdFromTitle = (value: string) => `pack-${value.toLowerCase().replace(/[^a-zа-я0-9]+/gi, '-').replace(/(^-|-$)/g, '').slice(0, 36) || 'diagnostic'}-${Date.now().toString(36)}`

const OwnerButton = ({ children, secondary, danger, disabled, onClick }: { children: React.ReactNode; secondary?: boolean; danger?: boolean; disabled?: boolean; onClick?: () => void }) => <button type="button" className={`button owner-button ${secondary ? 'secondary' : ''} ${danger ? 'danger' : ''}`} disabled={disabled} onClick={onClick}>{children}</button>
const OwnerCard = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => <section className={`glass owner-card ${className}`}>{children}</section>

export function OwnerAdmin() {
  const [authState, setAuthState] = useState<'checking' | 'owner' | 'denied'>('checking')
  const [tab, setTab] = useState<OwnerTab>('overview')
  const [leaders, setLeaders] = useState<Record<string, LeaderProfile>>({})
  const [workspaces, setWorkspaces] = useState<Record<string, Workspace>>({})
  const [sessions, setSessions] = useState<Record<string, Session>>({})
  const [archives, setArchives] = useState<Record<string, SessionArchive>>({})
  const [packs, setPacks] = useState<Record<string, ContentPack>>({})
  const [feedback, setFeedback] = useState<Record<string, FeedbackItem>>({})
  const [selectedLeaderId, setSelectedLeaderId] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [sessionFilter, setSessionFilter] = useState({ leader: '', workspace: '', status: '', date: '' })
  const [packDraft, setPackDraft] = useState<ContentPack | null>(null)
  const [questionDraft, setQuestionDraft] = useState({ category: 'communication' as Question['category'], title: '', options: ['', '', '', ''] })

  useEffect(() => {
    let alive = true
    const stop = subscribeAuthUser(user => {
      if (!user || user.isAnonymous) { if (alive) setAuthState('denied'); return }
      void isPlatformOwner().then(owner => { if (alive) setAuthState(owner ? 'owner' : 'denied') }).catch(() => { if (alive) setAuthState('denied') })
    })
    return () => { alive = false; stop() }
  }, [])

  useEffect(() => {
    if (authState !== 'owner') return
    const onError = (reason: Error) => setError(reason.message)
    const stops = [
      subscribePlatformLeaders(setLeaders, onError),
      subscribePlatformWorkspaces(setWorkspaces, onError),
      subscribePlatformSessions(setSessions, onError),
      subscribePlatformArchives(setArchives, onError),
      subscribePlatformGlobalPacks(setPacks, onError),
      subscribePlatformFeedback(setFeedback, onError),
    ]
    return () => stops.forEach(stop => stop())
  }, [authState])

  const leaderList = useMemo(() => Object.values(leaders).sort((a, b) => b.createdAt - a.createdAt), [leaders])
  const sessionList = useMemo(() => Object.values(sessions).sort((a, b) => b.createdAt - a.createdAt), [sessions])
  const archiveList = useMemo(() => Object.values(archives).sort((a, b) => b.archivedAt - a.archivedAt), [archives])
  const feedbackList = useMemo(() => Object.values(feedback).sort((a, b) => b.createdAt - a.createdAt), [feedback])
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
      content: { questions: copyQuestions(starterQuestions) },
      settings: { maxParticipants: 30, skippedAnswerScore: -1 },
      ruleConfig: { allowSkip: true, answerMode: 'single-choice', questionOrder: 'fixed', scoringMode: 'diagnostic-3-2-1-0' },
      contentSchemaVersion: 1,
    })
  }

  const editPack = (pack: ContentPack) => {
    setPackDraft({ ...pack, content: { questions: copyQuestions(pack.content.questions) }, settings: { ...pack.settings }, ruleConfig: pack.ruleConfig ? { ...pack.ruleConfig } : undefined })
    setQuestionDraft({ category: 'communication', title: '', options: ['', '', '', ''] })
  }

  const savePack = async () => {
    if (!packDraft) return
    if (!packDraft.title.trim()) return setError('Введите название системного набора.')
    if (!packDraft.content.questions.length) return setError('В наборе должен быть хотя бы один вопрос.')
    setSaving(true); setError('')
    try { await saveGlobalPackAsOwner({ ...packDraft, title: packDraft.title.trim(), content: { questions: orderQuestionsByCategory(packDraft.content.questions) } }); setPackDraft(null) } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось сохранить набор.') } finally { setSaving(false) }
  }

  const addQuestion = () => {
    if (!packDraft) return
    if (!questionDraft.title.trim() || questionDraft.options.some(value => !value.trim())) return setError('Заполните текст вопроса и все четыре варианта ответа.')
    const categoryQuestions = packDraft.content.questions.filter(question => question.category === questionDraft.category)
    const question: Question = {
      id: `global-${Date.now().toString(36)}`,
      category: questionDraft.category,
      categoryOrder: nextCategoryQuestionOrder(packDraft.content.questions, questionDraft.category),
      title: questionDraft.title.trim(),
      options: { A: questionDraft.options[0].trim(), B: questionDraft.options[1].trim(), C: questionDraft.options[2].trim(), D: questionDraft.options[3].trim() },
    }
    setPackDraft({ ...packDraft, content: { questions: orderQuestionsByCategory([...packDraft.content.questions, question]) } })
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

  const tabs: Array<[OwnerTab, string]> = [['overview', 'Обзор'], ['leaders', 'Лидеры'], ['packs', 'Глобальная библиотека'], ['sessions', 'Сессии'], ['feedback', 'Feedback']]
  const filteredSessions = sessionList.filter(session => {
    const leader = leaders[session.hostUid]
    const workspace = workspaces[session.workspaceId || leader?.workspaceId || '']
    const date = new Date(session.createdAt).toISOString().slice(0, 10)
    return (!sessionFilter.leader || session.hostUid === sessionFilter.leader) && (!sessionFilter.workspace || workspace?.id === sessionFilter.workspace) && (!sessionFilter.status || session.phase === sessionFilter.status) && (!sessionFilter.date || date === sessionFilter.date)
  })

  return <main className="owner-shell"><aside className="owner-sidebar"><div className="brand"><span>✦</span><b>Атмосфера</b><small>владелец платформы</small></div><nav>{tabs.map(([id, label]) => <button type="button" key={id} className={tab === id ? 'selected' : ''} onClick={() => setTab(id)}>{label}</button>)}</nav><div className="owner-sidebar-foot"><small>Безопасная роль</small><b>platformAdmin</b><OwnerButton secondary onClick={() => void logoutLeader().then(() => { window.location.assign(`${import.meta.env.BASE_URL.replace(/\/$/, '')}/login`) })}>Выйти</OwnerButton></div></aside><section className="owner-content">{error && <p className="owner-error">{error}</p>}
    {tab === 'overview' && <><header className="owner-header"><div><p className="eyebrow">ПЛАТФОРМА · СВОДКА</p><h1>Обзор владельца</h1></div><span className="status">ЗАЩИЩЁННЫЙ ДОСТУП</span></header><div className="owner-metrics"><OwnerCard><small>Лидеры</small><b>{leaderList.length}</b><span>{leaderList.filter(item => item.status === 'active').length} активны</span></OwnerCard><OwnerCard><small>Активные комнаты</small><b>{activeRooms}</b><span>в реальном времени</span></OwnerCard><OwnerCard><small>Завершённые сессии</small><b>{archiveList.length}</b><span>история сохранена</span></OwnerCard><OwnerCard><small>Отзывы</small><b>{feedbackList.length}</b><span>собраны от лидеров</span></OwnerCard></div><OwnerCard className="owner-note"><h2>Что видно владельцу</h2><p>Здесь собрана только служебная сводка платформы. Кабинеты лидеров, их комнаты и личные наборы остаются изолированными друг от друга правилами Firebase.</p></OwnerCard></>}
    {tab === 'leaders' && <><header className="owner-header"><div><p className="eyebrow">ПОЛЬЗОВАТЕЛИ ПЛАТФОРМЫ</p><h1>Лидеры</h1></div></header><div className="owner-split"><OwnerCard className="owner-table-card"><div className="owner-table-scroll"><table className="owner-table"><thead><tr><th>Лидер</th><th>Телефон</th><th>Email</th><th>Молодёжка</th><th>Город</th><th>Регистрация</th><th>Активность</th><th>Статус</th></tr></thead><tbody>{leaderList.map(leader => <tr key={leader.uid} className={selectedLeaderId === leader.uid ? 'selected' : ''} onClick={() => setSelectedLeaderId(leader.uid)}><td>{leader.fullName}</td><td>{leader.phone}</td><td>{leader.email}</td><td>{workspaces[leader.workspaceId]?.name || '—'}</td><td>{workspaces[leader.workspaceId]?.city || '—'}</td><td>{formatDate(leader.createdAt)}</td><td>{formatDate(leader.lastActiveAt)}</td><td><span className={`owner-status ${leader.status}`}>{statusLabel[leader.status]}</span></td></tr>)}</tbody></table></div></OwnerCard>{selectedLeader && <OwnerCard className="leader-detail"><p className="eyebrow">КАРТОЧКА ЛИДЕРА</p><h2>{selectedLeader.fullName}</h2><dl><div><dt>Workspace</dt><dd>{selectedWorkspace?.name || selectedLeader.workspaceId}</dd></div><div><dt>Комнаты</dt><dd>{selectedSessions.length}</dd></div><div><dt>Участники</dt><dd>{selectedParticipants}</dd></div><div><dt>Feedback</dt><dd>{selectedFeedback.length}</dd></div></dl><div className="owner-actions"><OwnerButton disabled={saving || selectedLeader.status === 'active'} onClick={() => void performLeaderAction(selectedLeader.uid, 'active')}>Active / Restore</OwnerButton><OwnerButton secondary disabled={saving || selectedLeader.status === 'paused'} onClick={() => void performLeaderAction(selectedLeader.uid, 'paused')}>Pause</OwnerButton><OwnerButton danger disabled={saving || selectedLeader.status === 'revoked'} onClick={() => void performLeaderAction(selectedLeader.uid, 'revoked')}>Revoke</OwnerButton></div><p className="owner-help">Pause и Revoke сохраняют историю. Открытые комнаты автоматически переходят в <code>closed</code>, поэтому участники больше не могут отвечать.</p></OwnerCard>}</div></>}
    {tab === 'packs' && <><header className="owner-header"><div><p className="eyebrow">СИСТЕМНЫЙ КОНТЕНТ</p><h1>Глобальная библиотека</h1></div><OwnerButton onClick={createPack}>Создать набор</OwnerButton></header>{packDraft && <OwnerCard className="pack-editor"><p className="eyebrow">{packs[packDraft.packId] ? 'РЕДАКТИРОВАНИЕ' : 'НОВЫЙ НАБОР'}</p><div className="pack-editor-head"><label>Название<input value={packDraft.title} onChange={event => setPackDraft({ ...packDraft, title: event.target.value })} /></label><label>Статус<select value={packDraft.status || 'draft'} onChange={event => setPackDraft({ ...packDraft, status: event.target.value as ContentPack['status'] })}><option value="draft">Черновик</option><option value="active">Опубликован</option><option value="archived">Архив</option></select></label></div><p className="owner-help">Версия набора повышается при каждом сохранении. Уже созданные комнаты используют собственный неизменяемый snapshot.</p><div className="owner-question-add"><select value={questionDraft.category} onChange={event => setQuestionDraft({ ...questionDraft, category: event.target.value as Question['category'] })}>{Object.entries(categories).map(([id, title]) => <option key={id} value={id}>{title}</option>)}</select><input placeholder="Текст нового вопроса" value={questionDraft.title} onChange={event => setQuestionDraft({ ...questionDraft, title: event.target.value })} />{questionDraft.options.map((option, index) => <input key={index} placeholder={`Вариант ${String.fromCharCode(65 + index)}`} value={option} onChange={event => setQuestionDraft({ ...questionDraft, options: questionDraft.options.map((item, itemIndex) => itemIndex === index ? event.target.value : item) })} />)}<OwnerButton secondary onClick={addQuestion}>Добавить вопрос</OwnerButton></div><div className="owner-pack-questions">{Object.entries(categories).map(([id, label]) => <div key={id}><b>{label}</b><small>{packDraft.content.questions.filter(question => question.category === id).length} вопросов</small></div>)}</div><div className="owner-actions"><OwnerButton disabled={saving} onClick={() => void savePack()}>{saving ? 'Сохраняем…' : 'Сохранить'}</OwnerButton><OwnerButton secondary onClick={() => setPackDraft(null)}>Отмена</OwnerButton></div></OwnerCard>}<div className="owner-pack-list">{Object.values(packs).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).map(pack => <OwnerCard key={pack.packId} className="owner-pack-card"><div><p className="eyebrow">{pack.status === 'active' ? 'ОПУБЛИКОВАН' : pack.status === 'archived' ? 'АРХИВ' : 'ЧЕРНОВИК'} · v{pack.packVersion}</p><h2>{pack.title}</h2><p>{pack.content.questions.length} вопросов · обновлён {formatDate(pack.updatedAt)}</p></div><div className="owner-actions"><OwnerButton secondary onClick={() => editPack(pack)}>Изменить</OwnerButton><OwnerButton disabled={saving || pack.status === 'active'} onClick={() => void saveGlobalPackAsOwner({ ...pack, status: 'active' }).catch(reason => setError(reason.message))}>Опубликовать</OwnerButton><OwnerButton danger disabled={saving || pack.status === 'archived'} onClick={() => void saveGlobalPackAsOwner({ ...pack, status: 'archived' }).catch(reason => setError(reason.message))}>Архивировать</OwnerButton></div></OwnerCard>)}</div></>}
    {tab === 'sessions' && <><header className="owner-header"><div><p className="eyebrow">АКТИВНЫЕ И ЗАВЕРШЁННЫЕ</p><h1>Сессии</h1></div></header><OwnerCard className="owner-filters"><select value={sessionFilter.leader} onChange={event => setSessionFilter({ ...sessionFilter, leader: event.target.value })}><option value="">Все лидеры</option>{leaderList.map(item => <option value={item.uid} key={item.uid}>{item.fullName}</option>)}</select><select value={sessionFilter.workspace} onChange={event => setSessionFilter({ ...sessionFilter, workspace: event.target.value })}><option value="">Все молодёжки</option>{Object.values(workspaces).map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select><select value={sessionFilter.status} onChange={event => setSessionFilter({ ...sessionFilter, status: event.target.value })}><option value="">Все статусы</option><option value="lobby">Сбор</option><option value="live">Идёт</option><option value="closed">Завершена</option></select><input type="date" value={sessionFilter.date} onChange={event => setSessionFilter({ ...sessionFilter, date: event.target.value })} /></OwnerCard><div className="owner-session-list">{filteredSessions.map(session => <OwnerCard key={session.roomId} className="owner-session-card"><div><p className="eyebrow">{session.phase} · {formatDate(session.createdAt)}</p><h2>{session.roomTitle || session.roomId}</h2><p>{leaders[session.hostUid]?.fullName || session.hostUid} · {workspaces[session.workspaceId || '']?.name || '—'} · {Object.keys(session.participants || {}).length} участников</p></div><span className={`owner-status ${session.phase === 'closed' ? 'revoked' : 'active'}`}>{session.phase}</span></OwnerCard>)}</div></>}
    {tab === 'feedback' && <><header className="owner-header"><div><p className="eyebrow">ОБРАТНАЯ СВЯЗЬ</p><h1>Feedback</h1></div><OwnerButton disabled={!feedbackList.length} onClick={exportFeedback}>Скачать CSV</OwnerButton></header><div className="owner-feedback-list">{feedbackList.map(item => <OwnerCard key={item.id} className="owner-feedback-card"><p className="eyebrow">{formatDate(item.createdAt)} · {workspaces[item.workspaceId]?.name || 'Без workspace'}</p><h2>{leaders[item.uid]?.fullName || item.uid}</h2><p>{item.message}</p></OwnerCard>)}{!feedbackList.length && <OwnerCard><h2>Отзывов пока нет</h2><p>Когда в Firebase появятся записи в <code>feedback</code>, они сразу будут видны здесь и попадут в CSV.</p></OwnerCard>}</div></>}
  </section></main>
}
