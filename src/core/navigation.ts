import { useEffect, useState } from 'react'

const appBasePath = import.meta.env.BASE_URL.replace(/\/$/, '')
export const currentPath = () => window.location.pathname.replace(/\/+$/, '') || '/'
export const queryRoom = () => new URLSearchParams(window.location.search).get('room')?.toUpperCase() || ''
export const go = (path: string) => { window.history.pushState({}, '', `${appBasePath}${path}`); window.dispatchEvent(new PopStateEvent('popstate')) }
export const replace = (path: string) => { window.history.replaceState({}, '', `${appBasePath}${path}`); window.dispatchEvent(new PopStateEvent('popstate')) }

export function useRoute() {
  const [path, setPath] = useState(currentPath())
  useEffect(() => { const listener = () => setPath(currentPath()); window.addEventListener('popstate', listener); return () => window.removeEventListener('popstate', listener) }, [])
  return path
}
