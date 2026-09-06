import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'vite'

const outputDir = await mkdtemp(join(tmpdir(), 'youth-pulse-routing-contract-'))

try {
  await build({
    configFile: false,
    logLevel: 'error',
    ssr: { noExternal: true },
    build: {
      ssr: 'src/modes/architecture.contract.test.ts',
      outDir: outputDir,
      emptyOutDir: true,
      rollupOptions: { output: { entryFileNames: 'architecture-contract.mjs' } },
    },
  })
  await import(`${pathToFileURL(join(outputDir, 'architecture-contract.mjs')).href}?run=${Date.now()}`)
  console.log('Architecture and participant routing contracts passed.')
} finally {
  await rm(outputDir, { recursive: true, force: true })
}
