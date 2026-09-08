const assetUrl = (fileName: string) => `${import.meta.env.BASE_URL}assets/${fileName}`

export const homeAssets = {
  logo: assetUrl('youth-vibe-logo-white.png'),
  diagnostic: assetUrl('mode-diagnostic-checklist.png'),
  quiz: assetUrl('mode-bible-book.png'),
  wheel: assetUrl('mode-fortune-wheel.png'),
} as const

const homeAssetUrls = Object.values(homeAssets)
const requests = new Map<string, Promise<boolean>>()
let firstPreload: Promise<void> | null = null

const loadAndDecodeImage = (url: string) => {
  const existing = requests.get(url)
  if (existing) return existing

  const request = new Promise<boolean>(resolve => {
    const image = new Image()
    image.decoding = 'async'
    image.setAttribute('fetchpriority', 'high')
    image.onload = () => {
      void image.decode().catch(() => undefined).finally(() => resolve(true))
    }
    image.onerror = () => resolve(false)
    image.src = url
  })
  requests.set(url, request)
  return request
}

/** Starts beside the access check and never blocks the host shell forever. */
export const preloadHomeAssets = (timeoutMs = 3500) => {
  if (typeof window === 'undefined') return Promise.resolve()
  if (firstPreload) return firstPreload

  const ready = Promise.all(homeAssetUrls.map(loadAndDecodeImage)).then(() => undefined)
  firstPreload = new Promise<void>(resolve => {
    const timeout = window.setTimeout(resolve, timeoutMs)
    void ready.then(() => {
      window.clearTimeout(timeout)
      resolve()
    })
  })
  return firstPreload
}
