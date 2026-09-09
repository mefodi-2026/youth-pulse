export type PlatformTheme = 'dark' | 'light'

export const platformThemeStorageKey = 'youth-vibe-platform-theme'

export const readPlatformTheme = (): PlatformTheme => {
  try {
    return localStorage.getItem(platformThemeStorageKey) === 'light' ? 'light' : 'dark'
  } catch {
    return document.documentElement.dataset.platformTheme === 'light' ? 'light' : 'dark'
  }
}

/** Applies only the public/host platform theme. OwnerAdmin intentionally has
 * its own independent theme key and data attribute. */
export const applyPlatformTheme = (theme: PlatformTheme) => {
  document.documentElement.dataset.platformTheme = theme
  document.documentElement.style.colorScheme = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#edf6f0' : '#03120e')
}

export const clearPlatformTheme = () => {
  delete document.documentElement.dataset.platformTheme
  document.documentElement.style.removeProperty('color-scheme')
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#03120e')
}

export const savePlatformTheme = (theme: PlatformTheme) => {
  try { localStorage.setItem(platformThemeStorageKey, theme) } catch {}
  applyPlatformTheme(theme)
}
