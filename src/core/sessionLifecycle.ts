import type { PublicRoom, Session } from '../types'

/** A real action is required to keep a room active; merely viewing a page is not. */
export const SESSION_INACTIVITY_MS = 10 * 60 * 1000
export const SESSION_EXPIRY_WARNING_MS = 2 * 60 * 1000

type ActivityStampedRoom = Pick<Session, 'createdAt' | 'lastActivityAt' | 'phase'> | Pick<PublicRoom, 'createdAt' | 'lastActivityAt' | 'phase'>

export const sessionActivityAt = (room: ActivityStampedRoom | null | undefined) => room?.lastActivityAt || room?.createdAt || 0

export const isSessionExpired = (room: ActivityStampedRoom | null | undefined, at = Date.now()) => {
  if (!room || room.phase === 'closed') return false
  return at - sessionActivityAt(room) >= SESSION_INACTIVITY_MS
}

export const sessionWillExpireSoon = (room: ActivityStampedRoom | null | undefined, at = Date.now()) => {
  if (!room || room.phase === 'closed') return false
  const remaining = SESSION_INACTIVITY_MS - (at - sessionActivityAt(room))
  return remaining > 0 && remaining <= SESSION_EXPIRY_WARNING_MS
}
