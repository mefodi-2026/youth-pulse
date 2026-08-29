import { useEffect, useState, type CSSProperties } from 'react'
import type { PublicRoom } from '../../types'
import type { ModeHostScreenProps, ModeLandingScreenProps, ModeMainScreenProps, ModeParticipantFlowProps, ModeSetupScreenProps } from '../contracts'
import type { ParticipantQuestionScreenProps } from '../participantTypes'
import {
  addWheelHostItem, cancelWheelSelection, clearWheelHostPool, completeWheelPendingTask,
  createWheelRoom, deleteWheelHostItem, markWheelReady, markWheelRoundCompleted,
  markWheelRoundPending, prepareWheelParticipantAuth, revealWheelSelection,
  saveWheelParticipantEntry, startWheelSpin, subscribeOwnWheelEntry, subscribeWheelPublicRoom,
} from './repository'
import type {
  WheelDrawOrder, WheelInputMode, WheelParticipantEntry, WheelPoolItem,
  WheelPublicHistoryItem, WheelPublicRound, WheelRoomState, WheelSpinAnimation, WheelSpinItem,
} from './types'
import { canStartWheel } from './validation'
import { getAvailableWheelCount, getWheelNextSpinTarget } from './engine'

const labels = {
  participants: 'Участники вводят имя и задание', host: 'Ведущий готовит имена и задания',
  name_then_task: 'Сначала имя, затем задание', task_then_name: 'Сначала задание, затем имя',
} as const

const phaseLabels = {
  setup: 'Настройка', collecting: 'Собираем данные', ready: 'Можно начинать',
  spinning_name: 'Выбираем имя', name_revealed: 'Имя выбрано',
  spinning_task: 'Выбираем задание', task_revealed: 'Задание выбрано',
  decision: 'Пара открыта', completed: 'Игра завершена',
} as const

const phaseInstructions = {
  setup: 'Завершите настройку комнаты.', collecting: 'Дождитесь участников или заполните оба списка.',
  ready: 'Колесо готово. Запустите следующий выбор.',
  spinning_name: 'Колесо имён вращается. Результат откроется автоматически.',
  name_revealed: 'Имя зафиксировано. Теперь выберите задание.',
  spinning_task: 'Колесо заданий вращается. Результат откроется автоматически.',
  task_revealed: 'Задание зафиксировано. Теперь выберите имя.',
  decision: 'Подтвердите выполнение или перенесите задание на потом.',
  completed: 'Все доступные пары использованы.',
} as const

const colors = ['#ffe000', '#ff9f2d', '#19cf82', '#5e55ee', '#edf0f7', '#e947cf', '#0aa9e5', '#9b6bd8', '#f52355', '#06b5e7', '#ff9f28', '#e850cb']
const point = (radius: number, degrees: number) => { const radians = degrees * Math.PI / 180; return { x: 200 + radius * Math.cos(radians), y: 200 + radius * Math.sin(radians) } }
const sectorPath = (index: number, total: number) => {
  const start = -90 + index * 360 / total
  const end = -90 + (index + 1) * 360 / total
  const first = point(168, start)
  const second = point(168, end)
  return `M 200 200 L ${first.x} ${first.y} A 168 168 0 ${360 / total > 180 ? 1 : 0} 1 ${second.x} ${second.y} Z`
}
const shortLabel = (text: string, total: number) => { const limit = total <= 8 ? 15 : total <= 14 ? 9 : 4; return text.length > limit ? `${text.slice(0, Math.max(1, limit - 1))}…` : text }

