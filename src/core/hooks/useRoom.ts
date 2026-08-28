import { useEffect, useState } from 'react'
import { ensureAuth, ensureParticipantRoomData, firebaseReady, subscribeSession } from '../../repositories/firebaseRepository'
import type { Session } from '../../types'
import { demoKey, getDemoSession } from '../demoSessionStore'

export function useRoom(room: string) {
  const [session, setSession] = useState<Session | null>(() => room ? getDemoSession(room) : null)
  const [connection, setConnection] = useState<'idle' | 'connecting' | 'ready' | 'error'>(room ? 'connecting' : 'idle')
  useEffect(() => {
    if (!room) { setSession(null); setConnection('idle'); return }
    setSession(null)
    if (firebaseReady) {
      let active = true
      let unsubscribe: () => void = () => undefined
      setConnection('connecting')
      void ensureAuth().then(() => {
        if (!active) return
        unsubscribe = subscribeSession(room, value => {
          if (!active) return
          setSession(value); setConnection('ready')
          if (value) void ensureParticipantRoomData(room, value).catch(error => console.warn('participant room projection was not prepared', { room, error }))
        }, () => { if (active) setConnection('error') })
      }).catch(() => { if (active) setConnection('error') })
      return () => { active = false; unsubscribe() }
    }
    const sync = (event: StorageEvent) => { if (event.key === demoKey(room)) setSession(getDemoSession(room)) }
    window.addEventListener('storage', sync); setSession(getDemoSession(room)); setConnection('ready')
    return () => window.removeEventListener('storage', sync)
  }, [room])
  return [session?.roomId === room ? session : null, setSession, connection] as const
}
