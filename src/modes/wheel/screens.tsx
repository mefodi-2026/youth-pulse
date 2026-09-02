import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import QRCode from 'qrcode'
import type { PublicRoom } from '../../types'
import type { ModeHostScreenProps, ModeLandingScreenProps, ModeMainScreenProps, ModeParticipantFlowProps, ModeSetupScreenProps } from '../contracts'
import type { ParticipantQuestionScreenProps } from '../participantTypes'
import {
  addWheelHostItem, cancelWheelSelection, clearWheelHostPool, completeWheelPendingTask,
  createWheelRoom, deleteWheelHostItem, markWheelReady, markWheelRoundCompleted,
  markWheelRoundPending, openWheelPendingTask, prepareWheelParticipantAuth,
  revealWheelSelection, saveWheelParticipantEntry, startWheelRound, startWheelSpin,
  subscribeOwnWheelEntry, subscribeWheelPublicRoom,
} from './repository'
import type { WheelDrawOrder, WheelInputMode, WheelParticipantEntry, WheelPoolItem, WheelPublicHistoryItem, WheelPublicRound, WheelRoomState, WheelSpinAnimation, WheelSpinItem } from './types'
import { canStartWheel } from './validation'
import { getAvailableWheelCount, getWheelDisplayTarget, getWheelNextSpinTarget } from './engine'

const labels = {
  participants: 'Участники вводят имя и задание', host: 'Ведущий готовит имена и задания',
  name_then_task: 'Сначала имя, затем задание', task_then_name: 'Сначала задание, затем имя',
} as const

const phaseLabels = {
  setup: 'Настройка', collecting: 'Собираем данные', ready: 'Готово к вращению',
  spinning_name: 'Выбираем участника', name_revealed: 'Выпало имя',
  spinning_task: 'Выбираем задание', task_revealed: 'Выпало задание',
  decision: 'Пара выбрана', performing: 'Текущий раунд', completed: 'Игра завершена',
} as const

const phaseInstructions = {
  setup: 'Завершите настройку комнаты.', collecting: 'Дождитесь участников или заполните оба списка.',
  ready: 'Крутите следующее колесо, когда будете готовы.',
  spinning_name: 'Выбираем участника. Результат синхронизирован на всех экранах.',
  name_revealed: 'Подтвердите имя, чтобы открыть колесо заданий.',
  spinning_task: 'Выбираем задание. Результат синхронизирован на всех экранах.',
  task_revealed: 'Подтвердите задание, чтобы открыть колесо имён.',
  decision: 'Выберите: выполнить задание сейчас или сохранить его в библиотеке.',
  performing: 'Пара открыта. Отметьте задание выполненным после выполнения.',
  completed: 'Все доступные пары использованы.',
} as const

const colors = ['#1eb6dc', '#ff9f2d', '#ffe000', '#e947cf', '#f52355', '#9b6bd8', '#5e55ee', '#0aa9e5', '#19cf82', '#ff9f28', '#e850cb', '#06b5e7']
const point = (radius: number, degrees: number) => { const radians = degrees * Math.PI / 180; return { x: 200 + radius * Math.cos(radians), y: 200 + radius * Math.sin(radians) } }
const sectorPath = (index: number, total: number) => {
  const start = -90 + index * 360 / total; const end = -90 + (index + 1) * 360 / total
  const first = point(168, start); const second = point(168, end)
  return `M 200 200 L ${first.x} ${first.y} A 168 168 0 ${360 / total > 180 ? 1 : 0} 1 ${second.x} ${second.y} Z`
}
const shortLabel = (text: string, total: number) => {
  const limit = total <= 6 ? 19 : total <= 10 ? 12 : total <= 16 ? 8 : 5
  return text.length > limit ? `${text.slice(0, Math.max(1, limit - 1))}…` : text
}

