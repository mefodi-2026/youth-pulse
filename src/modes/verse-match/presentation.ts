import type { Session } from '../../types'
export const verseMatchStatusText = (session: Pick<Session, 'phase'>) => session.phase === 'lobby' ? 'Сбор участников' : session.phase === 'closed' ? 'Игра завершена' : 'Игра идёт'
export const verseMatchStatusDescription = (session: Pick<Session, 'phase'>) => session.phase === 'lobby' ? 'Участники подключаются и ждут раздачи карточек.' : session.phase === 'closed' ? 'Результаты сохранены.' : 'Команды собирают полные тексты стихов.'
