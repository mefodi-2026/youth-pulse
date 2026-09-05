import { useEffect, useId, useRef } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

let openModalCount = 0

export interface ModalProps {
  open: boolean
  title: string
  children: ReactNode
  onClose?: () => void
  closeLabel?: string
  labelledBy?: string
  className?: string
}

/**
 * Shared blocking overlay for host and game modules. It intentionally does not
 * close on backdrop click: confirmations stay explicit and the page beneath it
 * never receives an accidental action.
 */
export function Modal({ open, title, children, onClose, closeLabel = 'Закрыть', labelledBy, className = '' }: ModalProps) {
  const generatedId = useId()
  const titleId = labelledBy || generatedId
  const dialogRef = useRef<HTMLElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    openModalCount += 1
    document.documentElement.classList.add('app-modal-open')
    const frame = window.requestAnimationFrame(() => dialogRef.current?.focus({ preventScroll: true }))
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && onClose) {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const dialog = dialogRef.current
      if (!dialog) return
      const focusable = [...dialog.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter(element => !element.hasAttribute('hidden'))
      if (!focusable.length) {
        event.preventDefault()
        dialog.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('keydown', onKeyDown)
      openModalCount = Math.max(0, openModalCount - 1)
      if (!openModalCount) document.documentElement.classList.remove('app-modal-open')
      returnFocusRef.current?.focus({ preventScroll: true })
    }
  }, [open])

  if (!open) return null
  return createPortal(<div className={`app-modal ${className}`.trim()} role="presentation">
    <section ref={dialogRef} className="app-modal-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
      <header className="app-modal-header"><h2 id={titleId}>{title}</h2>{onClose && <button type="button" className="app-modal-close" aria-label={closeLabel} onClick={onClose}>×</button>}</header>
      <div className="app-modal-content">{children}</div>
    </section>
  </div>, document.body)
}