function FortuneWheel({ spin, items = [], spinning, target }: { spin?: WheelSpinAnimation; items?: WheelSpinItem[]; spinning: boolean; target?: 'name' | 'task' | null }) {
  const sectors = spin?.items?.length ? spin.items : items
  const wheelTarget = spin?.target || target
  const elapsed = spin ? Math.min(Math.max(Date.now() - spin.startedAt, 0), spin.durationMs) : 0
  const style = {
    '--wheel-target': `${spin?.targetRotation || 0}deg`, '--wheel-duration': `${spin?.durationMs || 4200}ms`, '--wheel-delay': `${-elapsed}ms`,
    ...(!spinning && spin ? { transform: `rotate(${spin.targetRotation}deg)` } : {}),
  } as CSSProperties
  if (!sectors.length) return <div className="fortune-wheel-empty"><span>◉</span><p>Добавьте элементы, чтобы собрать колесо</p></div>
  return <div className="fortune-wheel-wrap" aria-label={wheelTarget === 'task' ? 'Колесо заданий' : 'Колесо имён'}>
    <div className={`fortune-wheel-pointer ${wheelTarget === 'task' ? 'is-task' : ''}`} aria-hidden="true" />
    <div key={spin?.animationNonce || `idle-${sectors.length}`} className={`fortune-wheel-disc ${spinning ? 'is-spinning' : ''}`} style={style}>
      <svg viewBox="0 0 400 400" role="img"><circle cx="200" cy="200" r="190" className="fortune-wheel-rim" /><g>{sectors.map((item, index) => {
        const angle = -90 + (index + 0.5) * 360 / sectors.length; const labelPoint = point(sectors.length > 16 ? 132 : 123, angle)
        return <g key={item.itemId}><path d={sectorPath(index, sectors.length)} fill={colors[index % colors.length]} /><text x={labelPoint.x} y={labelPoint.y} transform={`rotate(${angle + 90} ${labelPoint.x} ${labelPoint.y})`} className={sectors.length > 16 ? 'is-compact' : ''}>{shortLabel(item.text, sectors.length)}</text></g>
      })}</g><circle cx="200" cy="200" r="49" className="fortune-wheel-hub-outer" /><circle cx="200" cy="200" r="37" className="fortune-wheel-hub" /></svg>
    </div>
  </div>
}

export function WheelLandingScreen({ onSetup }: ModeLandingScreenProps) {
  return <section className="glass mode-intro"><p className="eyebrow">ИНТЕРАКТИВНЫЙ РЕЖИМ</p><h2>Колесо фортуны</h2><p>Соберите имена и задания от участников или подготовьте оба списка самостоятельно. Каждый выбор синхронизируется с комнатой в реальном времени.</p><button type="button" className="button" onClick={onSetup}>Создать комнату</button></section>
}

export function WheelSetupScreen({ onBack, leaderUid, workspaceId, defaultTitle, onCreated }: ModeSetupScreenProps) {
  const [inputMode, setInputMode] = useState<WheelInputMode>('participants')
  const [drawOrder, setDrawOrder] = useState<WheelDrawOrder>('name_then_task')
  const [title, setTitle] = useState(defaultTitle || 'Колесо фортуны')
  const [busy, setBusy] = useState(false); const [error, setError] = useState('')
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
  const nameVisible = ['name_revealed', 'spinning_task', 'task_revealed', 'decision', 'performing'].includes(wheel.phase)
  const taskVisible = ['task_revealed', 'spinning_name', 'name_revealed', 'decision', 'performing'].includes(wheel.phase)
  if (!nameVisible && !taskVisible) return undefined
  return { ...(nameVisible ? { selectedNameText: current.selectedNameText } : {}), ...(taskVisible ? { selectedTaskText: current.selectedTaskText } : {}) }
}

type AudienceProps = { phase: keyof typeof phaseLabels; drawOrder: WheelDrawOrder; round?: WheelPublicRound; activeSpin?: WheelSpinAnimation; history?: WheelPublicHistoryItem[]; nameCount: number; taskCount: number; roundCount: number; pendingCount: number; idleItems?: WheelSpinItem[]; stopAnimation?: boolean }

