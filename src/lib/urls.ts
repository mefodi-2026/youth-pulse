const normalizedPath = (value: string) => {
  const path = value.replace(/\\/g, '/').replace(/\/+$/, '')
  return path && path !== '/' ? path : ''
}

export const appBasePath = () => normalizedPath(import.meta.env.BASE_URL || '/')

/**
 * Builds the participant URL exactly once from the public origin and Vite base.
 * VITE_PUBLIC_ORIGIN may already include the GitHub Pages base path.
 */
export const createJoinUrl = (roomId: string, publicOrigin = window.location.origin) => {
  const url = new URL(publicOrigin, window.location.origin)
  const base = appBasePath()
  const existing = normalizedPath(url.pathname)
  const path = base && !existing.endsWith(base) ? `${existing}${base}` : existing || base
  url.pathname = `${path}/join`.replace(/\/+/g, '/')
  url.search = `?room=${encodeURIComponent(roomId)}`
  url.hash = ''
  return url.toString()
}
