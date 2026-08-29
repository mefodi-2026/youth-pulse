export const wheelMode = 'wheel' as const
export const wheelModeVersion = 'wheel-v1' as const

export type WheelInputMode = 'participants' | 'host'
export type WheelDrawOrder = 'name_then_task' | 'task_then_name'
export type WheelPhase =
  | 'setup'
  | 'collecting'
  | 'ready'
  | 'spinning_name'
  | 'name_revealed'
  | 'spinning_task'
  | 'task_revealed'
  | 'decision'
  | 'completed'

export type WheelPoolItemStatus = 'available' | 'selected' | 'used' | 'pending'
export type WheelRoundStatus = 'completed' | 'pending'

export interface WheelConfig {
  inputMode: WheelInputMode
  drawOrder: WheelDrawOrder
}

export interface WheelParticipantEntry {
  participantId: string
  displayName: string
  taskText: string
  createdAt: number
  updatedAt: number
}

export interface WheelPoolItem {
  itemId: string
  text: string
  sourceParticipantId?: string
  status: WheelPoolItemStatus
}

export interface WheelCurrentRound {
  roundId: string
  selectedNameId?: string
  selectedTaskId?: string
  selectedNameText?: string
  selectedTaskText?: string
  createdAt: number
}

export interface WheelRound extends WheelCurrentRound {
  nameId: string
  taskId: string
  nameText: string
  taskText: string
  status: WheelRoundStatus
  decidedAt: number
}

export interface WheelPendingTask {
  pendingId: string
  participantName: string
  taskText: string
  status: 'pending' | 'completed'
  createdAt: number
  completedAt?: number
}

export interface WheelRoomState {
  mode: typeof wheelMode
  modeVersion: typeof wheelModeVersion
  config: WheelConfig
  phase: WheelPhase
  version: number
  participants: Record<string, WheelParticipantEntry>
  pools: {
    names: Record<string, WheelPoolItem>
    tasks: Record<string, WheelPoolItem>
  }
  currentRound: WheelCurrentRound | null
  rounds: Record<string, WheelRound>
  pendingTasks: Record<string, WheelPendingTask>
}

export interface WheelResult {
  completedRounds: number
  pendingTasks: number
  remainingNames: number
  remainingTasks: number
}
