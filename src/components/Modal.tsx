import { useEffect, useId } from 'react'
import type { ReactNode } from 'react'

export interface ModalProps {
  open: boolean
  title: string
  children: ReactNode
  onClose?: () => void
  closeLabel?: string
  labelledBy?: string
}

/**
 * Shared blocking overlay for host and game modules. It intentionally does not
 * close on backdrop click: confirmations stay explicit and the page beneath it
 * never receives an accidental action.
 */
export function Modal({ open, title, children, onClose, closeLabel = 'Закрыть', labelledBy }: ModalProps) {
  const generatedId = useId()
  const titleId = labelledBy || generatedId

  useEffect(() => {
    if (!open) return
    document.documentElement.classList.add('app-modal-open')
    return () => document.documentElement.classList.remove('app-modal-open')
  }, [open])

  if (!open) return null
  return <div className="app-modal" role="presentation">
    <section className="app-modal-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <header className="app-modal-header"><h2 id={titleId}>{title}</h2>{onClose && <button type="button" className="app-modal-close" aria-label={closeLabel} onClick={onClose}>×</button>}</header>
      <div className="app-modal-content">{children}</div>
    </section>
  </div>
}
