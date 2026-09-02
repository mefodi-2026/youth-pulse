import type { WheelCurrentRound, WheelPendingTask, WheelPoolItem, WheelRoomState, WheelRound, WheelRoundStatus, WheelSpinAnimation, WheelSpinTarget } from './types'

const cloneItems = (items?: Record<string, WheelPoolItem>) => Object.fromEntries(
  Object.entries(items || {}).map(([id, item]) => [id, { ...item }]),
)

const availableItems = (items?: Record<string, WheelPoolItem>) => Object.values(items || {})
  .filter(item => item.status === 'available')
  .sort((left, right) => left.itemId.localeCompare(right.itemId))

export const getAvailableWheelCount = (state: WheelRoomState | null | undefined, target: WheelSpinTarget) => (
  availableItems(target === 'name' ? state?.pools?.names : state?.pools?.tasks).length
)

export const getWheelNextSpinTarget = (state: WheelRoomState | null | undefined): WheelSpinTarget | null => {
  if (!state) return null
  if (state.phase === 'ready') return state.config.drawOrder === 'name_then_task' ? 'name' : 'task'
  if (state.phase === 'name_revealed' && !state.currentRound?.selectedTaskId) return 'task'
  if (state.phase === 'task_revealed' && !state.currentRound?.selectedNameId) return 'name'
  return null
}

const selectAvailableItem = (items: Record<string, WheelPoolItem>, random: number) => {
  const available = availableItems(items)
  if (!available.length) throw new Error('В этом колесе больше нет доступных элементов.')
  const normalized = Number.isFinite(random) ? Math.min(Math.max(random, 0), 0.999999999) : 0
  return available[Math.floor(normalized * available.length)]
}

export const startWheelSpinTransition = (
  state: WheelRoomState,
  input: { roundId: string; createdAt: number; random: number; animationNonce?: string; durationMs?: number },
): WheelRoomState => {
  const target = getWheelNextSpinTarget(state)
  if (!target) throw new Error('Сейчас нельзя запускать следующее колесо.')
  const names = cloneItems(state.pools?.names)
  const tasks = cloneItems(state.pools?.tasks)
  const available = availableItems(target === 'name' ? names : tasks)
  const item = selectAvailableItem(target === 'name' ? names : tasks, input.random)
  const selectedIndex = available.findIndex(candidate => candidate.itemId === item.itemId)
  const durationMs = Math.min(Math.max(input.durationMs || 4200, 1800), 8000)
  const sectorAngle = 360 / available.length
  const targetRotation = (6 * 360) + (360 - ((selectedIndex + 0.5) * sectorAngle % 360))
  const activeSpin: WheelSpinAnimation = {
    target,
    items: available.map(candidate => ({ itemId: candidate.itemId, text: candidate.text })),
    selectedItemId: item.itemId,
    selectedIndex,
    animationNonce: input.animationNonce || `${input.roundId}-${target}-${state.version + 1}`,
    targetRotation,
    durationMs,
    startedAt: input.createdAt,
    endsAt: input.createdAt + durationMs,
  }
  const currentRound: WheelCurrentRound = state.currentRound
    ? { ...state.currentRound }
    : { roundId: input.roundId, createdAt: input.createdAt }
  if (target === 'name') {
    names[item.itemId] = { ...item, status: 'selected' }
    currentRound.selectedNameId = item.itemId
    currentRound.selectedNameText = item.text
  } else {
    tasks[item.itemId] = { ...item, status: 'selected' }
    currentRound.selectedTaskId = item.itemId
    currentRound.selectedTaskText = item.text
  }
  return {
    ...state,
    phase: target === 'name' ? 'spinning_name' : 'spinning_task',
    version: (state.version || 0) + 1,
    pools: { names, tasks },
    currentRound,
    activeSpin,
  }
}

export const revealWheelSelectionTransition = (state: WheelRoomState): WheelRoomState => {
  const current = state.currentRound
  if (!current) throw new Error('Текущий выбор не найден.')
  const bothSelected = Boolean(current.selectedNameId && current.selectedTaskId)
  if (state.phase !== 'spinning_name' && state.phase !== 'spinning_task') throw new Error('Колесо сейчас не вращается.')
  return {
    ...state,
    phase: bothSelected ? 'decision' : state.phase === 'spinning_name' ? 'name_revealed' : 'task_revealed',
    version: (state.version || 0) + 1,
  }
}

export const cancelWheelSelectionTransition = (state: WheelRoomState): WheelRoomState => {
  const current = state.currentRound
  if (!current) throw new Error('Незавершённого выбора нет.')
  const names = cloneItems(state.pools?.names)
  const tasks = cloneItems(state.pools?.tasks)
  if (current.selectedNameId && names[current.selectedNameId]?.status === 'selected') names[current.selectedNameId] = { ...names[current.selectedNameId], status: 'available' }
  if (current.selectedTaskId && tasks[current.selectedTaskId]?.status === 'selected') tasks[current.selectedTaskId] = { ...tasks[current.selectedTaskId], status: 'available' }
  return { ...state, phase: 'ready', version: (state.version || 0) + 1, pools: { names, tasks }, currentRound: null, activeSpin: null }
}

