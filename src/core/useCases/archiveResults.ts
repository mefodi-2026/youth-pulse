import type { LeaderProfile, Session, SessionArchive } from '../../types'

export const selectWorkspaceArchives = (
  archives: Record<string, SessionArchive>,
  leader: Pick<LeaderProfile, 'uid' | 'workspaceId'>,
) => Object.values(archives)
  .filter(item => item.hostUid === leader.uid && (!item.workspaceId || item.workspaceId === leader.workspaceId))
  .sort((left, right) => right.archivedAt - left.archivedAt)

export const resolveResultSession = (
  roomId: string,
  activeRoomId: string,
  session: Session | null,
  archives: Record<string, SessionArchive>,
) => roomId === activeRoomId ? session : archives[roomId] || null