function WheelAudiencePanel({ phase, drawOrder, round, activeSpin, history = [], nameCount, taskCount, roundCount, pendingCount, idleItems = [], stopAnimation = false }: AudienceProps) {
  const spinning = !stopAnimation && (phase === 'spinning_name' || phase === 'spinning_task')
  const target = getWheelDisplayTarget(phase, drawOrder, activeSpin?.target)
  const items = activeSpin?.items || idleItems
  const selectedTitle = phase === 'name_revealed' ? 'ВЫПАЛО ИМЯ' : phase === 'task_revealed' ? 'ВЫПАЛО ЗАДАНИЕ' : null
  const heading = phase === 'ready' ? target === 'task' ? 'Выбираем задание' : 'Выбираем участника' : phaseLabels[phase]
  const subtitle = phase === 'ready'
    ? target === 'task' ? 'Сначала определим, что предстоит выполнить.' : 'Сначала определим, кто выполняет задание.'
    : phase === 'name_revealed' || phase === 'task_revealed' ? 'Подтвердите выбор. Следующее колесо не запустится автоматически.' : phaseInstructions[phase]
  const queueLabel = target === 'task' ? 'ЗАДАНИЯ В ОЧЕРЕДИ' : 'ОЧЕРЕДЬ УЧАСТНИКОВ'
  return <section className="wheel-audience">
    <header className="wheel-game-heading"><div><p className="eyebrow">◉ КОЛЕСО ФОРТУНЫ</p><h1>{heading}</h1><p className="wheel-subtitle">{subtitle}</p></div><div className="wheel-live-stats"><span>Имена <b>{nameCount}</b></span><span>Задания <b>{taskCount}</b></span><span>Раунд <b>{roundCount + (round ? 1 : 0)}</b></span></div></header>
    <div className="wheel-play-layout"><aside className="wheel-active-list"><small>{queueLabel}</small>{items.length ? <ol>{items.map((item, index) => <li key={item.itemId}><b>{index + 1}</b><span>{item.text}</span></li>)}</ol> : <p>Список появится после начала игры.</p>}<footer>{items.length} {target === 'task' ? 'заданий' : target === 'name' ? 'имён в колесе' : 'элементов в колесе'}</footer></aside><div className="wheel-visual">{phase === 'performing' ? <article className="wheel-performing-card"><small>РАУНД {roundCount + 1}</small><p>Задание выполняет <b>{round?.selectedNameText || 'участник'}</b></p><strong>{round?.selectedTaskText || '—'}</strong><span>● Раунд начат</span></article> : <><FortuneWheel spin={activeSpin} items={items} spinning={spinning} target={target} />{spinning && <p className="wheel-spinning-copy">Колесо вращается · повторный запуск заблокирован</p>}{selectedTitle && <article className="wheel-reveal-card"><small>{selectedTitle}</small><strong>{phase === 'name_revealed' ? round?.selectedNameText : round?.selectedTaskText}</strong><span>Подтвердите выбор, чтобы продолжить.</span></article>}</>}</div><aside className="wheel-round-card"><small>ТЕКУЩИЙ РАУНД</small><div><span>ИМЯ</span><strong>{round?.selectedNameText || '—'}</strong></div><div><span>ЗАДАНИЕ</span><strong>{round?.selectedTaskText || '—'}</strong></div><p>{phase === 'performing' ? 'Задание выполняется сейчас.' : pendingCount ? `В библиотеке: ${pendingCount}` : 'Ожидаем следующий выбор.'}</p></aside></div>
    {history.length > 0 && <section className="wheel-history"><div><p className="eyebrow">ИСТОРИЯ РАУНДОВ</p><h2>Сыгранные пары</h2></div><ol>{history.map((item, index) => <li key={item.roundId}><b>{index + 1}</b><span><strong>{item.nameText}</strong>{item.taskText}</span><em>{item.status === 'pending' ? 'В библиотеке' : 'Выполнено'}</em></li>)}</ol></section>}
    {phase === 'completed' && <p className="wheel-complete-note">Доступные пары закончились. Отложенные задания остаются в библиотеке.</p>}
  </section>
}

