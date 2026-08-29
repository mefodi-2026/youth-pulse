import type { ModeLandingScreenProps, ModeSetupScreenProps } from '../contracts'
import type { ParticipantQuestionScreenProps } from '../participantTypes'

export function WheelLandingScreen({ onSetup }: ModeLandingScreenProps) {
  return <section className="glass mode-intro"><p className="eyebrow">НОВЫЙ РЕЖИМ · ЭТАП 1</p><h2>Колесо фортуны</h2><p>Режим подключён к общей архитектуре отдельно от диагностики и викторины. На этом этапе доступны контракты комнаты, настройки и безопасная точка входа.</p><button type="button" className="button" onClick={onSetup}>Открыть подготовленный режим</button></section>
}

export function WheelSetupPlaceholder({ onBack }: ModeSetupScreenProps) {
  return <section className="glass mode-intro"><p className="eyebrow">КОЛЕСО ФОРТУНЫ · ПОДГОТОВКА</p><h2>Контракты режима готовы</h2><p>Настройки «участники или ведущий» и порядок «имя → задание» / «задание → имя» уже определены. Создание комнаты и ввод данных появятся только на следующем техническом этапе.</p><p className="connection-warning">Комната wheel пока не создаётся — это защищает рабочие diagnostic и quiz от незавершённого сценария.</p><button type="button" className="button secondary" onClick={onBack}>Вернуться к описанию режима</button></section>
}

export function WheelParticipantPlaceholder(_props: ParticipantQuestionScreenProps) {
  return <><p className="eyebrow">КОЛЕСО ФОРТУНЫ</p><h1 className="question">Режим готовится</h1><p>Ввод имени и задания будет подключён на следующем этапе. Обновите ссылку после публикации этого сценария ведущим.</p></>
}
