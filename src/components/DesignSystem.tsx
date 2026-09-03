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
