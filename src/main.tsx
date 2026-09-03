import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import './design-system.css'

// GitHub Pages serves unknown routes through 404.html. Restore the original
// participant/host URL after that lightweight fallback brings us back to the app.
const redirectedUrl = sessionStorage.getItem('atmosphere-spa-redirect')
if (redirectedUrl) {
  sessionStorage.removeItem('atmosphere-spa-redirect')
  const redirect = new URL(redirectedUrl)
  if (redirect.origin === window.location.origin) {
    window.history.replaceState({}, '', `${redirect.pathname}${redirect.search}${redirect.hash}`)
  }
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
