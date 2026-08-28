import type { RoomMode } from '../types'
import type { GameModule, ModeDataContract, ModeSetupPolicy, ModeSurfaceLinks } from './contracts'
import type { ComponentType } from 'react'
import type { ParticipantQuestionScreenProps } from './participantTypes'
import { diagnosticManifest } from './diagnostic/manifest'
import { quizManifest } from './quiz/manifest'

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
  routes: { setup: string; participant: string; host: string; results: string }
  surfaces: ModeSurfaceLinks
  dataContract: ModeDataContract
  capabilities: readonly string[]
}

export const createModeRegistry = <T extends ModeManifest>(manifests: readonly T[]) => {
  const entries = manifests.map(manifest => [manifest.id, manifest] as const)
  if (new Set(entries.map(([id]) => id)).size !== entries.length) throw new Error('Mode registry contains duplicate IDs.')
  return Object.freeze(Object.fromEntries(entries) as Readonly<Record<string, T>>)
}

const registry = createModeRegistry([diagnosticManifest, quizManifest] as const)

export const modeRegistry = registry as Readonly<Record<RoomMode, ModeManifest>>
export const productionModes = Object.values(modeRegistry).filter(manifest => manifest.productionMenu)

/** Old rooms without mode/gameTypeId remain diagnostics by contract. */
export const getModeManifest = (mode?: string) => {
  if (!mode) return diagnosticManifest
  const manifest = registry[mode]
  if (!manifest) throw new Error(`Неизвестный режим комнаты: ${mode}`)
  return manifest
}

/** Compatibility name used by the current host shell. */
export const getModeDefinition = getModeManifest
