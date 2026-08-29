import { get, onValue, push, ref, remove, set, update } from 'firebase/database'
import { signInAnonymously } from 'firebase/auth'
import { firebaseAuth, firebaseAuthPersistence, firebaseDb, firebaseReady } from '../../repositories/firebaseClient'
import type { PublicRoom, Session } from '../../types'
import { createInitialWheelState } from './stateMachine'
import { wheelGameTypeId, wheelProductId } from './contract'
import { canStartWheel, validateWheelDisplayName, validateWheelParticipantEntry, validateWheelTaskText } from './validation'
import type { WheelConfig, WheelParticipantEntry, WheelPoolItem, WheelRoomState } from './types'

const runtime = () => {
  if (!firebaseReady || !firebaseDb || !firebaseAuth) throw new Error('Firebase не настроен для Колеса фортуны.')
  return { db: firebaseDb, auth: firebaseAuth }
}

const makeRoomId = () => Math.random().toString(36).slice(2, 8).toUpperCase()
const now = () => Date.now()

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
    mode: 'wheel',
    gameTypeId: wheelGameTypeId,
    productId: wheelProductId,
    packId: 'wheel-runtime-v1',
    packTitle: 'Колесо фортуны',
    wheel: { ...input.config, phase: 'collecting', nameCount: 0, taskCount: 0, submissionCount: 0 },
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

export async function addWheelHostItem(roomId: string, pool: 'names' | 'tasks', raw: string) {
  const { db } = await assertHostCollecting(roomId)
  const text = pool === 'names' ? validateWheelDisplayName(raw) : validateWheelTaskText(raw)
  const itemRef = push(ref(db, `sessions/${roomId}/wheel/pools/${pool}`))
  const item: WheelPoolItem = { itemId: itemRef.key!, text, status: 'available' }
  await set(itemRef, item)
  return item
}

export async function deleteWheelHostItem(roomId: string, pool: 'names' | 'tasks', itemId: string) {
  const { db } = await assertHostCollecting(roomId)
  await remove(ref(db, `sessions/${roomId}/wheel/pools/${pool}/${itemId}`))
}

export async function markWheelReady(roomId: string) {
  const { db, session } = await assertHostCollecting(roomId)
  const names = Object.keys(session.wheel?.pools?.names || {}).length
  const tasks = Object.keys(session.wheel?.pools?.tasks || {}).length
  if (!canStartWheel(session.wheel)) throw new Error('Для начала нужны минимум два имени и два задания.')
  await update(ref(db), {
    [`sessions/${roomId}/wheel/phase`]: 'ready',
    [`sessions/${roomId}/phase`]: 'live',
    [`sessions/${roomId}/startedAt`]: now(),
    [`publicRooms/${roomId}/wheel/phase`]: 'ready',
    [`publicRooms/${roomId}/wheel/nameCount`]: names,
    [`publicRooms/${roomId}/wheel/taskCount`]: tasks,
    [`publicRooms/${roomId}/wheel/submissionCount`]: Object.keys(session.wheel?.participants || {}).length,
    [`publicRooms/${roomId}/phase`]: 'live',
  })
}
