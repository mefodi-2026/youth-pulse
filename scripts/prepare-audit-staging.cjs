// Generate an isolated, old-callables-only deployment input. Does NOT deploy.
// Usage: node scripts/prepare-audit-staging.cjs <existing-staging-project-id>
// Only tracked main source is copied; no production data or credentials.
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const production = 'molodeh-c523e'
const revision = 'c56b6d213b4b6869470111e5c7af71c2c9ad8308'
const root = path.resolve(__dirname, '..')
const allowed = ['createQuizRoom', 'joinRoomAsGuest', 'submitQuizAnswer']
function validateProject(project) {
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project || '') || project === production)
    throw Error('An explicitly supplied NONproduction project ID is required')
  return project
}
function guard(project) {
  validateProject(project)
  return `const AUDIT_PROJECT = ${JSON.stringify(project)}
const AUDIT_DATABASE = 'https://' + AUDIT_PROJECT + '-default-rtdb.europe-west1.firebasedatabase.app'
const runtimeConfig = JSON.parse(process.env.FIREBASE_CONFIG || '{}')
const runtimeProject = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || runtimeConfig.projectId
if (runtimeProject !== AUDIT_PROJECT || runtimeConfig.projectId !== AUDIT_PROJECT || runtimeConfig.databaseURL !== AUDIT_DATABASE) {
  throw new Error('AUDIT_RUNTIME_ISOLATION_MISMATCH')
}
const ROOM_DATABASE_URL = AUDIT_DATABASE`
}
if (process.argv[2] === '--self-test') {
  const assert = require('node:assert/strict')
  const project = 'youth-vibe-audit-example'
  const run = env => Function('process', guard(project) + '; return ROOM_DATABASE_URL')({ env })
  const config = {projectId:project,databaseURL:`https://${project}-default-rtdb.europe-west1.firebasedatabase.app`}
  assert.equal(run({GCLOUD_PROJECT:project,FIREBASE_CONFIG:JSON.stringify(config)}),config.databaseURL)
  for (const env of [{}, {GCLOUD_PROJECT:production,FIREBASE_CONFIG:JSON.stringify(config)}, {GCLOUD_PROJECT:project,FIREBASE_CONFIG:JSON.stringify({...config,databaseURL:`https://${production}-default-rtdb.europe-west1.firebasedatabase.app`})}])
    assert.throws(() => run(env))
  assert.throws(() => validateProject(production))
  assert.throws(() => validateProject('../anything'))
  console.log('PASS: runtime/project/database isolation; production and missing config rejected')
} else {
  const project = validateProject(process.argv[2])
  const destination = path.join(root, 'functions-audit-staging')
  if (fs.existsSync(destination)) throw Error('Destination already exists; inspect it before replacing')
  const git = file => execFileSync('git', ['show', `${revision}:functions/${file}`], {cwd:root,encoding:'utf8'})
  const source = git('index.js')
  const expected = `const ROOM_DATABASE_URL = 'https://${production}-default-rtdb.europe-west1.firebasedatabase.app'`
  if (!source.includes(expected)) throw Error('Pinned main source no longer matches reviewed binding')
  const copied = new Map()
  function collect(file) {
    if (copied.has(file)) return
    const text = git(file); copied.set(file,text)
    for (const match of text.matchAll(/require\(['"]\.\/([^'"]+)['"]\)/g)) {
      const relative = match[1].endsWith('.js') ? match[1] : match[1] + '.js'
      if (relative.includes('..') || path.isAbsolute(relative)) throw Error('Unexpected dependency path')
      collect(relative)
    }
  }
  collect('index.js'); copied.set('package.json', git('package.json'))
  copied.set('index.js', source.replace(expected, guard(project)) + `\n// Only the three reviewed, existing callable endpoints are published.\nfor (const key of Object.keys(exports)) if (!${JSON.stringify(allowed)}.includes(key)) delete exports[key]\n`)
  fs.mkdirSync(destination)
  for (const [file,text] of copied) fs.writeFileSync(path.join(destination,file),text)
  fs.writeFileSync(path.join(destination,'audit-source-manifest.json'), JSON.stringify({sourceRevision:revision,project,databaseURL:`https://${project}-default-rtdb.europe-west1.firebasedatabase.app`,exports:allowed,productionWrites:false},null,2))
  console.log('Prepared isolated inputs only. Owner must verify existing project/services/billing before any deployment.')
}
