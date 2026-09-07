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
  const functionsSource = await readFile(new URL('../functions/index.js', import.meta.url), 'utf8')
  assert.match(firebaseSource, /const reconciled = await get\(ref\(services\.db, roomParticipantPath\(roomId, participant\.id\)\)\)\.catch\(\(\) => null\)/)
  assert.match(firebaseSource, /if \(reconciled\?\.exists\(\)\) return reconciled\.val\(\) as Participant/)
  assert.match(firebaseSource, /httpsCallable\(functions, 'joinRoomAsGuest'\)/)
  assert.doesNotMatch(firebaseSource, /Не удалось подключиться к комнате\. Возможно, она завершена или уже заполнена\./)
  assert.match(firebaseSource, /String\(reason\.code\)\.toLowerCase\(\)\.replaceAll\('_', '-'\)/)
  assert.match(functionsSource, /exports\.joinRoomAsGuest = onCall/)
  assert.match(functionsSource, /provider !== 'anonymous'/)
  assert.match(functionsSource, /roomRef\.transaction/)
  assert.match(functionsSource, /ROOM_DATABASE_URL = 'https:\/\/molodeh-c523e-default-rtdb\.europe-west1\.firebasedatabase\.app'/)
  assert.match(functionsSource, /initializeApp\(\{ databaseURL: ROOM_DATABASE_URL \}, ROOM_DATABASE_APP\)/)
  assert.match(functionsSource, /getDatabase\(roomDatabaseApp\)/)
  assert.match(functionsSource, /roomRef\.once\('value'\)/)
  assert.match(functionsSource, /roomRef\.transaction/)
  assert.match(functionsSource, /!current && firstTransactionPass \? initialRoom : current/)
  assert.doesNotMatch(functionsSource, /process\.env\.FIREBASE_DATABASE_URL/)
  const rulesSource = await readFile(new URL('../firebase-rules.json', import.meta.url), 'utf8')
  assert.match(rulesSource, /auth\.uid === \$participantId && auth\.token\.firebase\.sign_in_provider === 'anonymous' && !data\.exists\(\)/)
  console.log('Architecture and participant routing contracts passed.')
} finally {
  await rm(outputDir, { recursive: true, force: true })
}