export const decideWheelRoundTransition = (
  state: WheelRoomState,
  status: WheelRoundStatus,
  decidedAt: number,
): WheelRoomState => {
  const current = state.currentRound
  const allowedPhase = status === 'pending' ? state.phase === 'decision' : state.phase === 'performing'
  if (!allowedPhase || !current?.selectedNameId || !current.selectedTaskId || !current.selectedNameText || !current.selectedTaskText) {
    throw new Error('Сначала откройте имя и задание.')
  }
  const names = cloneItems(state.pools?.names)
  const tasks = cloneItems(state.pools?.tasks)
  names[current.selectedNameId] = { ...names[current.selectedNameId], status: 'used' }
  tasks[current.selectedTaskId] = { ...tasks[current.selectedTaskId], status: status === 'pending' ? 'pending' : 'used' }
  const round: WheelRound = {
    ...current,
    nameId: current.selectedNameId,
    taskId: current.selectedTaskId,
    nameText: current.selectedNameText,
    taskText: current.selectedTaskText,
    status,
    decidedAt,
  }
  const rounds = { ...(state.rounds || {}), [round.roundId]: round }
  const pendingTasks = { ...(state.pendingTasks || {}) }
  if (status === 'pending') {
    const pending: WheelPendingTask = {
      pendingId: round.roundId,
      participantName: round.nameText,
      taskText: round.taskText,
      status: 'pending',
      createdAt: decidedAt,
    }
    pendingTasks[pending.pendingId] = pending
  }
  const hasNextPair = availableItems(names).length > 0 && availableItems(tasks).length > 0
  return {
    ...state,
    phase: hasNextPair ? 'ready' : 'completed',
    version: (state.version || 0) + 1,
    pools: { names, tasks },
    currentRound: null,
    activeSpin: null,
    rounds,
    pendingTasks,
  }
}

/** Opens the selected pair as the current task. Completion remains an explicit host action. */
export const startWheelRoundTransition = (state: WheelRoomState): WheelRoomState => {
  if (state.phase !== 'decision' || !state.currentRound?.selectedNameId || !state.currentRound.selectedTaskId) {
    throw new Error('Сначала выберите имя и задание.')
  }
  return { ...state, phase: 'performing', version: (state.version || 0) + 1, activeSpin: null }
}

export const openPendingWheelTaskTransition = (state: WheelRoomState, pendingId: string): WheelRoomState => {
  const pending = state.pendingTasks?.[pendingId]
  const round = state.rounds?.[pendingId]
  if (!pending || pending.status !== 'pending' || !round) throw new Error('Отложенное задание не найдено.')
  if (state.phase !== 'ready' && state.phase !== 'completed') throw new Error('Сначала завершите текущий раунд.')
  return {
    ...state,
    phase: 'performing',
    version: (state.version || 0) + 1,
    currentRound: {
      roundId: round.roundId,
      selectedNameId: round.nameId,
      selectedTaskId: round.taskId,
      selectedNameText: round.nameText,
      selectedTaskText: round.taskText,
      createdAt: round.createdAt,
    },
    activeSpin: null,
  }
}

export const completePendingWheelTaskTransition = (state: WheelRoomState, pendingId: string, completedAt: number): WheelRoomState => {
  const pending = state.pendingTasks?.[pendingId]
  const round = state.rounds?.[pendingId]
  if (!pending || pending.status !== 'pending' || !round) throw new Error('Отложенное задание уже выполнено или не найдено.')
  if (state.phase !== 'performing' || state.currentRound?.roundId !== pendingId) throw new Error('Сначала откройте это задание из библиотеки.')
  const tasks = cloneItems(state.pools?.tasks)
  if (round?.taskId && tasks[round.taskId]) tasks[round.taskId] = { ...tasks[round.taskId], status: 'used' }
  const rounds: Record<string, WheelRound> = { ...(state.rounds || {}), [pendingId]: { ...round, status: 'completed', decidedAt: completedAt } }
  const hasNextPair = availableItems(state.pools?.names).length > 0 && availableItems(tasks).length > 0
  return {
    ...state,
    phase: hasNextPair ? 'ready' : 'completed',
    version: (state.version || 0) + 1,
    pools: { names: cloneItems(state.pools?.names), tasks },
    currentRound: null,
    activeSpin: null,
    rounds,
    pendingTasks: {
      ...(state.pendingTasks || {}),
      [pendingId]: { ...pending, status: 'completed', completedAt },
    },
  }
}
