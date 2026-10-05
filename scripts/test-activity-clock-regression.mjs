import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
const source=readFileSync('src/lib/firebase.ts','utf8')
const start=source.indexOf('const saveDiagnosticAnswer =')
const body=source.slice(start,source.indexOf('\nexport const saveAnswer',start))
assert.match(body,/lastActivityAt`\]: serverTimestamp\(\)/)
const sentinel={'.sv':'timestamp'}
for(const skew of [-11*60000,11*60000,0]) {
 let patch,events=0
 const context={Date:{now:()=>1000000+skew},requireFirebase:()=>({db:{}}),ref:x=>x,serverTimestamp:()=>sentinel,update:async(_,value)=>{patch=value},traceGameOperation:async(_,fn)=>fn(),localConfirmedParticipant:(p,q,a,index,status)=>({...p,currentQuestionIndex:index,status,answers:{[q]:a},...(status==='finished'?{completedAt:1000000+skew}:{})}),recordParticipantEvent:async()=>{events++}}
 vm.createContext(context)
 vm.runInContext(ts.transpile(body+'\nglobalThis.testSave=saveDiagnosticAnswer',{target:ts.ScriptTarget.ES2022}),context)
 await context.testSave('TEST30',{id:'local',currentQuestionIndex:0},'q1','A',1,70)
 assert.strictEqual(patch['sessions/TEST30/lastActivityAt'],sentinel)
 assert.equal(patch['sessions/TEST30/participants/local/answers/q1'],'A')
 assert.equal(events,0)
 await context.testSave('TEST30',{id:'local',currentQuestionIndex:69},'q70','SKIP',70,70)
 assert.strictEqual(patch['sessions/TEST30/lastActivityAt'],sentinel)
 assert.equal(patch['sessions/TEST30/participants/local/status'],'finished')
 assert.equal(events,1)
}
console.log('PASS: actual diagnostic write uses server timestamp for first/final answers at -11/+11/0 minute guest clocks')
