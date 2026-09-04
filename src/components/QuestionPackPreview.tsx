import { useId, useState } from 'react'
import type { Question } from '../types'
import { Button } from './DesignSystem'
import { Modal } from './Modal'

type QuestionPackPreviewProps = {
  modeLabel: 'Проверь себя' | 'Библейская викторина'
  packId: string
  questions: Question[]
  title?: string
  description?: string
  className?: string
}

type RestrictedAction = 'edit' | 'delete' | null

/**
 * A read-only, locally controlled preview. Its action dialog is intentionally
 * scoped to this pack instance so neither another pack nor another mode can
 * surface an unrelated notice.
 */
export function QuestionPackPreview({ modeLabel, packId, questions, title, description, className = '' }: QuestionPackPreviewProps) {
  const [expanded, setExpanded] = useState(false)
  const [restrictedAction, setRestrictedAction] = useState<RestrictedAction>(null)
  const contentId = useId()
  const actionLabel = restrictedAction === 'delete' ? 'Удаление' : 'Редактирование'
  const restrictedMessage = `Редактирование и удаление вопросов в режиме «${modeLabel}» пока недоступны. Эта возможность появится после выпуска полноценного приложения.`

  return <section className={`question-pack-preview ${expanded ? 'is-open' : ''} ${className}`.trim()} data-pack-id={packId}>
    <header className="question-pack-preview-header">
      <div className="question-pack-preview-copy">
        {title && <h3>{title}</h3>}
        <p>{questions.length} вопросов{description ? ` · ${description}` : ''}</p>
      </div>
      <div className="question-pack-preview-actions">
        <Button secondary aria-expanded={expanded} aria-controls={contentId} onClick={() => setExpanded(value => !value)}>{expanded ? 'Скрыть вопросы' : 'Показать вопросы'}</Button>
        <Button secondary onClick={() => setRestrictedAction('edit')}>Редактировать</Button>
        <Button secondary danger onClick={() => setRestrictedAction('delete')}>Удалить</Button>
      </div>
    </header>
    <div id={contentId} className="question-pack-preview-collapse" aria-hidden={!expanded}>
      <div className="question-pack-preview-scroll">
        <ol className="question-pack-preview-list">
          {questions.map((question, index) => <li key={question.id}>
            <b>{index + 1}. {question.title}</b>
            <span>{Object.entries(question.options).map(([key, value]) => `${key}: ${value}`).join(' · ')}</span>
          </li>)}
        </ol>
      </div>
    </div>
    <Modal open={restrictedAction !== null} title={`${actionLabel} недоступно`} onClose={() => setRestrictedAction(null)}>
      <p>{restrictedMessage}</p>
      <div className="app-modal-actions"><Button secondary onClick={() => setRestrictedAction(null)}>Понятно</Button></div>
    </Modal>
  </section>
}
