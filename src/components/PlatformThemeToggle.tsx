import { useEffect, useState } from 'react'
import { applyPlatformTheme, platformThemeStorageKey, readPlatformTheme, savePlatformTheme, type PlatformTheme } from '../lib/platformTheme'

/** A small, fixed control keeps the theme available on public, guest and host
 * screens without being coupled to a room, form, or Firebase subscription. */
export function PlatformThemeToggle() {
  const [theme, setTheme] = useState<PlatformTheme>(readPlatformTheme)

  useEffect(() => {
    applyPlatformTheme(theme)
  }, [theme])

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === platformThemeStorageKey) setTheme(event.newValue === 'light' ? 'light' : 'dark')
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const selectTheme = (nextTheme: PlatformTheme) => {
    savePlatformTheme(nextTheme)
    setTheme(nextTheme)
  }

  return <div className="platform-theme-toggle" role="group" aria-label="Тема оформления">
    <button type="button" className={theme === 'light' ? 'selected' : ''} aria-pressed={theme === 'light'} onClick={() => selectTheme('light')}><span aria-hidden="true">☼</span> Светлая</button>
    <button type="button" className={theme === 'dark' ? 'selected' : ''} aria-pressed={theme === 'dark'} onClick={() => selectTheme('dark')}><span aria-hidden="true">◐</span> Тёмная</button>
  </div>
}
