import type { PublicRoom, RoomLobby, RoomMode } from '../types'
import { modeRegistry, resolveRegisteredRoomMode, type ModeManifest } from './modeRegistry'

type ParticipantRoomMetadata = Pick<PublicRoom, 'mode' | 'gameTypeId'> | Pick<RoomLobby, 'mode'>

export type ParticipantRoomModeResolution =
  | { state: 'ready'; mode: RoomMode; manifest: ModeManifest; legacy: boolean }
  | { state: 'invalid'; message: string }

/**
 * Resolves a participant route from room metadata already received from
 * Firebase. It intentionally has no implicit diagnostic default: an absent
 * mode must keep the participant in the neutral connection/error shell.
 */
export const resolveParticipantRoomMode = (metadata: ParticipantRoomMetadata | null | undefined): ParticipantRoomModeResolution => {
  const candidate = metadata?.mode || (metadata && 'gameTypeId' in metadata ? metadata.gameTypeId : undefined)
  if (!candidate) return { state: 'invalid', message: 'В данных комнаты не указан режим.' }

  const mode = resolveRegisteredRoomMode(candidate)
  if (!mode) return { state: 'invalid', message: 'Режим этой комнаты не поддерживается.' }
  const manifest = modeRegistry[mode]

  return { state: 'ready', mode, manifest, legacy: false }
}

/**
 * Rooms created before the public projection split are diagnostic by the
 * stored data contract. This explicit path is only used after a legacy lobby
 * record has been loaded; it is never a render-time fallback for a new room.
 */
export const resolveLegacyParticipantRoomMode = (lobby: RoomLobby | null | undefined): ParticipantRoomModeResolution => {
  if (!lobby) return { state: 'invalid', message: 'Комната не найдена или больше недоступна.' }
  const resolved = resolveParticipantRoomMode(lobby)
  if (resolved.state === 'ready') return resolved
  if (lobby.mode) return resolved
  return { state: 'ready', mode: 'diagnostic', manifest: modeRegistry.diagnostic, legacy: true }
}
