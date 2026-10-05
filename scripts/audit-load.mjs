// Local-only integration load test. Never accepts a production endpoint.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { performance } from 'node:perf_hooks'
import ts from 'typescript'
import { initializeApp, deleteApp } from 'firebase/app'
import { getAuth, connectAuthEmulator, signInAnonymously, createUserWithEmailAndPassword } from 'firebase/auth'
import { getDatabase, connectDatabaseEmulator, ref, get, update, onValue, goOffline, goOnline } from 'firebase/database'
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions'

const projectId = 'demo-youth-pulse-audit'
const databaseURL = 'https://molodeh-c523e-default-rtdb.europe-west1.firebasedatabase.app'
process.env.GCLOUD_PROJECT = projectId
process.env.FIREBASE_DATABASE_EMULATOR_HOST = '127.0.0.1:9000'
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'
const require = createRequire(new URL('../functions/package.json', import.meta.url))
const adminApp = require('firebase-admin/app').initializeApp({ projectId, databaseURL }, 'audit-fixtures')
const adminDb = require('firebase-admin/database').getDatabase(adminApp)
const runId = Date.now().toString(36).toUpperCase()
// The server's named database uses the production-shaped namespace even in
// emulation. Explicitly install the unchanged rules in that local namespace.
const ruleResponse = await fetch('http://127.0.0.1:9000/.settings/rules.json?ns=molodeh-c523e-default-rtdb', { method:'PUT', headers:{Authorization:'Bearer owner','Content-Type':'application/json'}, body:readFileSync(new URL('../firebase-rules.json',import.meta.url),'utf8') })
if(!ruleResponse.ok)throw new Error(`Emulator rules not installed: ${ruleResponse.status}`)
const sizes = (process.env.AUDIT_SIZES || '5,10,20,29,30,31,50,100').split(',').map(Number)
const capacity = Number(process.env.AUDIT_CAPACITY || 30)
if (![30,100].includes(capacity)) throw new Error('Audit capacity must be 30 or 100')
const strategies = (process.env.AUDIT_STRATEGIES || 'gradual,simultaneous').split(',')
const modes = (process.env.AUDIT_MODES || 'diagnostic,quiz').split(',')
const diagnosticSource = ts.transpile(readFileSync(new URL('../src/data/questions.ts', import.meta.url), 'utf8'), { module: ts.ModuleKind.ES2022 })
const { questions: diagnosticQuestions } = await import(`data:text/javascript;base64,${Buffer.from(diagnosticSource).toString('base64')}`)
const catalog = process.env.AUDIT_CATALOG ? JSON.parse(readFileSync(process.env.AUDIT_CATALOG, 'utf8')) : null
const packs = catalog ? Object.values(catalog.result || catalog).filter(p => p.mode === 'quiz' && p.status === 'published') : []
const quizPack = process.env.AUDIT_PACK ? packs.find(p=>p.packId===process.env.AUDIT_PACK) : packs[0]
if(process.env.AUDIT_PACK&&!quizPack)throw new Error('Requested audit pack not found')
const quizQuestions = quizPack ? Object.values(quizPack.questions || quizPack.content.questions) : Array.from({length:15}, (_,i)=>({id:`q${i+1}`, category:'bible', title:`Audit question ${i+1}`,options:{A:'A',B:'B',C:'C',D:'D'},correctAnswer:'A'}))
const stats = values => {
  const sorted=values.toSorted((a,b)=>a-b)
  return { count:sorted.length, medianMs:sorted.length?Math.round(sorted[Math.floor(sorted.length/2)]):null, p95Ms:sorted.length?Math.round(sorted[Math.ceil(sorted.length*.95)-1]):null }
}
const errors = []
const results = []
let sequence=0
function client(label) {
  const app=initializeApp({projectId, databaseURL, apiKey:'audit-emulator-key'}, `${runId}-${label}-${++sequence}`)
  const auth=getAuth(app); connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true})
  const db=getDatabase(app); connectDatabaseEmulator(db,'127.0.0.1',9000)
  const functions=getFunctions(app,'europe-west1'); connectFunctionsEmulator(functions,'127.0.0.1',Number(process.env.AUDIT_FUNCTIONS_PORT||5001))
  return {app,auth,db,functions,stops:[], timings:[], receivedBytes:0, events:0}
}
async function bounded(promise, label, ms=60000) {
  let timer
  try { return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(`TIMEOUT:${label}`)),ms)})]) } finally { clearTimeout(timer) }
}
function subscribe(c,path,assign) {
  c.stops.push(onValue(ref(c.db,path),s=>{const value=s.val(); c.events++; c.receivedBytes+=Buffer.byteLength(JSON.stringify(value)); assign(value)}, e=>errors.push({operation:'subscription',code:e.code})))
}
async function until(test,label) {
  const end=performance.now()+15000
  while(!test()){ if(performance.now()>end)throw new Error(`TIMEOUT:${label}`); await new Promise(r=>setTimeout(r,10)) }
}
const host=client('host')
await createUserWithEmailAndPassword(host.auth,`audit-${runId.toLowerCase()}@example.test`,'LocalAuditOnly-2026')
const hostUid=host.auth.currentUser.uid
const workspaceId=`audit-${runId}`
await adminDb.ref().update({[`users/${hostUid}`]:{uid:hostUid,status:'active',workspaceId},[`workspaces/${workspaceId}`]:{id:workspaceId,ownerUid:hostUid}})
for(const mode of modes)for(const strategy of strategies)for(const size of sizes){
  const roomId=`A${runId}${(++sequence).toString(36).toUpperCase()}`.slice(0,16)
  const questions=mode==='quiz'?quizQuestions:diagnosticQuestions
  const publicQuestions=questions.map(({correctAnswer,explanation,...q})=>q)
  const now=Date.now()
  const session={roomId,hostUid,workspaceId,productId:mode==='quiz'?'bible-quiz':'youth-atmosphere',mode,createdAt:now,lastActivityAt:now,phase:'lobby',status:'lobby',maxParticipants:capacity,packId:'audit-pack',packVersion:1,snapshotId:`audit:${roomId}`,settings:{roomMode:mode},packSnapshot:{title:'Audit',questions:publicQuestions},questions:publicQuestions}
  // Fixtures contain no participants. Guests must register through the real callable.
  await adminDb.ref().update({[`sessions/${roomId}`]:session,[`publicRooms/${roomId}`]:{roomId,mode,phase:'lobby',createdAt:now,lastActivityAt:now,maxParticipants:capacity},[`roomParticipantQuestions/${roomId}`]:{roomId,mode,createdAt:now,questions:mode==='quiz'?publicQuestions:Object.fromEntries(publicQuestions.map(q=>[q.id,q]))},...(mode==='quiz'?{[`roomPrivateQuestions/${roomId}`]:{roomId,createdAt:now,questions:questions.map(q=>({id:q.id,correctAnswer:q.correctAnswer||'A'}))}}:{})})
  const guests=Array.from({length:size},(_,i)=>client(`guest-${mode}-${strategy}-${size}-${i}`))
  const joined=[]; const joinMs=[]; const rejected=[]; const answerMs=[]; const startMs=[]; const answerFailures=[]
  const join=async(c,i)=>{
    const began=performance.now()
    try{
      await signInAnonymously(c.auth)
      const response=await bounded(httpsCallable(c.functions,'joinRoomAsGuest')({roomId,nickname:`Audit ${i+1}`}), 'join')
      if(response.data.participant.id!==c.auth.currentUser.uid)throw new Error('IDENTITY_MISMATCH')
      c.participant=response.data.participant
      subscribe(c,`publicRooms/${roomId}`,v=>{c.publicRoom=v;if(v?.phase==='live'&&!c.firstAt)c.firstAt=performance.now()})
      subscribe(c,`roomParticipantQuestions/${roomId}`,v=>c.questionSet=v)
      subscribe(c,`sessions/${roomId}/participants/${c.auth.currentUser.uid}`,v=>c.participant=v)
      joined.push(c); joinMs.push(performance.now()-began)
    }catch(e){rejected.push(e.code||e.message)}
  }
  if(strategy==='gradual')for(const [i,c]of guests.entries())await join(c,i)
  else await Promise.all(guests.map(join))
  const started=performance.now()
  try{
    await until(()=>joined.every(c=>c.questionSet?.questions),'questions')
    await update(ref(host.db),{[`sessions/${roomId}/phase`]:'live',[`sessions/${roomId}/status`]:'live',[`sessions/${roomId}/startedAt`]:Date.now(),[`sessions/${roomId}/lastActivityAt`]:Date.now(),[`publicRooms/${roomId}/phase`]:'live',[`publicRooms/${roomId}/lastActivityAt`]:Date.now()})
    await until(()=>joined.every(c=>c.firstAt),'first question')
    startMs.push(...joined.map(c=>c.firstAt-started))
    for(let index=0;index<questions.length;index++){
      await Promise.all(joined.map(async(c,i)=>{
        const q=questions[index]; const answer=mode==='diagnostic'?['A','B','C','D','SKIP'][i%5]:['A','B','C','D'][i%4]
        const began=performance.now()
        try{
          if(mode==='quiz')await bounded(httpsCallable(c.functions,'submitQuizAnswer')({roomId,questionId:q.id,answer}),'answer')
          else await bounded(update(ref(c.db),{[`sessions/${roomId}/participants/${c.auth.currentUser.uid}/answers/${q.id}`]:answer,[`sessions/${roomId}/participants/${c.auth.currentUser.uid}/currentQuestionIndex`]:index+1,[`sessions/${roomId}/participants/${c.auth.currentUser.uid}/status`]:index+1===questions.length?'finished':'answering',...(index+1===questions.length?{[`sessions/${roomId}/participants/${c.auth.currentUser.uid}/completedAt`]:Date.now()}:{}),[`sessions/${roomId}/lastActivityAt`]:Date.now()}),'answer')
          answerMs.push(performance.now()-began)
        }catch(e){answerFailures.push({question:index+1,code:e.code||e.message})}
      }))
      if(answerFailures.length)break
      await until(()=>joined.every(c=>c.participant?.currentQuestionIndex===index+1),'answer sync')
    }
  }catch(e){answerFailures.push({operation:'start',code:e.code||e.message})}
  const saved=(await adminDb.ref(`sessions/${roomId}/participants`).once('value')).val()||{}
  const graded=(await adminDb.ref(`roomParticipantResults/${roomId}`).once('value')).val()||{}
  const finished=Object.values(saved).filter(p=>p.status==='finished').length
  const answerCount=Object.values(saved).reduce((n,p)=>n+Object.keys(p.answers||{}).length,0)
  let mismatchedScores=0
  if(mode==='quiz')for(const p of Object.values(saved)){
    const correct=questions.filter(q=>p.answers?.[q.id]===q.correctAnswer).length
    if(p.status==='finished'&&(graded[p.id]?.correct!==correct||graded[p.id]?.total!==questions.length))mismatchedScores++
  }
  // Rejoin and reconnect must retain the same identity and answer state.
  let restored=false,reused=false,privateDenied=false,answerReplay=null
  if(joined.length){const c=joined[0];const id=c.auth.currentUser.uid
    goOffline(c.db);goOnline(c.db)
    try{const r=await httpsCallable(c.functions,'joinRoomAsGuest')({roomId,nickname:'Audit retry'}); reused=r.data.participant.id===id
      const p=(await get(ref(c.db,`sessions/${roomId}/participants/${id}`))).val();restored=p.id===id&&p.currentQuestionIndex===saved[id].currentQuestionIndex
      if(mode==='quiz'&&p.status==='finished'){
        const last=questions.at(-1), answer=p.answers[last.id]
        await Promise.all([1,2].map(()=>httpsCallable(c.functions,'submitQuizAnswer')({roomId,questionId:last.id,answer})))
        const after=(await adminDb.ref(`sessions/${roomId}/participants/${id}`).once('value')).val()
        const scoreAfter=(await adminDb.ref(`roomParticipantResults/${roomId}/${id}`).once('value')).val()
        answerReplay=JSON.stringify(after)===JSON.stringify(saved[id])&&JSON.stringify(scoreAfter)===JSON.stringify(graded[id])
        if(!answerReplay)throw new Error('REPLAY_CHANGED_SAVED_STATE')
      }
      try{await get(ref(c.db,`sessions/${roomId}`))}catch(e){privateDenied=/permission[ _-]denied/i.test(`${e.code} ${e.message}`)}
    }catch(e){answerFailures.push({operation:'restore',code:e.code||e.message})}
  }
  const row={mode,strategy,size,capacity,joined:joined.length,rejections:rejected,firstQuestion:startMs.length,finished,answerCount,expectedAnswers:joined.length*questions.length,mismatchedScores,restored,reused,privateDenied,answerReplay,join:stats(joinMs),start:stats(startMs),firstAnswer:stats(answerMs.slice(0,joined.length)),answer:stats(answerMs),answerFailures,subscriptionEvents:guests.reduce((n,c)=>n+c.events,0),subscriptionPayloadBytes:guests.reduce((n,c)=>n+c.receivedBytes,0),rssMb:Math.round(process.memoryUsage().rss/1024/1024)}
  results.push(row);console.log(JSON.stringify(row))
  mkdirSync('audit-results',{recursive:true})
  persist()
  for(const c of guests){for(const stop of c.stops)stop();goOffline(c.db);await deleteApp(c.app)}
  // Avoid retaining every completed fixture in the Java emulator heap.
  // These five exact paths belong to this run; no production endpoint is used.
  await adminDb.ref().update(Object.fromEntries(['sessions','publicRooms','roomParticipantQuestions','roomPrivateQuestions','roomParticipantResults'].map(root=>[`${root}/${roomId}`,null])))
}
goOffline(host.db);await deleteApp(host.app);await require('firebase-admin/app').deleteApp(adminApp)
mkdirSync('audit-results',{recursive:true})
persist()
function persist(){writeFileSync(`audit-results/load-${runId}.json`,JSON.stringify({environment:'local Firebase Auth/RTDB; real callable HTTP handlers; SDK clients, not browser load',functionsPort:Number(process.env.AUDIT_FUNCTIONS_PORT||5001),source:'a3ff1ed',capacity,node:process.version,quizFixture:quizPack?.title||'synthetic 15 questions',results,errors},null,2))}
process.exit(results.some(r=>r.answerFailures.length||r.joined!==Math.min(capacity,r.size)||r.finished!==r.joined||r.mismatchedScores||!r.privateDenied)?1:0)
