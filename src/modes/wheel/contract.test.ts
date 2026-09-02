import { createInitialWheelState, canTransitionWheelPhase } from './stateMachine'
import { canStartWheel, normalizeWheelConfig, validateWheelParticipantEntry } from './validation'
import {
  cancelWheelSelectionTransition,
  completePendingWheelTaskTransition,
  decideWheelRoundTransition,
  getAvailableWheelCount,
  getWheelNextSpinTarget,
  openPendingWheelTaskTransition,
  revealWheelSelectionTransition,
  startWheelRoundTransition,
  startWheelSpinTransition,
  stopWheelForCloseTransition,
} from './engine'
import type { WheelDrawOrder, WheelRoomState } from './types'

const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(`Wheel contract failed: ${message}`)
}

const defaultConfig = normalizeWheelConfig()
assert(defaultConfig.inputMode === 'participants', 'participant input must be the safe default')
assert(defaultConfig.drawOrder === 'name_then_task', 'name-first draw must be the safe default')

const hostConfig = normalizeWheelConfig({ inputMode: 'host', drawOrder: 'task_then_name' })
const initialState = createInitialWheelState(hostConfig)
assert(initialState.mode === 'wheel', 'room state must identify the wheel mode')
assert(initialState.modeVersion === 'wheel-v1', 'room state version must be explicit')
assert(initialState.phase === 'setup', 'new wheel state must start in setup')
assert(initialState.config.inputMode === 'host', 'validated room config must be preserved')
assert(Object.keys(initialState.rounds).length === 0, 'new room must not contain implicit rounds')
assert(Object.keys(initialState.participants).length === 0, 'a replay room must start without previous participants')
assert(Object.keys(initialState.pools.names).length === 0 && Object.keys(initialState.pools.tasks).length === 0, 'a replay room must start with empty wheel pools')
assert(Object.keys(initialState.pendingTasks).length === 0 && initialState.currentRound === null && initialState.activeSpin === null, 'a replay room must not mix previous active state')

assert(canTransitionWheelPhase('setup', 'collecting'), 'setup must allow data collection')
assert(canTransitionWheelPhase('ready', 'spinning_task'), 'task-first flow must be representable')
assert(canTransitionWheelPhase('decision', 'performing'), 'selected pair must be opened before completion')
assert(!canTransitionWheelPhase('setup', 'completed'), 'state machine must reject phase skipping')

const participant = validateWheelParticipantEntry({ displayName: '  Анна  ', taskText: '  Назвать любимый стих  ' })
assert(participant.displayName === 'Анна', 'participant display name must be normalized')
assert(participant.taskText === 'Назвать любимый стих', 'participant task must be normalized')

const duplicateNames = {
  ...createInitialWheelState({ inputMode: 'participants' }),
  phase: 'collecting' as const,
  participants: {
    uidA: { participantId: 'uidA', displayName: 'Саша', taskText: 'Задание один', createdAt: 1, updatedAt: 1 },
    uidB: { participantId: 'uidB', displayName: 'Саша', taskText: 'Задание два', createdAt: 2, updatedAt: 2 },
  },
  pools: {
    names: {
      uidA: { itemId: 'uidA', text: 'Саша', sourceParticipantId: 'uidA', status: 'available' as const },
      uidB: { itemId: 'uidB', text: 'Саша', sourceParticipantId: 'uidB', status: 'available' as const },
    },
    tasks: {
      uidA: { itemId: 'uidA', text: 'Задание один', sourceParticipantId: 'uidA', status: 'available' as const },
      uidB: { itemId: 'uidB', text: 'Задание два', sourceParticipantId: 'uidB', status: 'available' as const },
    },
  },
}
assert(Object.keys(duplicateNames.participants).length === 2, 'duplicate display names must retain stable participant IDs')
assert(canStartWheel(duplicateNames), 'two valid names and tasks must enable the game')
assert(!canStartWheel({ ...duplicateNames, pools: { ...duplicateNames.pools, tasks: { uidA: duplicateNames.pools.tasks.uidA } } }), 'unequal list sizes must block the game')
assert(!canStartWheel({ ...duplicateNames, phase: 'ready' }), 'ready state must lock further collection')

