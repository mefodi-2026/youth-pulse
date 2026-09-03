import type { Session, SessionPhase } from '../../types'

const fallbackLabels: Record<SessionPhase, string> = {
  lobby: 'Подготовка игры', live: 'Игра идёт', personal: 'Раунд завершён',
  resultsIntro: 'Подводим итоги', resultsReal: 'История игры открыта', closed: 'Игра завершена',
}

const wheelLabels: Record<string, string> = {
  setup: 'Настройка', collecting: 'Собираем данные', ready: 'Готово к вращению',
  spinning_name: 'Выбираем участника', name_revealed: 'Подтвердите имя',
  spinning_task: 'Выбираем задание', task_revealed: 'Подтвердите задание',
  decision: 'Пара выбрана', performing: 'Текущий раунд', completed: 'Игра завершена',
}

export const wheelStatusText = (session: Pick<Session, 'phase' | 'wheel'>) =>
  session.wheel?.phase ? wheelLabels[session.wheel.phase] || 'Колесо фортуны' : fallbackLabels[session.phase]

export const wheelStatusDescription = (session: Pick<Session, 'phase' | 'wheel'>) => {
  if (session.phase === 'closed' || session.wheel?.phase === 'completed') return 'История раундов сохранена и доступна в архиве.'
  if (session.wheel?.phase === 'collecting') return 'Соберите имена и задания, затем начните игру.'
  return 'Выбор синхронизирован с комнатой. Управление доступно только ведущему.'
}