export function WheelParticipantFlow({ room }: ModeParticipantFlowProps) {
  const [participantId, setParticipantId] = useState(''); const [publicRoom, setPublicRoom] = useState<PublicRoom | null>(null); const [entry, setEntry] = useState<WheelParticipantEntry | null>(null)
  const [displayName, setDisplayName] = useState(''); const [taskText, setTaskText] = useState(''); const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [error, setError] = useState('')
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
  if (publicWheel.phase !== 'collecting') return <main className="mobile-wrap wheel-mobile"><section className="mobile-card"><WheelAudiencePanel phase={publicWheel.phase} drawOrder={publicWheel.drawOrder} round={publicWheel.currentRound} activeSpin={publicWheel.activeSpin} history={publicWheel.history} nameCount={publicWheel.nameCount} taskCount={publicWheel.taskCount} roundCount={publicWheel.roundCount ?? 0} pendingCount={publicWheel.pendingCount ?? 0} />{error && <p className="flow-error">{error}</p>}</section></main>
  if (publicWheel.inputMode === 'host') return <main className="mobile-wrap wheel-mobile"><section className="mobile-card wheel-waiting"><p className="flow-label">КОЛЕСО ФОРТУНЫ</p><h1>Ведущий готовит игру</h1><p>Имена и задания вводит ведущий. Ожидайте начала на общем экране.</p></section></main>
  return <main className="mobile-wrap wheel-mobile"><section className="mobile-card"><p className="flow-label">КОЛЕСО ФОРТУНЫ</p><h1>{entry ? 'Данные сохранены' : 'Добавь себя в игру'}</h1><p>{locked ? 'Сбор данных завершён. Изменения больше недоступны.' : 'Укажи имя и придумай одно задание. Одинаковые имена не перепутаются.'}</p><label>Имя или никнейм<input value={displayName} disabled={locked} maxLength={60} onChange={event => setDisplayName(event.target.value)} /></label><label>Задание<textarea value={taskText} disabled={locked} maxLength={240} onChange={event => setTaskText(event.target.value)} /></label><button type="button" className="mobile-action" disabled={locked || saving || !displayName.trim() || !taskText.trim()} onClick={() => void submit()}>{saving ? 'Сохраняем…' : entry ? 'Сохранить исправления' : 'Отправить ведущему'}</button>{entry && <div className="waiting-status"><span /><div><b>Ты в игре</b><small>Ждём остальных участников</small></div></div>}{error && <p className="flow-error">{error}</p>}</section></main>
}

function WheelList({ title, items, onDelete, onClear }: { title: string; items: Record<string, WheelPoolItem>; onDelete?: (id: string) => void; onClear?: () => void }) {
  const available = Object.values(items).filter(item => item.status === 'available')
  return <section className="wheel-pool"><div><div><p className="eyebrow">{title === 'Имена участников' ? '◉ УЧАСТНИКИ' : '◈ ЗАДАНИЯ'}</p><h3>{title}</h3></div><b>{available.length}</b></div>{available.length ? <ul>{available.map(item => <li key={item.itemId}><i aria-hidden="true">⠿</i><span>{item.text}</span>{onDelete && <button type="button" aria-label={`Удалить: ${item.text}`} onClick={() => onDelete(item.itemId)}>⌫</button>}</li>)}</ul> : <p>Список пока пуст.</p>}{onClear && available.length > 0 && <footer><span>В списке: <b>{available.length}</b></span><button type="button" onClick={onClear}>Очистить список</button></footer>}</section>
}

