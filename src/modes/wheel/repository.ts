import { get, onValue, push, ref, remove, runTransaction, set, update } from 'firebase/database'
import { signInAnonymously } from 'firebase/auth'
import { firebaseAuth, firebaseAuthPersistence, firebaseDb, firebaseReady } from '../../repositories/firebaseClient'
import type { PublicRoom, Session } from '../../types'
import { createInitialWheelState } from './stateMachine'
import { wheelGameTypeId, wheelProductId } from './contract'
import { canStartWheel, validateWheelDisplayName, validateWheelParticipantEntry, validateWheelTaskText } from './validation'
import type { WheelConfig, WheelParticipantEntry, WheelPoolItem, WheelRoomState } from './types'
import {
  cancelWheelSelectionTransition,
  completePendingWheelTaskTransition,
  decideWheelRoundTransition,
  getAvailableWheelCount,
  openPendingWheelTaskTransition,
  revealWheelSelectionTransition,
  startWheelRoundTransition,
  startWheelSpinTransition,
  stopWheelForCloseTransition,
} from './engine'

const runtime = () => {
  if (!firebaseReady || !firebaseDb || !firebaseAuth) throw new Error('Firebase не настроен для Колеса фортуны.')
  return { db: firebaseDb, auth: firebaseAuth }
}

const makeRoomId = () => Math.random().toString(36).slice(2, 8).toUpperCase()
const now = () => Date.now()
const secureRandom = () => {
  const value = new Uint32Array(1)
  globalThis.crypto.getRandomValues(value)
  return value[0] / 0x100000000
}
const animationNonce = () => globalThis.crypto.randomUUID?.() || `${now()}-${Math.round(secureRandom() * 1e9)}`

export async function prepareWheelParticipantAuth() {
  const { auth } = runtime()
  await firebaseAuthPersistence
  if (!auth.currentUser) return (await signInAnonymously(auth)).user.uid
  if (!auth.currentUser.isAnonymous) throw new Error('Откройте ссылку участника в отдельном браузере или режиме инкогнито.')
  return auth.currentUser.uid
}

export async function createWheelRoom(input: { leaderUid: string; workspaceId: string; title: string; config: WheelConfig }) {
  const { db, auth } = runtime()
  await firebaseAuthPersistence
  if (!auth.currentUser || auth.currentUser.isAnonymous || auth.currentUser.uid !== input.leaderUid) throw new Error('Войдите в аккаунт ведущего ещё раз.')
  const [profile, workspace] = await Promise.all([
    get(ref(db, `users/${input.leaderUid}`)),
    get(ref(db, `workspaces/${input.workspaceId}`)),
  ])
  if (profile.child('status').val() !== 'active' || profile.child('workspaceId').val() !== input.workspaceId || workspace.child('ownerUid').val() !== input.leaderUid) {
    throw new Error('Рабочее пространство не активно или не принадлежит текущему ведущему.')
  }

  const roomId = makeRoomId()
  const createdAt = now()
  const wheel: WheelRoomState = { ...createInitialWheelState(input.config), phase: 'collecting' }
  const title = input.title.trim().slice(0, 80) || 'Колесо фортуны'
  const session: Session = {
    roomId,
    roomTitle: title,
    displayCode: roomId,
    createdAt,
    lastActivityAt: createdAt,
    phase: 'lobby',
    status: 'lobby',
    maxParticipants: 30,
    hostUid: input.leaderUid,
    createdBy: input.leaderUid,
    workspaceId: input.workspaceId,
    groupName: workspace.child('name').val() || '',
    city: workspace.child('city').val() || '',
    mode: 'wheel',
    estimatedParticipants: 30,
    participantCount: 0,
    completedCount: 0,
    selectedPackId: 'wheel-runtime-v1',
    templateSource: 'system',
    productId: wheelProductId,
    gameTypeId: wheelGameTypeId,
    packId: 'wheel-runtime-v1',
    packVersion: 1,
    sourcePackId: 'wheel-runtime-v1',
    packUpdatedAt: createdAt,
    snapshotId: `system:wheel-runtime-v1:v1:${createdAt}`,
    packSnapshot: { title: 'Колесо фортуны', description: 'Имена и задания для встречи.', questions: [], settings: { inputMode: input.config.inputMode, drawOrder: input.config.drawOrder } },
    settings: { roomMode: 'wheel', inputMode: input.config.inputMode, drawOrder: input.config.drawOrder },
    templateOrigin: 'system',
    questions: [],
    participants: {},
    wheel,
  }
  const publicRoom: PublicRoom = {
    roomId,
    roomTitle: title,
    displayCode: roomId,
    phase: 'lobby',
    maxParticipants: 30,
    createdAt,
    lastActivityAt: createdAt,
    mode: 'wheel',
    gameTypeId: wheelGameTypeId,
    productId: wheelProductId,
    packId: 'wheel-runtime-v1',
    packTitle: 'Колесо фортуны',
    wheel: { ...input.config, phase: 'collecting', version: 1, nameCount: 0, taskCount: 0, submissionCount: 0, roundCount: 0, pendingCount: 0 },
  }
  await set(ref(db, `sessions/${roomId}`), session)
  await set(ref(db, `publicRooms/${roomId}`), publicRoom)
  return roomId
}

