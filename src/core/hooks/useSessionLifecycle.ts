import { useEffect, useRef, useState } from 'react'
import { isSessionExpired, sessionWillExpireSoon } from '../sessionLifecycle'
import type { Session } from '../../types'

/**
 * Cross-device expiry is based on the persisted timestamp. The interval is
 * only a convenience for an open host screen; reloads re-check the same value.
 */
export function useSessionLifecycle(session: Session | null, onExpired: () => Promise<boolean>) {
  const [expiringSoon, setExpiringSoon] = useState(false)
  const closingRef = useRef(false)
  const onExpiredRef = useRef(onExpired)
  onExpiredRef.current = onExpired

  useEffect(() => {
    closingRef.current = false
    if (!session || session.phase === 'closed') { setExpiringSoon(false); return }
    let active = true
    const evaluate = () => {
      if (!active) return
      if (isSessionExpired(session)) {
        setExpiringSoon(false)
        if (!closingRef.current) {
          closingRef.current = true
          void onExpiredRef.current().finally(() => { if (active) closingRef.current = false })
        }
        return
      }
      setExpiringSoon(sessionWillExpireSoon(session))
    }
    evaluate()
    const timer = window.setInterval(evaluate, 15_000)
    return () => { active = false; window.clearInterval(timer) }
  }, [session?.roomId, session?.phase, session?.lastActivityAt])

  return { expiringSoon, expired: isSessionExpired(session) }
}
