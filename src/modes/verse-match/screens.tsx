import { useEffect, useState, type ReactNode } from 'react'
import QRCode from 'qrcode'
import type { ModeLandingScreenProps, ModeParticipantFlowProps, ModeSetupScreenProps } from '../contracts'
import type { ParticipantQuestionScreenProps } from '../participantTypes'
import { Button, LoadingState, StatusBadge, Surface } from '../../components/DesignSystem'
import { createJoinUrl } from '../../lib/urls'
import { go, queryRoom } from '../../core/navigation'
import {
  copyVerseMatchPack, createVerseMatchRoom, deleteVerseMatchPack, finishVerseMatchGame,
  getVerseMatchLibrary, joinVerseMatchRoom, nextVerseMatchRound, prepareVerseParticipantAuth,
  revealVerseMatchAnswer, saveVerseMatchPack, startVerseMatchGame, submitVerseMatchCard,
  subscribeVerseAudience, subscribeVerseHost, subscribeVerseParticipant,
} from './repository'
import type { VerseAudienceView, VerseCard, VerseDifficulty, VerseDirection, VerseEntry, VerseHostView, VersePack, VerseParticipantView, VerseResult } from './types'
import { countAvailableVerses, validateVersePack } from './validation'

const difficultyLabel: Record<VerseDifficulty, string> = { easy: 'Лёгкая', medium: 'Средняя', hard: 'Сложная' }
const directionLabel: Record<VerseDirection, string> = { ends: 'На карточках окончания', starts: 'На карточках начала', mixed: 'Смешанный режим 50/50' }
const blankEntry = (index: number): VerseEntry => ({ id: `verse-${Date.now()}-${index}`, bookId: 'PRO', book: 'Притчи', chapter: 1, verse: '1', reference: 'Притчи 1:1', translation: 'Синодальный перевод', fullText: '', start: '', end: '', difficulty: 'easy', enabled: true, verificationStatus: 'draft' })
const blankPack = (): VersePack => ({ packId: '', version: 1, title: 'Новый набор', description: '', translation: 'Синодальный перевод', sourceUrl: '', license: '', status: 'draft', entries: [] })
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Не удалось выполнить действие.'

function ResultsTable({ rows, interim }: { rows: VerseResult[]; interim: boolean }) {
  if (!rows.length) return <div className="verse-results-empty"><b>Результатов пока нет</b><p>Итоги появятся после обработки серверного состояния комнаты.</p></div>
  return <div className="verse-results-wrap"><table className="verse-results"><thead><tr><th>Место</th><th>Участник</th><th>Верно</th><th>Ошибки</th><th>Пропуски</th><th>Не разыграно</th></tr></thead><tbody>{rows.map(row => <tr key={row.participantId} className={row.perfect ? 'is-perfect' : ''}><td data-label="Место">{interim ? '—' : row.place === 1 ? '🏆 1' : row.place ?? '—'}</td><td data-label="Участник"><b>{row.nickname}</b></td><td data-label="Верно">{row.correct}/{row.total}</td><td data-label="Ошибки">{row.errors}</td><td data-label="Пропуски">{row.missed}</td><td data-label="Не разыграно">{row.remaining}</td></tr>)}</tbody></table></div>
}

function HostResults({ view }: { view: VerseHostView }) {
  const rows = view.results || []
  const winners = view.endedEarly ? [] : rows.filter(row => row.place === 1)
  const completedCards = rows.reduce((total, row) => total + row.correct + row.errors + row.missed, 0)
  const totalCards = rows.reduce((total, row) => total + row.total, 0)
  return <>
    <div className="verse-result-summary">
      <section><span>Участники</span><b>{rows.length || view.participants.length}</b></section>
      <section><span>Разыграно карточек</span><b>{completedCards}/{totalCards}</b></section>
      <section className="verse-winner-summary"><span>{view.endedEarly ? 'Статус' : winners.length > 1 ? 'Победители' : 'Победитель'}</span><b>{view.endedEarly ? 'Завершено досрочно' : winners.length ? winners.map(row => row.nickname).join(', ') : 'Первое место не присуждено'}</b></section>
    </div>
    <ResultsTable rows={rows} interim={view.endedEarly} />
  </>
}

const cardStatus: Record<VerseCard['status'], { icon: string; label: string }> = {
  correct: { icon: '✓', label: 'Правильно' },
  error: { icon: '!', label: 'Ошибка' },
  missed: { icon: '↷', label: 'Пропуск' },
  available: { icon: '○', label: 'Не разыграна' },
}