export function subscribeWheelPublicRoom(roomId: string, callback: (room: PublicRoom | null) => void, onError?: (error: Error) => void) {
  if (!firebaseDb || !roomId) return () => undefined
  return onValue(ref(firebaseDb, `publicRooms/${roomId}`), snapshot => callback((snapshot.val() || null) as PublicRoom | null), error => onError?.(error))
}

export function subscribeOwnWheelEntry(roomId: string, participantId: string, callback: (entry: WheelParticipantEntry | null) => void, onError?: (error: Error) => void) {
  if (!firebaseDb || !roomId || !participantId) return () => undefined
  return onValue(ref(firebaseDb, `sessions/${roomId}/wheel/participants/${participantId}`), snapshot => callback((snapshot.val() || null) as WheelParticipantEntry | null), error => onError?.(error))
}

export async function saveWheelParticipantEntry(roomId: string, input: { displayName: string; taskText: string }) {
  const { db, auth } = runtime()
  await firebaseAuthPersistence
  const user = auth.currentUser
  if (!user || !user.isAnonymous) throw new Error('Откройте ссылку участника в отдельном браузере или режиме инкогнито.')
  const safe = validateWheelParticipantEntry(input)
  const room = await get(ref(db, `publicRooms/${roomId}`))
  if (!room.exists() || room.child('mode').val() !== 'wheel') throw new Error('Комната Колеса фортуны не найдена.')
  if (room.child('phase').val() === 'closed') throw new Error('Сессия завершена.')
  if (room.child('wheel/inputMode').val() !== 'participants') throw new Error('В этой комнате данные вводит ведущий.')
  if (room.child('wheel/phase').val() !== 'collecting') throw new Error('Сбор данных уже завершён. Изменения недоступны.')
  const createdAt = now()
  const previous = await get(ref(db, `sessions/${roomId}/wheel/participants/${user.uid}`))
  const entry: WheelParticipantEntry = { participantId: user.uid, ...safe, createdAt: previous.child('createdAt').val() || createdAt, updatedAt: createdAt }
  const name: WheelPoolItem = { itemId: user.uid, text: safe.displayName, sourceParticipantId: user.uid, status: 'available' }
  const task: WheelPoolItem = { itemId: user.uid, text: safe.taskText, sourceParticipantId: user.uid, status: 'available' }
  await update(ref(db), {
    [`sessions/${roomId}/wheel/participants/${user.uid}`]: entry,
    [`sessions/${roomId}/wheel/pools/names/${user.uid}`]: name,
    [`sessions/${roomId}/wheel/pools/tasks/${user.uid}`]: task,
  })
  // The participant record must exist before Rules permit that anonymous UID
  // to refresh the room activity marker.
  await set(ref(db, `sessions/${roomId}/lastActivityAt`), createdAt)
  return entry
}

async function assertHostCollecting(roomId: string) {
  const { db, auth } = runtime()
  await firebaseAuthPersistence
  const snapshot = await get(ref(db, `sessions/${roomId}`))
  if (!snapshot.exists() || snapshot.child('hostUid').val() !== auth.currentUser?.uid) throw new Error('Только ведущий этой комнаты может менять наборы.')
  if (snapshot.child('wheel/phase').val() !== 'collecting') throw new Error('После готовности наборы изменить нельзя.')
  return { db, session: snapshot.val() as Session }
}