function FortuneWheel({ spin, spinning }: { spin?: WheelSpinAnimation; spinning: boolean }) {
  const items: WheelSpinItem[] = spin?.items?.length ? spin.items : Array.from({ length: 10 }, (_, index) => ({ itemId: `placeholder-${index}`, text: `${index + 1}` }))
  const elapsed = spin ? Math.min(Math.max(Date.now() - spin.startedAt, 0), spin.durationMs) : 0
  const style = {
    '--wheel-target': `${spin?.targetRotation || 0}deg`, '--wheel-duration': `${spin?.durationMs || 4200}ms`, '--wheel-delay': `${-elapsed}ms`,
    ...(!spinning && spin ? { transform: `rotate(${spin.targetRotation}deg)` } : {}),
  } as CSSProperties
  return <div className="fortune-wheel-wrap" aria-label={spin?.target === 'task' ? 'Колесо заданий' : 'Колесо имён'}>
    <div className="fortune-wheel-pointer" aria-hidden="true" />
    <div key={spin?.animationNonce || 'idle'} className={`fortune-wheel-disc ${spinning ? 'is-spinning' : ''}`} style={style}>
      <svg viewBox="0 0 400 400" role="img"><circle cx="200" cy="200" r="190" className="fortune-wheel-rim" /><g>{items.map((item, index) => {
        const angle = -90 + (index + 0.5) * 360 / items.length
        const labelPoint = point(items.length > 16 ? 132 : 123, angle)
        return <g key={item.itemId}><path d={sectorPath(index, items.length)} fill={colors[index % colors.length]} /><text x={labelPoint.x} y={labelPoint.y} transform={`rotate(${angle + 90} ${labelPoint.x} ${labelPoint.y})`} className={items.length > 16 ? 'is-compact' : ''}>{shortLabel(item.text, items.length)}</text></g>
      })}</g><circle cx="200" cy="200" r="49" className="fortune-wheel-hub-outer" /><circle cx="200" cy="200" r="37" className="fortune-wheel-hub" /></svg>
    </div>
  </div>
}

export function WheelLandingScreen({ onSetup }: ModeLandingScreenProps) {
  return <section className="glass mode-intro"><p className="eyebrow">ИНТЕРАКТИВНЫЙ РЕЖИМ</p><h2>Колесо фортуны</h2><p>Соберите имена и задания от участников или подготовьте оба списка самостоятельно. Данные синхронизируются с комнатой в реальном времени.</p><button type="button" className="button" onClick={onSetup}>Создать комнату</button></section>
}