function PersonalResult({ view }: { view: VerseParticipantView }) {
  const [filter, setFilter] = useState<'all' | VerseCard['status']>('all')
  const result = view.result
  if (!result) return <LoadingState className="verse-result-loading" eyebrow="МОЙ РЕЗУЛЬТАТ" title="Загружаем подтверждённый итог…" description="Не подменяем отсутствующие серверные данные нулевыми значениями." />
  const cards = filter === 'all' ? view.cards : view.cards.filter(card => card.status === filter)
  const percentage = Math.max(0, Math.min(100, result.percentage))
  return <Surface className="verse-personal-result">
    <div className="verse-personal-heading"><div><p className="eyebrow">{view.endedEarly ? 'ИГРА ЗАВЕРШЕНА ДОСРОЧНО' : 'ЛИЧНЫЙ РЕЗУЛЬТАТ'}</p><h2>{view.nickname}</h2></div></div>
    <div className="verse-score-overview">
      <div className="verse-score-ring" role="img" aria-label={`${percentage} процентов правильных ответов`}>
        <svg viewBox="0 0 120 120" aria-hidden="true"><circle className="verse-score-track" cx="60" cy="60" r="52" pathLength="100" /><circle className="verse-score-progress" cx="60" cy="60" r="52" pathLength="100" style={{ opacity: percentage === 0 ? 0 : 1, strokeDasharray: `${percentage} 100` }} /></svg>
        <div><b>{percentage}%</b><span>правильно</span></div>
      </div>
      <div className="verse-score-copy"><strong>Правильно собрано {result.correct} из {result.total} стихов</strong><p>{view.endedEarly ? 'Игра завершена досрочно. Неразыгранные карточки сохранены отдельно.' : result.correct === result.total ? 'Все выданные карточки собраны правильно.' : 'Ниже можно посмотреть итог каждой выданной карточки.'}</p></div>
    </div>
    <div className="verse-personal-metrics">
      <section><span>Выдано</span><b>{result.total}</b></section>
      <section className="status-correct"><span>Правильно</span><b>{result.correct}</b></section>
      <section className="status-error"><span>Ошибки</span><b>{result.errors}</b></section>
      <section className="status-missed"><span>Пропуски</span><b>{result.missed}</b></section>
      <section className="status-available"><span>Не разыграно</span><b>{result.remaining}</b></section>
      {!view.endedEarly && result.place != null && <section className="status-place"><span>Место</span><b>{result.place}</b></section>}
    </div>
    <div className="verse-result-cards-head"><div><h3>Мои карточки</h3><p>Полный текст и сохранённый итог каждой карточки.</p></div><label>Показать<select value={filter} onChange={event => setFilter(event.target.value as 'all' | VerseCard['status'])}><option value="all">Все</option><option value="correct">Правильно</option><option value="error">Ошибки</option><option value="missed">Пропуски</option><option value="available">Не разыграны</option></select></label></div>
    <div className="verse-result-card-list">{cards.map(card => { const status = cardStatus[card.status]; return <article key={card.cardId} className={`verse-result-card status-${card.status}`}><header><span aria-hidden="true">{status.icon}</span><b>{status.label}</b><small>{card.direction === 'end' ? 'Окончание' : 'Начало'}</small></header>{card.fullText ? <blockquote>{card.fullText}</blockquote> : <p>Полный текст не сохранён для этой карточки.</p>}{card.reference && <strong>{card.reference}</strong>}{card.status === 'error' && card.attemptPromptText && <div className="verse-attempt-fragment"><small>Фрагмент в раунде ошибочной попытки</small><p>{card.attemptPromptText}</p></div>}</article> })}</div>
    {!cards.length && <div className="verse-results-empty"><b>Нет карточек с таким итогом</b><p>Выберите другой фильтр.</p></div>}
  </Surface>
}

function ParticipantActionDock({ children }: { children: ReactNode }) {
  return <div className="verse-participant-action"><div>{children}</div></div>
}

