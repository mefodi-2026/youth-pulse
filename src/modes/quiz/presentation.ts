import type { Session, SessionPhase } from '../../types'

const labels: Record<SessionPhase, string> = {
  lobby: 'Сбор участников',
  live: 'Викторина идёт',
  personal: 'Личные результаты',
  resultsIntro: 'Готовим таблицу результатов',
  resultsReal: 'Топ-3 открыт',
  closed: 'Викторина завершена',
}

export const quizStatusText = (session: Pick<Session, 'phase'>) => labels[session.phase]
export const quizStatusDescription = (session: Pick<Session, 'phase'>) => {
  if (session.phase === 'lobby') return 'Покажите QR-код участникам, затем запустите викторину.'
  if (session.phase === 'live') return 'Ответы проверяются сервером, а таблица результатов обновляется после завершения.'
  return 'Можно открыть топ-3 или завершить викторину после встречи.'
}
