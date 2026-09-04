import type { RoomMode, Session } from '../types'
import type { GameModule, ModeDataContract, ModeHostScreenProps, ModeLandingScreenProps, ModeMainScreenProps, ModeParticipantFlowProps, ModeSetupPolicy, ModeSetupScreenProps, ModeSurfaceLinks } from './contracts'
import type { ComponentType } from 'react'
import type { ParticipantQuestionScreenProps } from './participantTypes'
import { diagnosticManifest } from './diagnostic/manifest'
import { quizManifest } from './quiz/manifest'
import { wheelManifest } from './wheel/manifest'

export interface ModeManifest {
  /** Registry ID can be extended in tests before RoomMode is expanded in production. */
  id: string
  mode: RoomMode | string
  title: string
  description: string
  icon: string
  menuLabel: string
  productionMenu: boolean
  runtime: GameModule
  setupPolicy: ModeSetupPolicy
  participantScreen: ComponentType<ParticipantQuestionScreenProps>
  participantFlow?: ComponentType<ModeParticipantFlowProps>
  hostScreen?: ComponentType<ModeHostScreenProps>
  mainScreen?: ComponentType<ModeMainScreenProps>
  landingScreen?: ComponentType<ModeLandingScreenProps>
  setupScreen?: ComponentType<ModeSetupScreenProps>
  routes: { setup: string; participant: string; host: string; results: string }
  surfaces: ModeSurfaceLinks
  dataContract: ModeDataContract
  capabilities: readonly string[]
  /** Mode-owned wording prevents a room from inheriting another mode's copy. */
  statusText: (session: Pick<Session, 'phase' | 'wheel'>) => string
  statusDescription: (session: Pick<Session, 'phase' | 'wheel'>) => string
  resultsLabel: string
}

export const createModeRegistry = <T extends ModeManifest>(manifests: readonly T[]) => {
  const entries = manifests.map(manifest => [manifest.id, manifest] as const)
  if (new Set(entries.map(([id]) => id)).size !== entries.length) throw new Error('Mode registry contains duplicate IDs.')
  return Object.freeze(Object.fromEntries(entries) as Readonly<Record<string, T>>)
}

const registry = createModeRegistry([diagnosticManifest, quizManifest, wheelManifest] as const)

export const modeRegistry = registry as Readonly<Record<RoomMode, ModeManifest>>
export const productionModes = Object.values(modeRegistry).filter(manifest => manifest.productionMenu)

/** Returns only a mode explicitly registered by the product. */
export const resolveRegisteredRoomMode = (mode?: string): RoomMode | undefined => {
  const manifest = mode ? registry[mode] : undefined
  return manifest?.mode as RoomMode | undefined
}

/** Old rooms without mode/gameTypeId remain diagnostics by contract. */
export const getModeManifest = (mode?: string) => {
  if (!mode) return diagnosticManifest
  const manifest = registry[mode]
  if (!manifest) throw new Error(`Неизвестный режим комнаты: ${mode}`)
  return manifest
}

/** Compatibility name used by the current host shell. */
export const getModeDefinition = getModeManifest

export const getRoomModeTitle = (room?: Pick<Session, 'mode' | 'gameTypeId'> | null) =>
  getModeManifest(room?.mode || room?.gameTypeId).title

export const getRoomStatusText = (room?: Pick<Session, 'mode' | 'gameTypeId' | 'phase' | 'wheel'> | null) =>
  room ? getModeManifest(room.mode || room.gameTypeId).statusText(room) : 'Комната не выбрана'

export const getRoomStatusDescription = (room?: Pick<Session, 'mode' | 'gameTypeId' | 'phase' | 'wheel'> | null) =>
  room ? getModeManifest(room.mode || room.gameTypeId).statusDescription(room) : ''

export const getRoomResultsLabel = (room?: Pick<Session, 'mode' | 'gameTypeId'> | null) =>
  getModeManifest(room?.mode || room?.gameTypeId).resultsLabel