const expectFailure = (job: () => unknown, message: string) => {
  let failed = false
  try { job() } catch { failed = true }
  assert(failed, message)
}

const playableState = (drawOrder: WheelDrawOrder, pairCount = 3): WheelRoomState => {
  const names = Object.fromEntries(Array.from({ length: pairCount }, (_, index) => [`name-${index}`, {
    itemId: `name-${index}`,
    text: `Участник ${index + 1}`,
    status: 'available' as const,
  }]))
  const tasks = Object.fromEntries(Array.from({ length: pairCount }, (_, index) => [`task-${index}`, {
    itemId: `task-${index}`,
    text: `Задание ${index + 1}`,
    status: 'available' as const,
  }]))
  return {
    ...createInitialWheelState({ inputMode: 'host', drawOrder }),
    phase: 'ready',
    pools: { names, tasks },
  }
}

let nameFirst = playableState('name_then_task')
assert(getWheelNextSpinTarget(nameFirst) === 'name', 'name-first flow must start with the names wheel')
nameFirst = startWheelSpinTransition(nameFirst, { roundId: 'round-a', createdAt: 10, random: 0 })
assert(nameFirst.phase === 'spinning_name', 'name wheel must enter the spinning state')
assert(nameFirst.activeSpin?.selectedIndex === 0, 'the canonical selected sector must be stored once')
assert(nameFirst.activeSpin?.items.length === 3, 'the exact animated sectors must be stored with the spin')
assert(nameFirst.activeSpin?.endsAt === 4210, 'the reveal deadline must be deterministic')
expectFailure(
  () => startWheelSpinTransition(nameFirst, { roundId: 'duplicate', createdAt: 11, random: 0 }),
  'a repeated spin click must not select another item',
)
nameFirst = revealWheelSelectionTransition(nameFirst)
assert(nameFirst.phase === 'name_revealed', 'the selected name must be revealed before the task spin')
nameFirst = startWheelSpinTransition(nameFirst, { roundId: 'round-a', createdAt: 10, random: 0 })
nameFirst = revealWheelSelectionTransition(nameFirst)
assert(nameFirst.phase === 'decision', 'two revealed elements must produce a decision')
const selectedNameId = nameFirst.currentRound?.selectedNameId || ''
const selectedTaskId = nameFirst.currentRound?.selectedTaskId || ''
nameFirst = cancelWheelSelectionTransition(nameFirst)
assert(nameFirst.phase === 'ready' && nameFirst.currentRound === null, 'cancellation must clear the current round')
assert(!nameFirst.rounds['round-a'], 'cancellation must not create history')
assert(nameFirst.pools.names[selectedNameId]?.status === 'available', 'cancellation must return the selected name')
assert(nameFirst.pools.tasks[selectedTaskId]?.status === 'available', 'cancellation must return the selected task')
assert(nameFirst.activeSpin === null, 'cancellation must clear the active animation')

let interrupted = playableState('name_then_task', 3)
interrupted = startWheelSpinTransition(interrupted, { roundId: 'round-interrupted', createdAt: 15, random: 0 })
const interruptedNameId = interrupted.currentRound?.selectedNameId || ''
interrupted = stopWheelForCloseTransition(interrupted)
assert(interrupted.activeSpin === null && interrupted.currentRound === null && interrupted.phase === 'ready', 'closing must stop an active spin and clear the transient round')
assert(interrupted.pools.names[interruptedNameId]?.status === 'available', 'closing must return an unrevealed selected item to its pool')

