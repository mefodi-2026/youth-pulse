const assetUrl = (fileName: string) => `${import.meta.env.BASE_URL}assets/${fileName}`

export const homeAssets = {
  logo: assetUrl('youth-vibe-logo-white.png'),
  diagnostic: assetUrl('mode-diagnostic-checklist.png'),
  quiz: assetUrl('mode-bible-book.png'),
  wheel: assetUrl('mode-fortune-wheel.png'),
} as const

const homeAssetUrls = Object.values(homeAssets)
export type HomeAssetsStatus = 'idle' | 'loading' | 'ready' | 'failed'

let status: HomeAssetsStatus = 'idle'
let attempt: Promise<void> | null = null
let attemptId = 0
const listeners = new Set<() => void>()

const notify = () => listeners.forEach(listener => listener())
const loadAndDecodeImage = (url: string) => new Promise<boolean>(resolve => {
  const image = new Image()
  image.decoding = 'async'
  image.setAttribute('fetchpriority', 'high')
  image.onload = () => {
    void image.decode().then(() => resolve(true)).catch(() => resolve(false))
  }
  image.onerror = () => resolve(false)
  image.src = url
})

/** Starts before the access screen is rendered and reuses the exact display URLs. */
export const primeHomeAssets = () => {
  if (typeof window === 'undefined') return Promise.resolve()
  if (status === 'ready') return Promise.resolve()
  if (attempt) return attempt

  const id = ++attemptId
  status = 'loading'
  notify()
  attempt = Promise.all(homeAssetUrls.map(loadAndDecodeImage)).then(results => {
    if (id !== attemptId) return
    status = results.every(Boolean) ? 'ready' : 'failed'
    attempt = null
    notify()
  })
  return attempt
}

export const retryHomeAssets = () => {
  attemptId += 1
  attempt = null
  status = 'idle'
  notify()
  return primeHomeAssets()
}

export const getHomeAssetsStatus = () => status
export const subscribeHomeAssets = (listener: () => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
