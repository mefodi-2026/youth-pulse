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
      ssr: 'src/modes/participantRouting.contract.test.ts',
      outDir: outputDir,
      emptyOutDir: true,
      rollupOptions: { output: { entryFileNames: 'participant-routing-contract.mjs' } },
    },
  })
  await import(`${pathToFileURL(join(outputDir, 'participant-routing-contract.mjs')).href}?run=${Date.now()}`)
  console.log('Participant routing contracts passed.')
} finally {
  await rm(outputDir, { recursive: true, force: true })
}
