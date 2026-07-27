import { readFile, writeFile } from 'node:fs/promises'

const basePath = process.env.VITE_BASE_PATH || '/'
const target = basePath.endsWith('/') ? basePath : `${basePath}/`
const index = await readFile('dist/index.html', 'utf8')
const redirect = `<script>sessionStorage.setItem('atmosphere-spa-redirect', window.location.href);window.location.replace(${JSON.stringify(target)});</script>`

await writeFile('dist/404.html', index.replace('<head>', `<head>${redirect}`), 'utf8')
