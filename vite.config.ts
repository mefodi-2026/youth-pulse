import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { execFileSync } from 'node:child_process'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const base = env.VITE_BASE_PATH || '/'
  const buildRevision = env.VERCEL_GIT_COMMIT_SHA || env.GITHUB_SHA || execFileSync('git', ['rev-parse', 'HEAD'], { encoding:'utf8' }).trim()

  return {
    plugins: [react()],
    define: { 'import.meta.env.VITE_BUILD_REVISION': JSON.stringify(buildRevision) },
    base: base.endsWith('/') ? base : `${base}/`,
  }
})
