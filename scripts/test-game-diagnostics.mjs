import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
const source=readFileSync('src/lib/gameDiagnostics.ts','utf8').replace("import.meta.env.VITE_BUILD_REVISION", "'test-build'")
const js=ts.transpile(source,{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022})
const {traceGameOperation,safeGameErrorCode}=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)
const records=[],original=console.info
console.info=(...args)=>records.push(args)
try{
  const value={confirmed:true};assert.equal(await traceGameOperation('start',async()=>value),value)
  const error=Object.assign(Error('secret-token private-answer nickname'),{code:'functions/resource-exhausted',token:'secret-token'})
  await assert.rejects(traceGameOperation('guest-callable',async()=>{throw error}),e=>e===error)
  assert.equal(safeGameErrorCode({code:'PII-in-code'}),'unknown')
  const parsed=records.map(r=>JSON.parse(r[1]))
  assert.equal(parsed[0].requestId,parsed[1].requestId)
  assert.equal(parsed[2].requestId,parsed[3].requestId)
  assert.equal(parsed[3].code,'resource-exhausted')
  for(const record of parsed)assert.deepEqual(Object.keys(record).sort(),['build','code','outcome','requestId','stage','time'])
  assert.equal(JSON.stringify(records).includes('secret-token'),false)
  console.info=()=>{throw Error('console unavailable')}
  assert.equal(await traceGameOperation('start',async()=>value),value)
}finally{console.info=original}
console.log('Game diagnostics: preserves return/error; stable operation ID; allowlisted codes; no payload/PII; console failure is non-blocking.')