async function touchWheelActivity(roomId: string) {
  const { db } = await assertWheelHost(roomId)
  const timestamp = now()
  await update(ref(db), {
    [`sessions/${roomId}/lastActivityAt`]: timestamp,
    [`publicRooms/${roomId}/lastActivityAt`]: timestamp,
  })
}

export async function addWheelHostItem(roomId: string, pool: 'names' | 'tasks', raw: string) {
  const { db, session } = await assertHostCollecting(roomId)
  const text = pool === 'names' ? validateWheelDisplayName(raw) : validateWheelTaskText(raw)
  const items = Object.values(session.wheel?.pools?.[pool] || {})
  if (items.length >= 50) throw new Error('В одном колесе может быть не больше 50 элементов.')
  if (pool === 'names' && items.some(item => item.text.toLocaleLowerCase('ru-RU') === text.toLocaleLowerCase('ru-RU'))) {
    throw new Error('Такое имя уже есть в списке.')
  }
  const itemRef = push(ref(db, `sessions/${roomId}/wheel/pools/${pool}`))
  const item: WheelPoolItem = { itemId: itemRef.key!, text, status: 'available' }
  await set(itemRef, item)
  await touchWheelActivity(roomId)
  return item
}

export async function deleteWheelHostItem(roomId: string, pool: 'names' | 'tasks', itemId: string) {
  const { db } = await assertHostCollecting(roomId)
  await remove(ref(db, `sessions/${roomId}/wheel/pools/${pool}/${itemId}`))
  await touchWheelActivity(roomId)
}

export async function clearWheelHostPool(roomId: string, pool: 'names' | 'tasks') {
  const { db } = await assertHostCollecting(roomId)
  await remove(ref(db, `sessions/${roomId}/wheel/pools/${pool}`))
  await touchWheelActivity(roomId)
}

export async function markWheelReady(roomId: string) {
  const { db, session } = await assertHostCollecting(roomId)
  if (!canStartWheel(session.wheel)) throw new Error('Для начала нужны одинаковые списки от 2 до 50 имён и заданий.')
  const wheel = await runWheelHostTransaction(roomId, 'markReady', state => ({ ...state, phase: 'ready', version: (state.version || 0) + 1 }))
  await update(ref(db), {
    [`sessions/${roomId}/phase`]: 'live',
    [`sessions/${roomId}/startedAt`]: now(),
    [`sessions/${roomId}/lastActivityAt`]: now(),
    [`publicRooms/${roomId}/phase`]: 'live',
    [`publicRooms/${roomId}/lastActivityAt`]: now(),
  })
  await syncWheelPublicState(roomId, wheel)
}

const publicWheelState = (state: WheelRoomState): NonNullable<PublicRoom['wheel']> => {
  const phase = state.phase
  const current = state.currentRound
  const nameVisible = Boolean(current?.selectedNameText) && ['name_revealed', 'spinning_task', 'task_revealed', 'decision', 'performing'].includes(phase)
  const taskVisible = Boolean(current?.selectedTaskText) && ['task_revealed', 'spinning_name', 'name_revealed', 'decision', 'performing'].includes(phase)
  const visibleRound = nameVisible || taskVisible ? {
    ...(nameVisible ? { selectedNameText: current?.selectedNameText } : {}),
    ...(taskVisible ? { selectedTaskText: current?.selectedTaskText } : {}),
  } : undefined
  return {
    ...state.config,
    phase,
    version: state.version || 1,
    nameCount: getAvailableWheelCount(state, 'name'),
    taskCount: getAvailableWheelCount(state, 'task'),
    submissionCount: Object.keys(state.participants || {}).length,
    roundCount: Object.keys(state.rounds || {}).length,
    pendingCount: Object.values(state.pendingTasks || {}).filter(item => item.status === 'pending').length,
    ...(state.activeSpin ? {
      activeSpin: {
        ...state.activeSpin,
        items: state.activeSpin.items.map((item, index) => ({ itemId: `sector-${index}`, text: item.text })),
        selectedItemId: `sector-${state.activeSpin.selectedIndex}`,
      },
    } : {}),
    history: Object.values(state.rounds || {}).map(round => ({
      roundId: round.roundId,
      nameText: round.nameText,
      taskText: round.taskText,
      status: round.status,
    })),
    ...(visibleRound ? { currentRound: visibleRound } : {}),
  }
}

async function syncWheelPublicState(roomId: string, state: WheelRoomState) {
  const { db } = runtime()
  await set(ref(db, `publicRooms/${roomId}/wheel`), publicWheelState(state))
}