function WheelJoinPanel({ joinUrl, entries }: { joinUrl: string; entries: Record<string, WheelParticipantEntry> }) {
  const [qr, setQr] = useState('')
  const [copyError, setCopyError] = useState('')
  useEffect(() => {
    let active = true
    if (!joinUrl) { setQr(''); return () => { active = false } }
    console.info('[wheel] joinUrl', { qr: joinUrl, copy: joinUrl, manual: joinUrl })
    void QRCode.toDataURL(joinUrl, { width: 420, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#031b13', light: '#f8fff9' } })
      .then(value => { if (active) setQr(value) })
      .catch(reason => { if (active) setCopyError(reason instanceof Error ? reason.message : 'Не удалось сформировать QR-код.') })
    return () => { active = false }
  }, [joinUrl])
  const copy = async () => {
    setCopyError('')
    try { await navigator.clipboard.writeText(joinUrl) }
    catch (reason) { setCopyError(reason instanceof Error ? reason.message : 'Не удалось скопировать ссылку.') }
  }
  return <section className="glass wheel-join">
    <div className="wheel-join-copy"><p className="eyebrow">ПОДКЛЮЧЕНИЕ УЧАСТНИКОВ</p><h2>Отсканируйте QR-код</h2><p>QR-код, ссылка и кнопка используют одну и ту же комнату.</p>{qr ? <img className="wheel-join-qr" src={qr} alt="QR-код для подключения к текущей игре" /> : <p>Генерируем QR-код…</p>}</div>
    <div className="wheel-join-link"><code>{joinUrl}</code><button type="button" className="button secondary" onClick={() => void copy()}>Скопировать ссылку</button>{copyError && <p className="connection-warning">{copyError}</p>}<div className="wheel-entry-summary">{Object.values(entries).map(item => <span key={item.participantId}>{item.displayName}</span>)}</div></div>
  </section>
}

type FinishIntent = 'close' | 'exit'

export function WheelHostScreen({ session, joinUrl, onClose, onPlayAgain, onExitToMain }: ModeHostScreenProps) {
  const wheel = session.wheel
  const [name, setName] = useState(''); const [task, setTask] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const [finishIntent, setFinishIntent] = useState<FinishIntent | null>(null); const [ending, setEnding] = useState(false)
  const names = wheel?.pools?.names || {}; const tasks = wheel?.pools?.tasks || {}; const entries = wheel?.participants || {}
  const collecting = wheel?.phase === 'collecting'; const valid = canStartWheel(wheel); const nextTarget = getWheelNextSpinTarget(wheel)
  const spinning = wheel?.phase === 'spinning_name' || wheel?.phase === 'spinning_task'; const decision = wheel?.phase === 'decision'; const performing = wheel?.phase === 'performing'
  const pending = Object.values(wheel?.pendingTasks || {}).filter(item => item.status === 'pending')
  const history: WheelPublicHistoryItem[] = Object.values(wheel?.rounds || {}).map(round => ({ roundId: round.roundId, nameText: round.nameText, taskText: round.taskText, status: round.status }))
  const availableItems = useMemo(() => Object.values(nextTarget === 'task' ? tasks : names).filter(item => item.status === 'available').map(item => ({ itemId: item.itemId, text: item.text })), [names, nextTarget, tasks])
  const run = async (job: () => Promise<unknown>) => { setBusy(true); setError(''); try { await job() } catch (reason) { setError(reason instanceof Error ? reason.message : 'Операция не выполнена.') } finally { setBusy(false) } }
  useEffect(() => {
    if (ending || !spinning || !wheel?.activeSpin) return
    let active = true
    const timer = window.setTimeout(() => { void revealWheelSelection(session.roomId).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Не удалось открыть результат вращения.') }) }, Math.max(0, wheel.activeSpin.endsAt - Date.now()) + 120)
    return () => { active = false; window.clearTimeout(timer) }
  }, [ending, session.roomId, spinning, wheel?.activeSpin?.animationNonce, wheel?.activeSpin?.endsAt])
  const add = (pool: 'names' | 'tasks') => void run(async () => { const value = pool === 'names' ? name : task; await addWheelHostItem(session.roomId, pool, value); pool === 'names' ? setName('') : setTask('') })
  const removeItem = (pool: 'names' | 'tasks', id: string) => void run(() => deleteWheelHostItem(session.roomId, pool, id))
  const clearItems = (pool: 'names' | 'tasks') => void run(() => clearWheelHostPool(session.roomId, pool))
  const confirmation = wheel?.phase === 'name_revealed' || wheel?.phase === 'task_revealed'
  const confirmationLabel = 'Подтвердить выбор'
  const activeRoundPending = performing && wheel?.currentRound ? pending.some(item => item.pendingId === wheel.currentRound?.roundId) : false
  const activeRoundItems = wheel?.activeSpin?.items || availableItems
  const confirmFinish = async () => {
    if (!finishIntent || ending) return
    setEnding(true); setBusy(true); setError('')
    try {
      const completed = finishIntent === 'exit' ? await onExitToMain?.() : await onClose()
      if (!completed) { setEnding(false); setError('Не удалось завершить игру. Повторите попытку.') }
    } catch (reason) { setEnding(false); setError(reason instanceof Error ? reason.message : 'Не удалось завершить игру.') }
    finally { setBusy(false) }
  }
  const playAgain = () => void run(async () => {
    if (!onPlayAgain) throw new Error('Повторный запуск сейчас недоступен.')
    const created = await onPlayAgain()
    if (!created) throw new Error('Не удалось запустить новую игру.')
  })
  const disabled = busy || ending
  return <div className="wheel-host">
    <header className="wheel-host-brand"><p>◉ КОЛЕСО ФОРТУНЫ</p><div><span>{wheel ? phaseLabels[wheel.phase] : 'Загрузка'}</span><button type="button" className="wheel-end-button" disabled={disabled} onClick={() => setFinishIntent('close')}>Завершить игру</button></div></header>
    {collecting && <><section className="wheel-prep-heading"><div><h1>Подготовка комнаты</h1><p>Добавьте имена и задания перед стартом</p></div><div className="wheel-counters"><article><span>◉ Имен</span><strong>{getAvailableWheelCount(wheel, 'name')}</strong></article><article><span>▣ Заданий</span><strong>{getAvailableWheelCount(wheel, 'task')}</strong></article><article><span>♙ Участников</span><strong>{Object.keys(entries).length}</strong></article></div></section>
      <WheelJoinPanel joinUrl={joinUrl} entries={entries} />
      {wheel?.config.inputMode === 'host' && <section className="wheel-host-input"><div><label>Введите имя участника<input value={name} onChange={event => setName(event.target.value)} maxLength={60} /></label><button type="button" className="button secondary" disabled={busy || !name.trim() || Object.keys(names).length >= 50} onClick={() => add('names')}>＋ Добавить имя</button></div><div><label>Введите задание<textarea value={task} onChange={event => setTask(event.target.value)} maxLength={240} /></label><button type="button" className="button secondary" disabled={busy || !task.trim() || Object.keys(tasks).length >= 50} onClick={() => add('tasks')}>＋ Добавить задание</button></div></section>}
      <div className="wheel-pools"><WheelList title="Имена участников" items={names} onDelete={wheel?.config.inputMode === 'host' ? id => removeItem('names', id) : undefined} onClear={wheel?.config.inputMode === 'host' ? () => clearItems('names') : undefined} /><WheelList title="Задания" items={tasks} onDelete={wheel?.config.inputMode === 'host' ? id => removeItem('tasks', id) : undefined} onClear={wheel?.config.inputMode === 'host' ? () => clearItems('tasks') : undefined} /></div>
      <div className="wheel-prep-actions"><button type="button" className="button" disabled={disabled || !valid} onClick={() => void run(() => markWheelReady(session.roomId))}>▶ Начать игру</button></div>{!valid && <p className="wheel-hint">Для начала нужны одинаковые списки: от 2 до 50 имён и столько же заданий. Сейчас: {Object.keys(names).length} / {Object.keys(tasks).length}.</p>}</>}
    {!collecting && wheel && <section className="glass wheel-game-panel"><WheelAudiencePanel phase={wheel.phase} drawOrder={wheel.config.drawOrder} round={fullVisibleRound(wheel)} activeSpin={ending ? undefined : wheel.activeSpin || undefined} history={history} nameCount={getAvailableWheelCount(wheel, 'name')} taskCount={getAvailableWheelCount(wheel, 'task')} roundCount={history.length} pendingCount={pending.length} idleItems={activeRoundItems} stopAnimation={ending} /><div className="wheel-game-actions">
      {nextTarget && !confirmation && <button type="button" className="button" disabled={disabled} onClick={() => void run(() => startWheelSpin(session.roomId))}>{nextTarget === 'name' ? '▶ Крутить колесо имён' : '▶ Крутить колесо заданий'}</button>}
      {confirmation && <><button type="button" className="button" disabled={disabled} onClick={() => void run(() => startWheelSpin(session.roomId))}>{confirmationLabel}</button><button type="button" className="button secondary" disabled={disabled} onClick={() => void run(() => cancelWheelSelection(session.roomId))}>Отменить выбор</button></>}
      {spinning && <button type="button" className="button" disabled>Колесо вращается…</button>}
      {decision && <><button type="button" className="button" disabled={disabled} onClick={() => void run(() => startWheelRound(session.roomId))}>Выполнить сейчас</button><button type="button" className="button secondary" disabled={disabled} onClick={() => void run(() => markWheelRoundPending(session.roomId))}>Добавить в библиотеку</button><button type="button" className="button secondary" disabled={disabled} onClick={() => void run(() => cancelWheelSelection(session.roomId))}>Отменить выбор</button></>}
      {performing && wheel.currentRound && <button type="button" className="button" disabled={disabled} onClick={() => void run(() => activeRoundPending ? completeWheelPendingTask(session.roomId, wheel.currentRound!.roundId) : markWheelRoundCompleted(session.roomId))}>▣ Задание выполнено</button>}
    </div></section>}
    {pending.length > 0 && <section className="glass wheel-pending"><div><p className="eyebrow">▤ БИБЛИОТЕКА</p><h2>Отложенные задания</h2><p>Откройте сохранённую пару без нового вращения.</p></div><ul>{pending.map(item => <li key={item.pendingId}><div><b>{item.participantName}</b><span>{item.taskText}</span></div><button type="button" className="button secondary" disabled={disabled || performing} onClick={() => void run(() => openWheelPendingTask(session.roomId, item.pendingId))}>Открыть задание</button></li>)}</ul></section>}
    {wheel?.phase === 'completed' && <section className="glass wheel-finish-screen"><p className="eyebrow">ИГРА ЗАВЕРШЕНА</p><h2>Все доступные пары разыграны</h2><p>История этой игры сохранится в архиве. Для нового состава участников создайте отдельную игровую сессию.</p><div><button type="button" className="button" disabled={disabled} onClick={playAgain}>Сыграть ещё раз</button><button type="button" className="button secondary" disabled={disabled} onClick={() => setFinishIntent('exit')}>Выйти в главное меню</button></div></section>}
    {finishIntent && <div className="wheel-finish-dialog" role="dialog" aria-modal="true" aria-labelledby="wheel-finish-title"><section><p className="eyebrow">ЗАВЕРШЕНИЕ ИГРЫ</p><h2 id="wheel-finish-title">{finishIntent === 'exit' ? 'Выйти из игры?' : 'Завершить игру?'}</h2><p>Участники больше не смогут отправлять данные. История раундов и результаты останутся в архиве.</p><div><button type="button" className="button" disabled={disabled} onClick={() => void confirmFinish()}>{ending ? 'Завершаем…' : 'Подтвердить завершение'}</button><button type="button" className="button secondary" disabled={ending} onClick={() => setFinishIntent(null)}>Отмена</button></div></section></div>}
    {error && <p className="connection-warning">{error}</p>}
  </div>
}

export function WheelMainScreen({ session }: ModeMainScreenProps) {
  const wheel = session.wheel; const names = getAvailableWheelCount(wheel, 'name'); const tasks = getAvailableWheelCount(wheel, 'task'); const entries = Object.keys(wheel?.participants || {}).length
  if (wheel && wheel.phase !== 'collecting') { const history: WheelPublicHistoryItem[] = Object.values(wheel.rounds || {}).map(round => ({ roundId: round.roundId, nameText: round.nameText, taskText: round.taskText, status: round.status })); return <main className="stage-dashboard wheel-stage"><div className="stage-light" /><WheelAudiencePanel phase={wheel.phase} drawOrder={wheel.config.drawOrder} round={fullVisibleRound(wheel)} activeSpin={wheel.activeSpin || undefined} history={history} nameCount={names} taskCount={tasks} roundCount={history.length} pendingCount={Object.values(wheel.pendingTasks || {}).filter(item => item.status === 'pending').length} /><p className="stage-privacy">Результат синхронизирован с экраном ведущего. Управление доступно только ведущему.</p></main> }
  return <main className="stage-dashboard wheel-stage"><div className="stage-light" /><header className="stage-header"><div><p className="eyebrow">КОЛЕСО ФОРТУНЫ</p><h1>Собираем имена и задания</h1></div><span className="stage-live">ОЖИДАНИЕ</span></header><section className="wheel-stage-grid"><article><strong>{entries}</strong><span>участников отправили данные</span></article><article><strong>{names}</strong><span>имён в колесе</span></article><article><strong>{tasks}</strong><span>заданий в колесе</span></article></section><p className="stage-privacy">Имена и тексты заданий на общем экране появятся только после запуска колеса.</p></main>
}

export function WheelParticipantPlaceholder(_props: ParticipantQuestionScreenProps) { return null }
