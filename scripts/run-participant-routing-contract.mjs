import { mkdtemp, readFile, rm } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { build } from 'vite'

const require = createRequire(import.meta.url)

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
  require('../functions/quizAnswerPolicy.contract.test.cjs')
  const firebaseSource = await readFile(new URL('../src/lib/firebase.ts', import.meta.url), 'utf8')
  assert.match(firebaseSource, /const reconciled = await get\(ref\(services\.db, roomParticipantPath\(roomId, participant\.id\)\)\)\.catch\(\(\) => null\)/)
  assert.match(firebaseSource, /if \(reconciled\?\.exists\(\)\) return reconciled\.val\(\) as Participant/)
  assert.doesNotMatch(firebaseSource, /Не удалось подключиться к комнате\. Возможно, она завершена или уже заполнена\./)
  console.log('Architecture and participant routing contracts passed.')
} finally {
  await rm(outputDir, { recursive: true, force: true })
}