async function runWheelWrite<T>(operation: string, path: string, write: () => Promise<T>) {
  try {
    return await write()
  } catch (reason) {
    const code = typeof reason === 'object' && reason !== null && 'code' in reason ? String(reason.code) : ''
    console.error('[wheel] Firebase write rejected', { operation, path, code, reason })
    if (code === 'PERMISSION_DENIED' || code === 'permission-denied') {
      throw new Error(`Firebase отклонил действие «${operation}» по пути ${path}. Проверьте, что вы вошли как ведущий этой комнаты.`)
    }
    throw reason
  }
}

async function assertWheelHost(roomId: string) {
  const { db, auth } = runtime()
  await firebaseAuthPersistence
  const user = auth.currentUser
  if (!user || user.isAnonymous) throw new Error('Войдите в аккаунт ведущего ещё раз.')
  const session = await get(ref(db, `sessions/${roomId}`))
  if (!session.exists() || session.child('mode').val() !== 'wheel') throw new Error('Комната Колеса фортуны не найдена.')
  if (session.child('hostUid').val() !== user.uid) throw new Error('Управлять колесом может только ведущий этой комнаты.')
  if (session.child('phase').val() === 'closed') throw new Error('Сессия уже завершена.')
  return { db }
}

async function runWheelHostTransaction(roomId: string, operation: string, transition: (state: WheelRoomState) => WheelRoomState) {
  const { db } = await assertWheelHost(roomId)
  const path = `sessions/${roomId}/wheel`
  let fallback = (await get(ref(db, path))).val() as WheelRoomState | null
  if (!fallback || fallback.mode !== 'wheel') throw new Error('Состояние Колеса фортуны не найдено.')
  const result = await runWheelWrite(operation, path, () => runTransaction(ref(db, path), value => {
    const current = (value || fallback) as WheelRoomState
    if (!current || current.mode !== 'wheel') return
    const next = transition(current)
    fallback = next
    return next
  }, { applyLocally: false }))
  if (!result.committed || !result.snapshot.exists()) throw new Error('Состояние изменилось на другом экране. Повторите действие.')
  const state = result.snapshot.val() as WheelRoomState
  await runWheelWrite(operation, `publicRooms/${roomId}/wheel`, () => syncWheelPublicState(roomId, state))
  await runWheelWrite(operation, `sessions/${roomId}/lastActivityAt`, () => touchWheelActivity(roomId))
  return state
}

export async function startWheelSpin(roomId: string) {
  const roundId = push(ref(runtime().db, `sessions/${roomId}/wheel/rounds`)).key || `round-${now()}`
  return runWheelHostTransaction(roomId, 'startSpin', state => startWheelSpinTransition(state, {
    roundId,
    createdAt: now(),
    random: secureRandom(),
    animationNonce: animationNonce(),
    durationMs: 4200,
  }))
}

export async function revealWheelSelection(roomId: string) {
  return runWheelHostTransaction(roomId, 'revealSelection', revealWheelSelectionTransition)
}

export async function cancelWheelSelection(roomId: string) {
  return runWheelHostTransaction(roomId, 'cancelSelection', cancelWheelSelectionTransition)
}

export async function markWheelRoundCompleted(roomId: string) {
  return runWheelHostTransaction(roomId, 'markCompleted', state => decideWheelRoundTransition(state, 'completed', now()))
}

export async function startWheelRound(roomId: string) {
  return runWheelHostTransaction(roomId, 'startRound', startWheelRoundTransition)
}

export async function markWheelRoundPending(roomId: string) {
  return runWheelHostTransaction(roomId, 'markPending', state => decideWheelRoundTransition(state, 'pending', now()))
}

export async function completeWheelPendingTask(roomId: string, pendingId: string) {
  return runWheelHostTransaction(roomId, 'completePendingTask', state => completePendingWheelTaskTransition(state, pendingId, now()))
}

export async function openWheelPendingTask(roomId: string, pendingId: string) {
  return runWheelHostTransaction(roomId, 'openPendingTask', state => openPendingWheelTaskTransition(state, pendingId))
}

/** Stops a transient spin before the parent room is closed and archived. */
export async function stopWheelActivity(roomId: string) {
  return runWheelHostTransaction(roomId, 'stopForClose', stopWheelForCloseTransition)
}
