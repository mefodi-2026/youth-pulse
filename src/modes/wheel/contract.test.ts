import { createInitialWheelState, canTransitionWheelPhase } from './stateMachine'
import { canStartWheel, normalizeWheelConfig, validateWheelParticipantEntry } from './validation'

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

assert(canTransitionWheelPhase('setup', 'collecting'), 'setup must allow data collection')
assert(canTransitionWheelPhase('ready', 'spinning_task'), 'task-first flow must be representable')
assert(canTransitionWheelPhase('decision', 'completed'), 'decision must allow completion')
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
assert(!canStartWheel({ ...duplicateNames, phase: 'ready' }), 'ready state must lock further collection')

export const wheelContractPassed = true
