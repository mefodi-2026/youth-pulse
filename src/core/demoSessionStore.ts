import type { Session } from '../types'

export const demoKey = (room: string) => `atmosphere-demo-${room}`
export const getDemoSession = (room: string) => JSON.parse(localStorage.getItem(demoKey(room)) || 'null') as Session | null
export const setDemoSession = (session: Session) => {
  localStorage.setItem(demoKey(session.roomId), JSON.stringify(session))
  window.dispatchEvent(new StorageEvent('storage', { key: demoKey(session.roomId) }))
}
