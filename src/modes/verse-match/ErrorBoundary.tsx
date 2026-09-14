import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button, Surface } from '../../components/DesignSystem'
import { go } from '../../core/navigation'

export class VerseMatchErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('VerseMatch render failed', error, info.componentStack) }
  render() {
    if (!this.state.error) return this.props.children
    return <main className="verse-page"><Surface className="verse-room-state"><p className="eyebrow">СОБЕРИ СТИХ</p><h1>Экран комнаты не загрузился</h1><p>Данные комнаты сохранены. Обновите экран или вернитесь в режим — новая комната не будет создана.</p><div className="verse-inline-actions"><Button onClick={() => window.location.reload()}>Повторить загрузку</Button><Button secondary onClick={() => go('/host?tab=verse-match')}>Вернуться в режим</Button></div></Surface></main>
  }
}
