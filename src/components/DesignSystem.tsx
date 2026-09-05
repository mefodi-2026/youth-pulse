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

export type AppIconName = 'arrow-right' | 'plus' | 'eye' | 'edit' | 'trash'

const iconPaths: Record<AppIconName, ReactNode> = {
  'arrow-right': <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
  plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
  eye: <><path d="M2.5 12s3.4-6 9.5-6 9.5 6 9.5 6-3.4 6-9.5 6-9.5-6-9.5-6Z" /><circle cx="12" cy="12" r="2.5" /></>,
  edit: <><path d="M4 20h4l11-11a2.8 2.8 0 0 0-4-4L4 16v4Z" /><path d="m13.5 6.5 4 4" /></>,
  trash: <><path d="M4 7h16" /><path d="M9 7V4h6v3" /><path d="M6 7l1 13h10l1-13" /><path d="M10 11v5" /><path d="M14 11v5" /></>,
}

/** Shared inline SVGs keep visual weight stable across host actions. */
export function AppIcon({ name, label, size = 18 }: { name: AppIconName; label?: string; size?: number }) {
  return <svg className="app-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden={label ? undefined : true} aria-label={label}>{iconPaths[name]}</svg>
}

export function StatusBadge({ children, tone = 'default', className = '' }: { children: ReactNode; tone?: 'default' | 'accent' | 'muted'; className?: string }) {
  return <span className={`ds-status ds-status-${tone} ${className}`.trim()}>{children}</span>
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
