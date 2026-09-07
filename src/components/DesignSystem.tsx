import type { ButtonHTMLAttributes, ReactNode } from 'react'

type SurfaceProps = {
  children: ReactNode
  className?: string
}

type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> & {
  secondary?: boolean
  danger?: boolean
  onClick?: () => void
}

export function Surface({ children, className = '' }: SurfaceProps) {
  return <section className={`glass ${className}`.trim()}>{children}</section>
}

export function Button({ children, secondary = false, danger = false, className = '', ...props }: ButtonProps) {
  const variantClass = danger ? 'danger' : secondary ? 'secondary' : ''
  return <button className={`button ds-button ${variantClass} ${className}`.trim()} {...props}>{children}</button>
}

export function Icon({ children, label }: { children: ReactNode; label?: string }) {
  return <span className="ds-icon" aria-hidden={label ? undefined : true} aria-label={label}>{children}</span>
}

export type AppIconName =
  | 'arrow-right' | 'plus' | 'eye' | 'edit' | 'trash' | 'flag'
  | 'dashboard' | 'room' | 'history' | 'diagnostic' | 'quiz' | 'wheel'
  | 'settings' | 'profile' | 'rules'

const iconPaths: Record<AppIconName, ReactNode> = {
  'arrow-right': <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
  plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
  eye: <><path d="M2.5 12s3.4-6 9.5-6 9.5 6 9.5 6-3.4 6-9.5 6-9.5-6-9.5-6Z" /><circle cx="12" cy="12" r="2.5" /></>,
  edit: <><path d="M4 20h4l11-11a2.8 2.8 0 0 0-4-4L4 16v4Z" /><path d="m13.5 6.5 4 4" /></>,
  trash: <><path d="M4 7h16" /><path d="M9 7V4h6v3" /><path d="M6 7l1 13h10l1-13" /><path d="M10 11v5" /><path d="M14 11v5" /></>,
  flag: <><path d="M5 21V4" /><path d="M5 5c3.2-2 6.5 2 10 0 1.5-.9 2.8-.9 4 0v9c-1.2-.9-2.5-.9-4 0-3.5 2-6.8-2-10 0" /></>,
  dashboard: <><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></>,
  room: <><path d="M4 20V5a1 1 0 0 1 1-1h10v16" /><path d="M15 9h4a1 1 0 0 1 1 1v10" /><path d="M8 8h3M8 12h3M8 16h3" /><path d="M2 20h20" /></>,
  history: <><path d="M4 5v5h5" /><path d="M5.4 14.7A7 7 0 1 0 5 10" /><path d="M12 8v4l2.8 1.8" /></>,
  diagnostic: <><circle cx="12" cy="12" r="8" /><path d="m9.3 12 1.8 1.8 3.8-4" /></>,
  quiz: <><path d="M5 5.5A2.5 2.5 0 0 1 7.5 3H19v16H7.5A2.5 2.5 0 0 0 5 21.5v-16Z" /><path d="M5 5.5A2.5 2.5 0 0 1 7.5 8H19" /><path d="M10 11h5M10 14h4" /></>,
  wheel: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="1.5" /><path d="m12 4 2 6M20 12l-6 2M12 20l-2-6M4 12l6-2" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.04 2.04-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.04 1.56v.1h-2.88v-.1a1.7 1.7 0 0 0-1.04-1.56 1.7 1.7 0 0 0-1.88.34l-.06.06-2.04-2.04.06-.06A1.7 1.7 0 0 0 7.3 15a1.7 1.7 0 0 0-1.56-1.04h-.1v-2.88h.1A1.7 1.7 0 0 0 7.3 10.04a1.7 1.7 0 0 0-.34-1.88L6.9 8.1l2.04-2.04.06.06a1.7 1.7 0 0 0 1.88.34A1.7 1.7 0 0 0 11.92 4.9v-.1h2.88v.1a1.7 1.7 0 0 0 1.04 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.04 2.04-.06.06a1.7 1.7 0 0 0-.34 1.88 1.7 1.7 0 0 0 1.56 1.04h.1v2.88h-.1A1.7 1.7 0 0 0 19.4 15Z" /></>,
  profile: <><circle cx="12" cy="8" r="3.5" /><path d="M5 20c.7-3.2 3.1-5 7-5s6.3 1.8 7 5" /></>,
  rules: <><path d="M7 4h10a2 2 0 0 1 2 2v14H7a2 2 0 0 0-2 2V6a2 2 0 0 1 2-2Z" /><path d="M8 9h7M8 13h7M8 17h4" /></>,
}

/** Shared inline SVGs keep visual weight stable across host actions. */
export function AppIcon({ name, label, size = 18 }: { name: AppIconName; label?: string; size?: number }) {
  return <svg className="app-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden={label ? undefined : true} aria-label={label}>{iconPaths[name]}</svg>
}

export function StatusBadge({ children, tone = 'default', className = '' }: { children: ReactNode; tone?: 'default' | 'accent' | 'muted'; className?: string }) {
  return <span className={`ds-status ds-status-${tone} ${className}`.trim()}>{children}</span>
}

/** A neutral, mode-independent waiting state. It deliberately contains no
 * product-mode copy, so an unresolved room can never flash another mode. */
export function LoadingState({ eyebrow = 'ПОДКЛЮЧАЕМ', title = 'Загружаем…', description, className = '' }: { eyebrow?: string; title?: ReactNode; description?: ReactNode; className?: string }) {
  return <section className={`ds-loading-state ${className}`.trim()} role="status" aria-live="polite">
    <span className="ds-loading-spinner" aria-hidden="true" />
    <div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1>{description && <p>{description}</p>}</div>
  </section>
}

export function PageHeader({ eyebrow, title, description, status, className = '' }: { eyebrow?: string; title: ReactNode; description?: ReactNode; status?: ReactNode; className?: string }) {
  return <header className={`ds-page-header ${className}`.trim()}>
    <div>
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <h1>{title}</h1>
      {description && <p className="ds-page-header-description">{description}</p>}
    </div>
    {status && <div className="ds-page-header-status">{status}</div>}
  </header>
}
