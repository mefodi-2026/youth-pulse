import { normalizeWheelConfig } from './validation'
import { wheelMode, wheelModeVersion, type WheelConfig, type WheelPhase, type WheelRoomState } from './types'

export const wheelPhaseTransitions: Readonly<Record<WheelPhase, readonly WheelPhase[]>> = {
  setup: ['collecting'],
  collecting: ['ready'],
  ready: ['spinning_name', 'spinning_task', 'completed'],
  spinning_name: ['name_revealed', 'decision', 'ready'],
  name_revealed: ['spinning_task', 'ready'],
  spinning_task: ['task_revealed', 'decision', 'ready'],
  task_revealed: ['spinning_name', 'decision', 'ready'],
  decision: ['ready', 'completed'],
  completed: [],
}

export const canTransitionWheelPhase = (current: WheelPhase, next: WheelPhase) => wheelPhaseTransitions[current].includes(next)

export const assertWheelPhaseTransition = (current: WheelPhase, next: WheelPhase) => {
  if (!canTransitionWheelPhase(current, next)) throw new Error(`Недопустимый переход wheel: ${current} → ${next}`)
}

export const createInitialWheelState = (config?: Partial<WheelConfig>): WheelRoomState => ({
  mode: wheelMode,
  modeVersion: wheelModeVersion,
  config: normalizeWheelConfig(config),
  phase: 'setup',
  version: 1,
  participants: {},
  pools: { names: {}, tasks: {} },
  currentRound: null,
  activeSpin: null,
  rounds: {},
  pendingTasks: {},
})
