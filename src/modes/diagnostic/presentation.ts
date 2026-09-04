import type { Session, SessionPhase } from '../../types'

const labels: Record<SessionPhase, string> = {
  lobby: 'Сбор участников',
  live: '«Проверь себя» идёт',
  personal: 'Личные результаты',
  resultsIntro: 'Готовим общий результат',
  resultsReal: 'Общий результат открыт',
  closed: 'Сессия завершена',
}

export const diagnosticStatusText = (session: Pick<Session, 'phase'>) => labels[session.phase]
export const diagnosticStatusDescription = (session: Pick<Session, 'phase'>) => {
  if (session.phase === 'lobby') return 'Покажите QR-код участникам, затем запустите «Проверь себя». '
  if (session.phase === 'live') return 'Прогресс участников синхронизируется в реальном времени.'
  return 'Можно открыть общий результат или завершить комнату после встречи.'
}
