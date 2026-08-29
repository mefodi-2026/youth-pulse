import type { WheelConfig, WheelDrawOrder, WheelInputMode, WheelRoomState } from './types'

export const wheelInputModes: readonly WheelInputMode[] = ['participants', 'host']
export const wheelDrawOrders: readonly WheelDrawOrder[] = ['name_then_task', 'task_then_name']

export const normalizeWheelConfig = (value?: Partial<WheelConfig>): WheelConfig => ({
  inputMode: wheelInputModes.includes(value?.inputMode as WheelInputMode) ? value!.inputMode! : 'participants',
  drawOrder: wheelDrawOrders.includes(value?.drawOrder as WheelDrawOrder) ? value!.drawOrder! : 'name_then_task',
})

const requiredText = (value: string, label: string, maximum: number) => {
  const normalized = value.trim().replace(/\s+/g, ' ')
  if (!normalized) throw new Error(`${label} не может быть пустым.`)
  if (normalized.length > maximum) throw new Error(`${label} не может быть длиннее ${maximum} символов.`)
  return normalized
}

export const validateWheelDisplayName = (value: string) => requiredText(value, 'Имя', 60)
export const validateWheelTaskText = (value: string) => requiredText(value, 'Задание', 240)

export const validateWheelParticipantEntry = (value: { displayName: string; taskText: string }) => ({
  displayName: validateWheelDisplayName(value.displayName),
  taskText: validateWheelTaskText(value.taskText),
})

export const canStartWheel = (state?: WheelRoomState | null) => Boolean(
  state
  && state.phase === 'collecting'
  && Object.keys(state.pools?.names || {}).length >= 2
  && Object.keys(state.pools?.tasks || {}).length >= 2,
)
