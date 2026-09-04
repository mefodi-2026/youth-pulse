import { resolveLegacyParticipantRoomMode, resolveParticipantRoomMode } from './participantRouting'

const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(`Participant routing contract failed: ${message}`)
}

for (const mode of ['diagnostic', 'quiz', 'wheel'] as const) {
  const resolution = resolveParticipantRoomMode({ mode, gameTypeId: mode })
  assert(resolution.state === 'ready' && resolution.mode === mode, `${mode} must resolve before its participant flow mounts`)
}

const missing = resolveParticipantRoomMode(null)
assert(missing.state === 'invalid', 'missing metadata must not default to diagnostic')

const unknown = resolveParticipantRoomMode({ mode: 'unknown-mode' as never })
assert(unknown.state === 'invalid', 'unknown metadata must not render another mode')

const unknownLegacy = resolveLegacyParticipantRoomMode({ roomId: 'unknown', hostUid: 'host', workspaceId: 'workspace', phase: 'lobby', maxParticipants: 30, createdAt: 1, mode: 'unknown-mode' as never })
assert(unknownLegacy.state === 'invalid', 'an explicit unknown legacy mode must not default to diagnostic')

const legacy = resolveLegacyParticipantRoomMode({ roomId: 'legacy', hostUid: 'host', workspaceId: 'workspace', phase: 'lobby', maxParticipants: 30, createdAt: 1 })
assert(legacy.state === 'ready' && legacy.mode === 'diagnostic' && legacy.legacy, 'only an explicitly loaded legacy lobby may resolve to diagnostic')
