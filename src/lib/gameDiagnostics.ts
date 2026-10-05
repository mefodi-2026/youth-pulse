// A local console trace only: no payloads, identity, room codes or network sink.
export type GameStage = 'guest-auth' | 'guest-join' | 'guest-callable' | 'answer-callable' | 'answer-write' | 'start' | 'subscription' | 'first-question'
const codes = new Set(['aborted', 'already-exists', 'cancelled', 'data-loss', 'deadline-exceeded', 'failed-precondition', 'internal', 'invalid-argument', 'not-found', 'out-of-range', 'permission-denied', 'resource-exhausted', 'unauthenticated', 'unavailable', 'unimplemented', 'network-request-failed', 'timeout', 'permission_denied'])
export function safeGameErrorCode(error: unknown): string {
  const raw = typeof error === 'object' && error && 'code' in error ? String(error.code).toLowerCase().split('/').pop() || '' : ''
  return codes.has(raw) ? raw : 'unknown'
}
export function gameDiagnostic(stage: GameStage, outcome: 'begin' | 'confirmed' | 'error', error?: unknown, requestId?: string) {
  requestId ||= typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `local-${Date.now()}-${Math.random().toString(36).slice(2,10)}`
  const record = {build:import.meta.env.VITE_BUILD_REVISION || 'local-unversioned', stage, outcome, code:outcome === 'error' ? safeGameErrorCode(error) : 'ok', time:new Date().toISOString(), requestId}
  // Never pass error objects/messages: SDK errors can contain request payloads.
  try { console.info('[game-diagnostic]', JSON.stringify(record)) } catch { /* telemetry cannot interrupt gameplay */ }
  return requestId
}
export async function traceGameOperation<T>(stage: GameStage, action: () => Promise<T>): Promise<T> {
  const requestId = gameDiagnostic(stage, 'begin')
  try { const value = await action(); gameDiagnostic(stage, 'confirmed', undefined, requestId); return value }
  catch(error) { gameDiagnostic(stage, 'error', error, requestId); throw error }
}