nameFirst = startWheelSpinTransition(nameFirst, { roundId: 'round-b', createdAt: 20, random: 0 })
nameFirst = revealWheelSelectionTransition(nameFirst)
nameFirst = startWheelSpinTransition(nameFirst, { roundId: 'round-b', createdAt: 20, random: 0 })
nameFirst = revealWheelSelectionTransition(nameFirst)
const completedNameId = nameFirst.currentRound?.selectedNameId || ''
const completedTaskId = nameFirst.currentRound?.selectedTaskId || ''
nameFirst = startWheelRoundTransition(nameFirst)
assert(nameFirst.phase === 'performing', 'a selected pair must open as a separate round')
nameFirst = decideWheelRoundTransition(nameFirst, 'completed', 21)
assert(nameFirst.rounds['round-b']?.status === 'completed', 'completed decision must be saved in history')
assert(nameFirst.pools.names[completedNameId]?.status === 'used', 'completed name must leave the active pool')
assert(nameFirst.pools.tasks[completedTaskId]?.status === 'used', 'completed task must leave the active pool')
assert(getAvailableWheelCount(nameFirst, 'name') === 2, 'a used name must not repeat')
assert(getAvailableWheelCount(nameFirst, 'task') === 2, 'a used task must not repeat')

let taskFirst = playableState('task_then_name', 2)
assert(getWheelNextSpinTarget(taskFirst) === 'task', 'task-first flow must start with the tasks wheel')
taskFirst = startWheelSpinTransition(taskFirst, { roundId: 'round-c', createdAt: 30, random: 0 })
assert(taskFirst.phase === 'spinning_task', 'task-first flow must spin a task')
taskFirst = revealWheelSelectionTransition(taskFirst)
assert(taskFirst.phase === 'task_revealed', 'the task must be revealed before the name spin')
taskFirst = startWheelSpinTransition(taskFirst, { roundId: 'round-c', createdAt: 30, random: 0 })
taskFirst = revealWheelSelectionTransition(taskFirst)
taskFirst = decideWheelRoundTransition(taskFirst, 'pending', 31)
assert(taskFirst.rounds['round-c']?.status === 'pending', 'pending decision must be saved in history')
assert(taskFirst.pendingTasks['round-c']?.participantName === 'Участник 1', 'pending library must keep the participant name')
assert(taskFirst.pendingTasks['round-c']?.taskText === 'Задание 1', 'pending library must keep the task text')
assert(taskFirst.pools.tasks['task-0']?.status === 'pending', 'a pending task must leave the active pool')
taskFirst = openPendingWheelTaskTransition(taskFirst, 'round-c')
assert(taskFirst.phase === 'performing', 'a library pair must open without a new spin')
taskFirst = completePendingWheelTaskTransition(taskFirst, 'round-c', 32)
assert(taskFirst.pendingTasks['round-c']?.status === 'completed', 'pending task must be completable later')
expectFailure(
  () => completePendingWheelTaskTransition(taskFirst, 'round-c', 33),
  'a completed pending task must not be completed twice',
)

let exhausted = playableState('name_then_task', 1)
exhausted = startWheelSpinTransition(exhausted, { roundId: 'round-last', createdAt: 40, random: 0 })
exhausted = revealWheelSelectionTransition(exhausted)
exhausted = startWheelSpinTransition(exhausted, { roundId: 'round-last', createdAt: 40, random: 0 })
exhausted = revealWheelSelectionTransition(exhausted)
exhausted = startWheelRoundTransition(exhausted)
exhausted = decideWheelRoundTransition(exhausted, 'completed', 41)
assert(exhausted.phase === 'completed', 'the room must finish when no complete pair remains')
assert(getWheelNextSpinTarget(exhausted) === null, 'an exhausted room must block further spins')
expectFailure(
  () => startWheelSpinTransition(exhausted, { roundId: 'too-late', createdAt: 42, random: 0 }),
  'an exhausted room must reject an extra spin',
)

export const wheelContractPassed = true