export function VerseMatchLibraryPanel({ admin = false }: { admin?: boolean }) {
  const [system, setSystem] = useState<VersePack[]>([]); const [workspace, setWorkspace] = useState<VersePack[]>([])
  const [editing, setEditing] = useState<VersePack | null>(null); const [selectedEntry, setSelectedEntry] = useState(0)
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [notice, setNotice] = useState(''); const [error, setError] = useState('')
  const load = async () => { setLoading(true); setError(''); try { const library = await getVerseMatchLibrary(); setSystem(library.system); setWorkspace(library.workspace) } catch (reason) { setError(errorText(reason)) } finally { setLoading(false) } }
  useEffect(() => { void load() }, [])
  const updateEntry = (patch: Partial<VerseEntry>) => setEditing(current => current ? ({ ...current, entries: current.entries.map((entry, index) => index === selectedEntry ? { ...entry, ...patch } : entry) }) : current)
  const validation = editing ? validateVersePack(editing) : null
  const save = async () => {
    if (!editing) return; setBusy(true); setError(''); setNotice('')
    try { const result = await saveVerseMatchPack(admin ? 'system' : 'workspace', editing); setEditing(result.pack); setNotice('Набор сохранён.'); await load() } catch (reason) { setError(errorText(reason)) } finally { setBusy(false) }
  }
  if (loading) return <LoadingState eyebrow="БИБЛИОТЕКА" title="Загружаем наборы…" />
  return <div className="verse-library">
    <div className="verse-library-toolbar"><div><h3>{admin ? 'Общая библиотека стихов' : 'Наборы «Собери стих»'}</h3><p>{admin ? 'Публикуйте только проверенные тексты.' : 'Скопируйте общий набор или создайте собственный.'}</p></div><Button secondary onClick={() => { setEditing(blankPack()); setSelectedEntry(0) }}>Новый набор</Button></div>
    {error && <p className="connection-warning" role="alert">{error}</p>}{notice && <p className="verse-success">{notice}</p>}
    <div className="verse-pack-grid">
      {system.map(pack => <Surface className="verse-pack-card" key={`system-${pack.packId}`}><StatusBadge>{pack.status === 'published' ? 'ОПУБЛИКОВАН' : 'ЧЕРНОВИК'}</StatusBadge><h4>{pack.title}</h4><p>{pack.entries.length} стихов · версия {pack.version}</p><div className="verse-inline-actions">{admin ? <Button secondary onClick={() => { setEditing(structuredClone(pack)); setSelectedEntry(0) }}>Редактировать</Button> : <Button secondary disabled={busy} onClick={() => { setBusy(true); void copyVerseMatchPack(pack.packId).then(() => { setNotice('Копия добавлена в ваши наборы.'); return load() }).catch(reason => setError(errorText(reason))).finally(() => setBusy(false)) }}>Скопировать</Button>}</div></Surface>)}
      {!admin && workspace.map(pack => <Surface className="verse-pack-card" key={`workspace-${pack.packId}`}><StatusBadge tone="muted">МОЙ НАБОР</StatusBadge><h4>{pack.title}</h4><p>{pack.entries.length} стихов · {pack.status}</p><div className="verse-inline-actions"><Button secondary onClick={() => { setEditing(structuredClone(pack)); setSelectedEntry(0) }}>Редактировать</Button><Button danger disabled={busy} onClick={() => { if (!window.confirm(`Удалить набор «${pack.title}»?`)) return; setBusy(true); void deleteVerseMatchPack(pack.packId).then(load).catch(reason => setError(errorText(reason))).finally(() => setBusy(false)) }}>Удалить</Button></div></Surface>)}
    </div>
    {editing && <Surface className="verse-editor"><div className="verse-editor-head"><div><p className="eyebrow">РЕДАКТОР НАБОРА</p><h3>{editing.title}</h3></div><Button secondary onClick={() => setEditing(null)}>Закрыть</Button></div>
      <div className="verse-form-grid"><label>Название<input value={editing.title} onChange={event => setEditing({ ...editing, title: event.target.value })} /></label><label>Статус<select value={editing.status} onChange={event => setEditing({ ...editing, status: event.target.value as VersePack['status'] })}><option value="draft">Черновик</option><option value="published">Опубликован</option><option value="archived">Архив</option></select></label><label className="wide">Описание<textarea value={editing.description} onChange={event => setEditing({ ...editing, description: event.target.value })} /></label><label>Перевод<input value={editing.translation} onChange={event => setEditing({ ...editing, translation: event.target.value })} /></label><label>Лицензия<input value={editing.license} onChange={event => setEditing({ ...editing, license: event.target.value })} /></label><label className="wide">Источник<input value={editing.sourceUrl} onChange={event => setEditing({ ...editing, sourceUrl: event.target.value })} /></label></div>
      <div className="verse-entry-layout"><aside><div className="verse-entry-list-head"><b>Стихи ({editing.entries.length})</b><button type="button" onClick={() => { setEditing({ ...editing, entries: [...editing.entries, blankEntry(editing.entries.length)] }); setSelectedEntry(editing.entries.length) }}>+ Добавить</button></div>{editing.entries.map((entry, index) => <button type="button" className={index === selectedEntry ? 'selected' : ''} key={`${entry.id}-${index}`} onClick={() => setSelectedEntry(index)}>{entry.reference || `Стих ${index + 1}`}<small>{difficultyLabel[entry.difficulty]} · {entry.verificationStatus}</small></button>)}</aside>
        {editing.entries[selectedEntry] ? <div className="verse-entry-form"><div className="verse-form-grid"><label>ID<input value={editing.entries[selectedEntry].id} onChange={event => updateEntry({ id: event.target.value })} /></label><label>Ссылка<input value={editing.entries[selectedEntry].reference} onChange={event => updateEntry({ reference: event.target.value })} /></label><label>Книга<input value={editing.entries[selectedEntry].book} onChange={event => updateEntry({ book: event.target.value })} /></label><label>Код книги<input value={editing.entries[selectedEntry].bookId} onChange={event => updateEntry({ bookId: event.target.value })} /></label><label>Глава<input type="number" min="1" value={editing.entries[selectedEntry].chapter} onChange={event => updateEntry({ chapter: Number(event.target.value) })} /></label><label>Стих<input value={editing.entries[selectedEntry].verse} onChange={event => updateEntry({ verse: event.target.value })} /></label><label className="wide">Полный текст<textarea value={editing.entries[selectedEntry].fullText} onChange={event => updateEntry({ fullText: event.target.value })} /></label><label className="wide">Начало<textarea value={editing.entries[selectedEntry].start} onChange={event => updateEntry({ start: event.target.value })} /></label><label className="wide">Окончание<textarea value={editing.entries[selectedEntry].end} onChange={event => updateEntry({ end: event.target.value })} /></label><label>Сложность<select value={editing.entries[selectedEntry].difficulty} onChange={event => updateEntry({ difficulty: event.target.value as VerseDifficulty })}>{Object.entries(difficultyLabel).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label><label>Проверка<select value={editing.entries[selectedEntry].verificationStatus} onChange={event => updateEntry({ verificationStatus: event.target.value as VerseEntry['verificationStatus'] })}><option value="draft">Не проверен</option><option value="verified">Проверен</option><option value="rejected">Отклонён</option></select></label><label className="verse-check"><input type="checkbox" checked={editing.entries[selectedEntry].enabled} onChange={event => updateEntry({ enabled: event.target.checked })} /> Включён</label></div><Button danger onClick={() => { const entries = editing.entries.filter((_, index) => index !== selectedEntry); setEditing({ ...editing, entries }); setSelectedEntry(Math.max(0, selectedEntry - 1)) }}>Удалить стих</Button></div> : <p>Добавьте первый стих.</p>}</div>
      <div className="verse-validation"><b>{validation?.valid ? '✓ Набор прошёл локальную проверку' : `Найдено проблем: ${validation?.issues.length || 0}`}</b>{validation?.issues.slice(0, 8).map((issue, index) => <span key={`${issue.path}-${index}`}>{issue.path}: {issue.message}</span>)}</div><Button disabled={busy || (editing.status === 'published' && !validation?.valid)} onClick={() => void save()}>{busy ? 'Сохраняем…' : 'Сохранить набор'}</Button>
    </Surface>}
  </div>
}

export function VerseLandingScreen({ onSetup }: ModeLandingScreenProps) {
  const [archives, setArchives] = useState<VerseHostView[]>([])
  useEffect(() => { void getVerseMatchLibrary().then(value => setArchives(value.archives || [])).catch(() => undefined) }, [])
  return <div className="verse-landing"><Surface className="mode-intro verse-intro"><p className="eyebrow">БИБЛЕЙСКАЯ КОМАНДНАЯ ИГРА</p><h2>Собери стих</h2><p>Участники получают уникальные начала или окончания стихов и на скорость находят пару к фрагменту на общем экране.</p><ol><li>Выберите проверенный набор и сложность.</li><li>Раздача и проверка проходят только на сервере.</li><li>Первое место получают только участники без единой ошибки или пропуска.</li></ol><Button onClick={onSetup}>Создать комнату</Button></Surface>
    {archives.length > 0 && <Surface className="verse-archive"><p className="eyebrow">ИСТОРИЯ ИГР</p><h3>Сохранённые результаты</h3><div className="verse-archive-list">{archives.map(item => <button type="button" key={item.roomId} onClick={() => go(`/verse-host?room=${item.roomId}`)}><span><b>{item.title}</b><small>{new Date(item.closedAt || item.completedAt || item.createdAt).toLocaleString('ru-RU')} · {item.participants.length} участников</small></span><strong>Открыть →</strong></button>)}</div></Surface>}
    <VerseMatchLibraryPanel /></div>
}

export function VerseSetupScreen({ onBack, defaultTitle, onCreated }: ModeSetupScreenProps) {
  const [packs, setPacks] = useState<VersePack[]>([]); const [packId, setPackId] = useState(''); const [title, setTitle] = useState(defaultTitle || 'Собери стих')
  const [difficulty, setDifficulty] = useState<VerseDifficulty>('easy'); const [cards, setCards] = useState<5 | 7 | 10>(5); const [direction, setDirection] = useState<VerseDirection>('ends')
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  useEffect(() => { void getVerseMatchLibrary().then(value => { const available = [...value.system, ...value.workspace].filter(pack => pack.status === 'published'); setPacks(available); setPackId(available[0]?.packId || '') }).catch(reason => setError(errorText(reason))).finally(() => setLoading(false)) }, [])
  const pack = packs.find(item => item.packId === packId); const available = pack ? countAvailableVerses(pack, difficulty) : 0; const maxPlayers = Math.floor(available / cards)
  if (loading) return <LoadingState eyebrow="СОБЕРИ СТИХ" title="Загружаем наборы…" />
  return <Surface className="verse-setup"><div className="verse-form-grid"><label className="wide">Название комнаты<input value={title} maxLength={80} onChange={event => setTitle(event.target.value)} /></label><label className="wide">Набор<select value={packId} onChange={event => setPackId(event.target.value)}>{packs.map(item => <option key={item.packId} value={item.packId}>{item.title} · v{item.version}</option>)}</select></label><label>Сложность<select value={difficulty} onChange={event => setDifficulty(event.target.value as VerseDifficulty)}>{Object.entries(difficultyLabel).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label><label>Карточек игроку<select value={cards} onChange={event => setCards(Number(event.target.value) as 5 | 7 | 10)}><option value="5">5</option><option value="7">7</option><option value="10">10</option></select></label><label className="wide">Направление<select value={direction} onChange={event => setDirection(event.target.value as VerseDirection)}>{Object.entries(directionLabel).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label></div>
    <div className="verse-capacity"><b>{available} проверенных стихов</b><span>Вместимость: до {maxPlayers} участников · раундов на игрока: {cards}</span>{maxPlayers < 1 && <p className="connection-warning">В выбранной сложности недостаточно стихов.</p>}</div>{error && <p className="connection-warning">{error}</p>}<div className="verse-inline-actions"><Button secondary onClick={onBack}>Назад</Button><Button disabled={busy || !packId || maxPlayers < 1} onClick={() => { setBusy(true); setError(''); void createVerseMatchRoom({ title, packId, difficulty, cardsPerPlayer: cards, direction }).then(({ roomId }) => onCreated?.(roomId, `/verse-host?room=${roomId}`)).catch(reason => setError(errorText(reason))).finally(() => setBusy(false)) }}>{busy ? 'Создаём…' : 'Создать комнату'}</Button></div>
  </Surface>
}

export function VerseHostPage({ room }: { room: string }) {
  const [view, setView] = useState<VerseHostView | null>(null); const [qr, setQr] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [loadState, setLoadState] = useState<'loading' | 'open' | 'not-found' | 'forbidden' | 'error'>('loading'); const [retry, setRetry] = useState(0)
  const joinUrl = createJoinUrl(room)
  useEffect(() => {
    if (!room) { setLoadState('not-found'); return }
    setLoadState('loading'); setError('')
    return subscribeVerseHost(room, value => { setView(value); setLoadState(value ? 'open' : 'not-found') }, reason => { setError(reason.message); setLoadState(/permission/i.test(reason.message) ? 'forbidden' : 'error') })
  }, [retry, room])
  useEffect(() => { void QRCode.toDataURL(joinUrl, { width: 320, margin: 1, errorCorrectionLevel: 'M' }).then(setQr) }, [joinUrl])
  const act = (operation: () => Promise<unknown>) => { setBusy(true); setError(''); void operation().catch(reason => setError(errorText(reason))).finally(() => setBusy(false)) }
  if (loadState === 'loading') return <main className="verse-page"><LoadingState eyebrow="СОБЕРИ СТИХ" title="Подключаем комнату…" description="Проверяем доступ и загружаем актуальное состояние." /></main>
  if (!view) return <main className="verse-page"><Surface className="verse-room-state"><p className="eyebrow">СОБЕРИ СТИХ</p><h1>{loadState === 'not-found' ? 'Комната не найдена' : loadState === 'forbidden' ? 'Нет доступа к комнате' : 'Ошибка подключения'}</h1><p>{loadState === 'not-found' ? 'Проверьте код комнаты. Новая комната не создавалась.' : loadState === 'forbidden' ? 'Войдите под ведущим, который создал эту комнату.' : error || 'Не удалось получить данные комнаты.'}</p><div className="verse-inline-actions"><Button onClick={() => setRetry(value => value + 1)}>Повторить</Button><Button secondary onClick={() => go('/host?tab=verse-match')}>Вернуться в режим</Button></div></Surface></main>
  const round = view.currentRound; const canStart = view.participants.length > 0 && view.capacity.available >= view.capacity.required
  return <main className="verse-page verse-host"><header className="verse-page-header"><div><p className="eyebrow">СОБЕРИ СТИХ · DEV PREVIEW</p><h1>{view.title}</h1><p>Код комнаты <strong>{view.roomId}</strong> · {view.pack.title} · {difficultyLabel[view.config.difficulty]}</p></div><div className="verse-inline-actions"><Button secondary onClick={() => window.open(`/verse-stage?room=${room}`, 'verse-stage')}>Экран аудитории</Button><Button secondary onClick={() => go('/host?tab=main')}>В панель</Button></div></header>
    {error && <p className="connection-warning">{error}</p>}
    {view.phase === 'lobby' && <div className="verse-host-grid"><Surface className="verse-qr"><img src={qr} alt="QR-код комнаты" /><code>{joinUrl}</code><Button secondary onClick={() => void navigator.clipboard.writeText(joinUrl)}>Скопировать ссылку</Button></Surface><Surface><p className="eyebrow">ЛОББИ</p><h2>{view.participants.length} участников</h2><p>Требуется {view.capacity.required} из {view.capacity.available} стихов. Максимум для настроек: {view.capacity.maxPlayers} игроков.</p><ul className="verse-people">{view.participants.map(person => <li key={person.id}><b>{person.nickname}</b><span>готов</span></li>)}</ul><Button disabled={busy || !canStart} onClick={() => act(() => startVerseMatchGame(room))}>Начать игру</Button>{!canStart && view.participants.length > 0 && <p className="connection-warning">Уменьшите число игроков/карточек или выберите более крупный набор.</p>}</Surface></div>}
    {view.phase === 'live' && <><div className="verse-metrics"><Surface><b>{view.roundNumber}</b><span>текущий раунд</span></Surface><Surface><b>{view.remainingCards}</b><span>карточек осталось</span></Surface><Surface><b>{view.history.length}</b><span>завершено</span></Surface></div><Surface className={`verse-prompt ${round?.status === 'revealed' ? 'is-revealed' : ''}`}><p className="eyebrow">{round?.status === 'revealed' ? 'ОТВЕТ' : round?.promptDirection === 'start' ? 'НАЙДИТЕ НАЧАЛО' : 'НАЙДИТЕ ОКОНЧАНИЕ'}</p>{round?.status === 'revealed' ? <><blockquote>{round.fullText}</blockquote><h3>{round.reference}</h3><p>{round.outcome === 'correct' ? `Верно${round.answeredByName ? ` · ${round.answeredByName}` : ''}` : 'Ответ не найден'}</p><Button disabled={busy} onClick={() => act(() => nextVerseMatchRound(room))}>Следующий раунд</Button></> : <><blockquote>{round?.promptText}</blockquote><p>Участники выбирают подходящую карточку на своих устройствах.</p><Button secondary disabled={busy} onClick={() => act(() => revealVerseMatchAnswer(room))}>Показать ответ</Button></>}</Surface><Surface><h3>Живой прогресс</h3><div className="verse-progress-list">{view.participants.map(person => <div key={person.id}><b>{person.nickname}</b><span>✓ {person.correct} · ошибки {person.errors} · пропуски {person.missed} · осталось {person.remaining}</span></div>)}</div><Button danger disabled={busy} onClick={() => { if (window.confirm('Завершить игру досрочно? Рейтинг останется промежуточным.')) act(() => finishVerseMatchGame(room, true)) }}>Завершить досрочно</Button></Surface></>}
    {(view.phase === 'completed' || view.phase === 'closed') && <Surface className="verse-final"><div className="verse-final-heading"><div><p className="eyebrow">{view.endedEarly ? 'ПРОМЕЖУТОЧНЫЕ РЕЗУЛЬТАТЫ' : 'ИГРА ЗАВЕРШЕНА'}</p><h2>{view.endedEarly ? 'Игра остановлена досрочно' : `Итоги «${view.title}»`}</h2><p>{view.endedEarly ? 'Места не рассчитываются: неразыгранные карточки сохранены отдельно.' : 'Победители определены по действующим правилам режима.'}</p></div><StatusBadge tone={view.endedEarly ? 'muted' : 'accent'}>{view.endedEarly ? 'ДОСРОЧНО' : 'ЗАВЕРШЕНО'}</StatusBadge></div><HostResults view={view} />{view.phase === 'completed' && <div className="verse-final-actions"><Button onClick={() => act(() => finishVerseMatchGame(room, false))}>Закрыть и сохранить комнату</Button></div>}</Surface>}
  </main>
}

export function VerseParticipantFlow({ room }: ModeParticipantFlowProps) {
  const [uid, setUid] = useState(''); const [view, setView] = useState<VerseParticipantView | null>(null); const [nickname, setNickname] = useState(''); const [selected, setSelected] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [loaded, setLoaded] = useState(false); const [retry, setRetry] = useState(0); const [showResult, setShowResult] = useState(false)
  useEffect(() => { let stop: (() => void) | undefined; setLoaded(false); setError(''); void prepareVerseParticipantAuth().then(id => { setUid(id); stop = subscribeVerseParticipant(room, id, value => { setView(value); setLoaded(true) }, reason => { setError(reason.message); setLoaded(true) }) }).catch(reason => { setError(errorText(reason)); setLoaded(true) }); return () => stop?.() }, [retry, room])
  useEffect(() => { if (view?.phase !== 'completed' && view?.phase !== 'closed') setShowResult(false) }, [view?.phase])
  const available = view?.cards.filter(card => card.status === 'available') || []; const closed = view?.cards.filter(card => card.status !== 'available') || []
  const submit = () => { if (!view?.currentRound || !selected) return; setBusy(true); setError(''); void submitVerseMatchCard(room, selected, view.currentRound.roundId, view.currentRound.version).then(result => { if (!result.correct) setError('Не совпало. Эта карточка закрыта — попробуйте другую в следующем раунде.'); setSelected('') }).catch(reason => setError(errorText(reason))).finally(() => setBusy(false)) }
  if (!loaded || (!uid && !error)) return <main className="verse-participant"><LoadingState eyebrow="СОБЕРИ СТИХ" title="Подключаем…" description="Восстанавливаем участника и состояние комнаты." /></main>
  if (!view && error) return <main className="verse-participant"><Surface className="verse-room-state"><p className="eyebrow">КОМНАТА {room}</p><h1>Не удалось подключиться</h1><p>{error}</p><Button onClick={() => setRetry(value => value + 1)}>Повторить</Button></Surface></main>
  if (!view) return <main className="verse-participant"><Surface className="verse-join"><p className="eyebrow">КОМНАТА {room}</p><h1>Собери стих</h1><p>Введите имя. После старта вы получите уникальные карточки.</p><form onSubmit={event => { event.preventDefault(); if (nickname.trim().length < 2) return; setBusy(true); setError(''); void joinVerseMatchRoom(room, nickname.trim()).catch(reason => setError(errorText(reason))).finally(() => setBusy(false)) }}><label>Ваше имя<input value={nickname} maxLength={30} autoComplete="nickname" onChange={event => setNickname(event.target.value)} /></label><button className="button" disabled={busy || nickname.trim().length < 2}>{busy ? 'Подключаем…' : 'Войти в игру'}</button></form>{error && <p className="connection-warning" role="alert">{error}</p>}</Surface></main>
  return <main className="verse-participant"><header><p className="eyebrow">{view.title}</p><h1>{view.nickname}</h1><div className="verse-counter-row"><span>✓ {view.stats.correct}</span><span>Ошибки {view.stats.errors}</span><span>Пропуски {view.stats.missed}</span></div></header>
    {view.phase === 'lobby' && <Surface className="verse-wait"><h2>Вы в комнате</h2><p>Ведущий скоро запустит игру. Карточки появятся автоматически.</p></Surface>}
    {view.phase === 'live' && <><Surface className="verse-mobile-prompt"><p className="eyebrow">ОБЩИЙ ФРАГМЕНТ</p><blockquote>{view.currentRound?.status === 'revealed' ? view.currentRound.fullText : view.currentRound?.promptText || 'Следующий раунд готовится…'}</blockquote>{view.currentRound?.status === 'revealed' && <b>{view.currentRound.reference}</b>}</Surface><section><div className="verse-card-title"><h2>Мои карточки</h2><span>{available.length} осталось</span></div><div className="verse-card-list">{available.map(card => <button type="button" key={card.cardId} className={selected === card.cardId ? 'selected' : ''} onClick={() => setSelected(card.cardId)}><small>{card.direction === 'end' ? 'ОКОНЧАНИЕ' : 'НАЧАЛО'}</small>{card.fragment}</button>)}</div>{error && <p className="connection-warning">{error}</p>}</section>{closed.length > 0 && <details className="verse-closed"><summary>Закрытые карточки ({closed.length})</summary>{closed.map(card => <article key={card.cardId} className={`status-${card.status}`}><b>{card.status === 'correct' ? 'Верно' : card.status === 'error' ? 'Ошибка' : 'Пропуск'}</b><p>{card.fullText}</p><small>{card.reference}</small></article>)}</details>}<ParticipantActionDock><Button className="verse-submit" disabled={busy || !selected || view.currentRound?.status !== 'open'} onClick={submit}>{busy ? 'Проверяем…' : 'Это мой стих'}</Button></ParticipantActionDock></>}
    {(view.phase === 'completed' || view.phase === 'closed') && <>{!showResult ? <><Surface className="verse-complete"><StatusBadge tone={view.endedEarly ? 'muted' : 'accent'}>{view.endedEarly ? 'ЗАВЕРШЕНО ДОСРОЧНО' : 'ИГРА ЗАВЕРШЕНА'}</StatusBadge><h2>{view.endedEarly ? 'Игра остановлена ведущим' : 'Спасибо за игру!'}</h2><p>{view.result ? `Ваш подтверждённый результат: ${view.result.correct} из ${view.result.total}.` : 'Сервер формирует подтверждённый результат.'}</p></Surface><ParticipantActionDock><Button disabled={!view.result} onClick={() => setShowResult(true)}>{view.result ? 'Посмотреть мой результат' : 'Результат загружается…'}</Button></ParticipantActionDock></> : <><PersonalResult view={view} /><ParticipantActionDock><Button secondary onClick={() => setShowResult(false)}>← К завершению</Button></ParticipantActionDock></>}</>}
  </main>
}

export function VerseStagePage({ room = queryRoom() }: { room?: string }) {
  const [view, setView] = useState<VerseAudienceView | null>(null); const [error, setError] = useState('')
  useEffect(() => { void prepareVerseParticipantAuth().catch(reason => setError(errorText(reason))); return subscribeVerseAudience(room, setView, reason => setError(reason.message)) }, [room])
  if (!view) return <main className="verse-stage"><LoadingState eyebrow="СОБЕРИ СТИХ" title="Открываем экран…" description={error} /></main>
  return <main className="verse-stage"><header><p className="eyebrow">СОБЕРИ СТИХ · КОМНАТА {room}</p><h1>{view.title}</h1><span>{view.participantCount} участников</span></header>{view.phase === 'lobby' && <Surface><h2>Подключайтесь к игре</h2><p>После запуска здесь появится первый фрагмент.</p></Surface>}{view.phase === 'live' && <><div className="verse-stage-stats"><span>Раунд {view.roundNumber}</span><span>Осталось {view.remainingCards}</span></div><Surface className={`verse-prompt ${view.currentRound?.status === 'revealed' ? 'is-revealed' : ''}`}><p className="eyebrow">{view.currentRound?.status === 'revealed' ? 'ПОЛНЫЙ СТИХ' : view.currentRound?.promptDirection === 'start' ? 'НАЙДИТЕ НАЧАЛО' : 'НАЙДИТЕ ОКОНЧАНИЕ'}</p><blockquote>{view.currentRound?.status === 'revealed' ? view.currentRound.fullText : view.currentRound?.promptText}</blockquote>{view.currentRound?.status === 'revealed' && <><h2>{view.currentRound.reference}</h2><p>{view.currentRound.outcome === 'correct' ? `Нашёл: ${view.currentRound.answeredByName}` : 'Ответ показал ведущий'}</p></>}</Surface></>}{(view.phase === 'completed' || view.phase === 'closed') && <Surface><h2>{view.endedEarly ? 'Промежуточный итог' : 'Результаты'}</h2><ResultsTable rows={view.results || []} interim={view.endedEarly} /></Surface>}</main>
}

export function VerseParticipantPlaceholder(_props: ParticipantQuestionScreenProps) { return null }