export function WheelSetupScreen({ onBack, leaderUid, workspaceId, defaultTitle, onCreated }: ModeSetupScreenProps) {
  const [inputMode, setInputMode] = useState<WheelInputMode>('participants')
  const [drawOrder, setDrawOrder] = useState<WheelDrawOrder>('name_then_task')
  const [title, setTitle] = useState(defaultTitle || 'Колесо фортуны')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const create = async () => {
    if (!leaderUid || !workspaceId || !onCreated || busy) return setError('Не удалось определить аккаунт и workspace ведущего.')
    setBusy(true); setError('')
    try { onCreated(await createWheelRoom({ leaderUid, workspaceId, title, config: { inputMode, drawOrder } })) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось создать комнату.') }
    finally { setBusy(false) }
  }
  return <section className="glass wheel-setup"><p className="eyebrow">КОЛЕСО ФОРТУНЫ · НАСТРОЙКА</p><h2>Подготовьте сбор данных</h2><label>Название комнаты<input value={title} maxLength={80} onChange={event => setTitle(event.target.value)} /></label><fieldset><legend>Кто вводит данные</legend>{(['participants', 'host'] as const).map(value => <button type="button" className={inputMode === value ? 'selected' : ''} key={value} onClick={() => setInputMode(value)}>{labels[value]}</button>)}</fieldset><fieldset><legend>Порядок колёс</legend>{(['name_then_task', 'task_then_name'] as const).map(value => <button type="button" className={drawOrder === value ? 'selected' : ''} key={value} onClick={() => setDrawOrder(value)}>{labels[value]}</button>)}</fieldset><p className="wheel-hint">После создания порядок колёс и способ ввода фиксируются для этой комнаты.</p>{error && <p className="connection-warning">{error}</p>}<div className="control-actions"><button type="button" className="button" disabled={busy} onClick={() => void create()}>{busy ? 'Создаём…' : 'Создать комнату'}</button><button type="button" className="button secondary" disabled={busy} onClick={onBack}>Отмена</button></div></section>
}

const fullVisibleRound = (wheel?: WheelRoomState): WheelPublicRound | undefined => {
  const current = wheel?.currentRound
  if (!wheel || !current) return undefined
  const nameVisible = ['name_revealed', 'spinning_task', 'task_revealed', 'decision'].includes(wheel.phase)
  const taskVisible = ['task_revealed', 'spinning_name', 'name_revealed', 'decision'].includes(wheel.phase)
  if (!nameVisible && !taskVisible) return undefined
  return { ...(nameVisible ? { selectedNameText: current.selectedNameText } : {}), ...(taskVisible ? { selectedTaskText: current.selectedTaskText } : {}) }
}

type AudienceProps = {
  phase: keyof typeof phaseLabels; round?: WheelPublicRound; activeSpin?: WheelSpinAnimation; history?: WheelPublicHistoryItem[]
  nameCount: number; taskCount: number; roundCount: number; pendingCount: number
}

function WheelAudiencePanel({ phase, round, activeSpin, history = [], nameCount, taskCount, roundCount, pendingCount }: AudienceProps) {
  const spinning = phase === 'spinning_name' || phase === 'spinning_task'
  const activeItems = activeSpin?.items || []
  return <section className="wheel-audience">
    <header className="wheel-game-heading"><div><p className="eyebrow">КОЛЕСО ФОРТУНЫ</p><h1>{phaseLabels[phase]}</h1></div><div className="wheel-live-stats"><span>Имена <b>{nameCount}</b></span><span>Задания <b>{taskCount}</b></span><span>Раунды <b>{roundCount}</b></span><span>Отложено <b>{pendingCount}</b></span></div></header>
    <div className="wheel-play-layout"><aside className="wheel-active-list"><small>{activeSpin?.target === 'task' ? 'ЗАДАНИЯ В КОЛЕСЕ' : 'ИМЕНА В КОЛЕСЕ'}</small>{activeItems.length ? <ol>{activeItems.map(item => <li key={item.itemId}>{item.text}</li>)}</ol> : <p>Запустите колесо, чтобы увидеть текущий список.</p>}</aside><div className="wheel-visual"><FortuneWheel spin={activeSpin} spinning={spinning} />{spinning && <p className="wheel-spinning-copy">Выбор синхронизирован · результат откроется автоматически</p>}</div><aside className="wheel-round-card"><small>ТЕКУЩИЙ РАУНД</small><div><span>ИМЯ</span><strong>{round?.selectedNameText || '—'}</strong></div><div><span>ЗАДАНИЕ</span><strong>{round?.selectedTaskText || '—'}</strong></div><p>{phaseInstructions[phase]}</p></aside></div>
    {history.length > 0 && <section className="wheel-history"><div><p className="eyebrow">ИСТОРИЯ</p><h2>Сыгранные пары</h2></div><ol>{history.map((item, index) => <li key={item.roundId}><b>{index + 1}</b><span><strong>{item.nameText}</strong>{item.taskText}</span><em>{item.status === 'pending' ? 'На потом' : 'Выполнено'}</em></li>)}</ol></section>}
    {phase === 'completed' && <p className="wheel-complete-note">Доступные пары закончились. Ведущий может завершить комнату.</p>}
  </section>
}

export function WheelParticipantFlow({ room }: ModeParticipantFlowProps) {
  const [participantId, setParticipantId] = useState('')
  const [publicRoom, setPublicRoom] = useState<PublicRoom | null>(null)
  const [entry, setEntry] = useState<WheelParticipantEntry | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [taskText, setTaskText] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true; let stopEntry: () => void = () => undefined
    const stopRoom = subscribeWheelPublicRoom(room, value => { if (active) { setPublicRoom(value); setLoading(false) } }, reason => { if (active) { setError(reason.message); setLoading(false) } })
    void prepareWheelParticipantAuth().then(uid => { if (!active) return; setParticipantId(uid); stopEntry = subscribeOwnWheelEntry(room, uid, value => { if (!active) return; setEntry(value); if (value) { setDisplayName(value.displayName); setTaskText(value.taskText) } }, reason => setError(reason.message)) }).catch(reason => { if (active) { setError(reason instanceof Error ? reason.message : 'Не удалось подключиться.'); setLoading(false) } })
    return () => { active = false; stopRoom(); stopEntry() }
  }, [room])
  const locked = publicRoom?.phase === 'closed' || publicRoom?.wheel?.phase !== 'collecting'
  const submit = async () => { if (!participantId || locked || saving) return; setSaving(true); setError(''); try { setEntry(await saveWheelParticipantEntry(room, { displayName, taskText })) } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось сохранить данные.') } finally { setSaving(false) } }
  if (loading) return <main className="mobile-wrap wheel-mobile"><section className="mobile-card"><p className="flow-label">ПОДКЛЮЧАЕМ</p><h1>Открываем комнату…</h1><span className="stage-spinner" /></section></main>
  if (!publicRoom || publicRoom.mode !== 'wheel') return <main className="mobile-wrap wheel-mobile"><section className="mobile-card"><p className="flow-label">КОМНАТА НЕДОСТУПНА</p><h1>Колесо не найдено</h1><p>{error || 'Проверьте ссылку или попросите ведущего создать новую комнату.'}</p></section></main>
  const publicWheel = publicRoom.wheel
  if (!publicWheel) return <main className="mobile-wrap wheel-mobile"><section className="mobile-card"><h1>Состояние игры недоступно</h1><p>Обновите страницу или попросите ведущего открыть комнату заново.</p></section></main>
  if (publicRoom.phase === 'closed') return <main className="mobile-wrap wheel-mobile"><section className="mobile-card wheel-waiting"><p className="flow-label">СЕССИЯ ЗАВЕРШЕНА</p><h1>Спасибо за участие</h1><p>Ведущий завершил эту комнату. Новые данные отправить нельзя.</p></section></main>
  if (publicWheel.phase !== 'collecting') return <main className="mobile-wrap wheel-mobile"><section className="mobile-card"><WheelAudiencePanel phase={publicWheel.phase} round={publicWheel.currentRound} activeSpin={publicWheel.activeSpin} history={publicWheel.history} nameCount={publicWheel.nameCount} taskCount={publicWheel.taskCount} roundCount={publicWheel.roundCount ?? 0} pendingCount={publicWheel.pendingCount ?? 0} />{error && <p className="flow-error">{error}</p>}</section></main>
  if (publicWheel.inputMode === 'host') return <main className="mobile-wrap wheel-mobile"><section className="mobile-card wheel-waiting"><p className="flow-label">КОЛЕСО ФОРТУНЫ</p><h1>Ведущий готовит игру</h1><p>Имена и задания вводит ведущий. Ожидайте начала на общем экране.</p></section></main>
  return <main className="mobile-wrap wheel-mobile"><section className="mobile-card"><p className="flow-label">КОЛЕСО ФОРТУНЫ</p><h1>{entry ? 'Данные сохранены' : 'Добавь себя в игру'}</h1><p>{locked ? 'Сбор данных завершён. Изменения больше недоступны.' : 'Укажи имя и придумай одно задание. Одинаковые имена не перепутаются.'}</p><label>Имя или никнейм<input value={displayName} disabled={locked} maxLength={60} onChange={event => setDisplayName(event.target.value)} /></label><label>Задание<textarea value={taskText} disabled={locked} maxLength={240} onChange={event => setTaskText(event.target.value)} /></label><button type="button" className="mobile-action" disabled={locked || saving || !displayName.trim() || !taskText.trim()} onClick={() => void submit()}>{saving ? 'Сохраняем…' : entry ? 'Сохранить исправления' : 'Отправить ведущему'}</button>{entry && <div className="waiting-status"><span /><div><b>Ты в игре</b><small>Ждём остальных участников</small></div></div>}{error && <p className="flow-error">{error}</p>}</section></main>
}

function WheelList({ title, items, onDelete, onClear }: { title: string; items: Record<string, WheelPoolItem>; onDelete?: (id: string) => void; onClear?: () => void }) {
  const available = Object.values(items).filter(item => item.status === 'available')
  return <section className="wheel-pool"><div><h3>{title}</h3><div>{onClear && available.length > 0 && <button type="button" onClick={onClear}>Очистить</button>}<b>{available.length}</b></div></div>{available.length ? <ul>{available.map(item => <li key={item.itemId}><span>{item.text}</span>{onDelete && <button type="button" onClick={() => onDelete(item.itemId)}>Удалить</button>}</li>)}</ul> : <p>Список пока пуст.</p>}</section>
}

export function WheelHostScreen({ session, joinUrl, onClose }: ModeHostScreenProps) {
  const wheel = session.wheel
  const [name, setName] = useState('')
  const [task, setTask] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const names = wheel?.pools?.names || {}; const tasks = wheel?.pools?.tasks || {}; const entries = wheel?.participants || {}
  const collecting = wheel?.phase === 'collecting'; const valid = canStartWheel(wheel); const nextTarget = getWheelNextSpinTarget(wheel)
  const spinning = wheel?.phase === 'spinning_name' || wheel?.phase === 'spinning_task'; const decision = wheel?.phase === 'decision'
  const pending = Object.values(wheel?.pendingTasks || {})
  const history: WheelPublicHistoryItem[] = Object.values(wheel?.rounds || {}).map(round => ({ roundId: round.roundId, nameText: round.nameText, taskText: round.taskText, status: round.status }))
  const run = async (job: () => Promise<unknown>) => { setBusy(true); setError(''); try { await job() } catch (reason) { setError(reason instanceof Error ? reason.message : 'Операция не выполнена.') } finally { setBusy(false) } }
  useEffect(() => {
    if (!spinning || !wheel?.activeSpin) return
    let active = true
    const timer = window.setTimeout(() => { void revealWheelSelection(session.roomId).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Не удалось открыть результат вращения.') }) }, Math.max(0, wheel.activeSpin!.endsAt - Date.now()) + 120)
    return () => { active = false; window.clearTimeout(timer) }
  }, [session.roomId, spinning, wheel?.activeSpin?.animationNonce, wheel?.activeSpin?.endsAt])
  const add = (pool: 'names' | 'tasks') => void run(async () => { const value = pool === 'names' ? name : task; await addWheelHostItem(session.roomId, pool, value); pool === 'names' ? setName('') : setTask('') })
  const removeItem = (pool: 'names' | 'tasks', id: string) => void run(() => deleteWheelHostItem(session.roomId, pool, id))
  const clearItems = (pool: 'names' | 'tasks') => void run(() => clearWheelHostPool(session.roomId, pool))
  const spinLabel = nextTarget === 'name' ? 'Крутить колесо имён' : nextTarget === 'task' ? 'Крутить колесо заданий' : ''
  const nameTotal = Object.keys(names).length; const taskTotal = Object.keys(tasks).length
  return <div className="wheel-host"><header className="host-header"><div><p className="eyebrow">КОЛЕСО ФОРТУНЫ · {wheel ? phaseLabels[wheel.phase] : 'ЗАГРУЗКА'}</p><h1>{session.roomTitle || session.roomId}</h1><p className="room-header-title">{wheel ? `${labels[wheel.config.inputMode]} · ${labels[wheel.config.drawOrder]}` : 'Загружаем настройки режима…'}</p></div></header><div className="wheel-counters"><article><strong>{Object.keys(entries).length}</strong><span>отправили данные</span></article><article><strong>{getAvailableWheelCount(wheel, 'name')}</strong><span>имён доступно</span></article><article><strong>{getAvailableWheelCount(wheel, 'task')}</strong><span>заданий доступно</span></article></div>
    {wheel?.config.inputMode === 'participants' && collecting && <section className="glass wheel-join"><h2>Ссылка для участников</h2><code>{joinUrl}</code><button type="button" className="button secondary" onClick={() => void navigator.clipboard.writeText(joinUrl)}>Скопировать ссылку</button><div className="wheel-entry-summary">{Object.values(entries).map(item => <span key={item.participantId}>{item.displayName}</span>)}</div></section>}
    {wheel?.config.inputMode === 'host' && collecting && <section className="glass wheel-host-input"><div><label>Новое имя<input value={name} onChange={event => setName(event.target.value)} maxLength={60} /></label><button type="button" className="button secondary" disabled={busy || !name.trim() || nameTotal >= 50} onClick={() => add('names')}>Добавить имя</button></div><div><label>Новое задание<textarea value={task} onChange={event => setTask(event.target.value)} maxLength={240} /></label><button type="button" className="button secondary" disabled={busy || !task.trim() || taskTotal >= 50} onClick={() => add('tasks')}>Добавить задание</button></div></section>}
    {collecting ? <div className="wheel-pools"><WheelList title="Имена" items={names} onDelete={wheel?.config.inputMode === 'host' ? id => removeItem('names', id) : undefined} onClear={wheel?.config.inputMode === 'host' ? () => clearItems('names') : undefined} /><WheelList title="Задания" items={tasks} onDelete={wheel?.config.inputMode === 'host' ? id => removeItem('tasks', id) : undefined} onClear={wheel?.config.inputMode === 'host' ? () => clearItems('tasks') : undefined} /></div> : wheel && <section className="glass wheel-game-panel"><WheelAudiencePanel phase={wheel.phase} round={fullVisibleRound(wheel)} activeSpin={wheel.activeSpin || undefined} history={history} nameCount={getAvailableWheelCount(wheel, 'name')} taskCount={getAvailableWheelCount(wheel, 'task')} roundCount={history.length} pendingCount={pending.filter(item => item.status === 'pending').length} /><div className="wheel-game-actions">{nextTarget && <button type="button" className="button" disabled={busy} onClick={() => void run(() => startWheelSpin(session.roomId))}>{spinLabel}</button>}{spinning && <button type="button" className="button" disabled>Колесо вращается…</button>}{decision && <><button type="button" className="button" disabled={busy} onClick={() => void run(() => markWheelRoundCompleted(session.roomId))}>Задание выполнено</button><button type="button" className="button secondary" disabled={busy} onClick={() => void run(() => markWheelRoundPending(session.roomId))}>Выполнить позже</button></>}{wheel.currentRound && !spinning && <button type="button" className="button secondary" disabled={busy} onClick={() => void run(() => cancelWheelSelection(session.roomId))}>Отменить выбор</button>}</div></section>}
    {pending.length > 0 && <section className="glass wheel-pending"><div><p className="eyebrow">ОТЛОЖЕННЫЕ ЗАДАНИЯ</p><h2>Библиотека</h2></div><ul>{pending.map(item => <li key={item.pendingId}><div><b>{item.participantName}</b><span>{item.taskText}</span></div><button type="button" className="button secondary" disabled={busy || item.status === 'completed'} onClick={() => void run(() => completeWheelPendingTask(session.roomId, item.pendingId))}>{item.status === 'completed' ? 'Выполнено' : 'Отметить выполненным'}</button></li>)}</ul></section>}
    {error && <p className="connection-warning">{error}</p>}<div className="control-actions">{collecting && <button type="button" className="button" disabled={busy || !valid} onClick={() => void run(() => markWheelReady(session.roomId))}>Начать игру</button>}<button type="button" className="button secondary" disabled={busy} onClick={onClose}>Завершить комнату</button></div>{collecting && !valid && <p className="wheel-hint">Для начала нужны одинаковые списки: от 2 до 50 имён и столько же заданий. Сейчас: {nameTotal} / {taskTotal}.</p>}</div>
}

export function WheelMainScreen({ session }: ModeMainScreenProps) {
  const wheel = session.wheel; const names = getAvailableWheelCount(wheel, 'name'); const tasks = getAvailableWheelCount(wheel, 'task'); const entries = Object.keys(wheel?.participants || {}).length
  if (wheel && wheel.phase !== 'collecting') { const history: WheelPublicHistoryItem[] = Object.values(wheel.rounds || {}).map(round => ({ roundId: round.roundId, nameText: round.nameText, taskText: round.taskText, status: round.status })); return <main className="stage-dashboard wheel-stage"><div className="stage-light" /><WheelAudiencePanel phase={wheel.phase} round={fullVisibleRound(wheel)} activeSpin={wheel.activeSpin || undefined} history={history} nameCount={names} taskCount={tasks} roundCount={history.length} pendingCount={Object.values(wheel.pendingTasks || {}).filter(item => item.status === 'pending').length} /><p className="stage-privacy">Результат синхронизирован с экраном ведущего. Управление доступно только ведущему.</p></main> }
  return <main className="stage-dashboard wheel-stage"><div className="stage-light" /><header className="stage-header"><div><p className="eyebrow">КОЛЕСО ФОРТУНЫ</p><h1>Собираем имена и задания</h1></div><span className="stage-live">ОЖИДАНИЕ</span></header><section className="wheel-stage-grid"><article><strong>{entries}</strong><span>участников отправили данные</span></article><article><strong>{names}</strong><span>имён в колесе</span></article><article><strong>{tasks}</strong><span>заданий в колесе</span></article></section><p className="stage-privacy">Имена и тексты заданий на общем экране появятся только после запуска колеса.</p></main>
}

export function WheelParticipantPlaceholder(_props: ParticipantQuestionScreenProps) { return null }
