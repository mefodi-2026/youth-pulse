// Read-only sanitized local evidence. No IDs, credentials or nicknames emitted.
import {createRequire} from 'node:module'
import {writeFileSync} from 'node:fs'
const room=process.env.AUDIT_ROOM
if(!/^[A-Z0-9]{6}$/.test(room||''))throw Error('Exact local room required')
process.env.FIREBASE_DATABASE_EMULATOR_HOST='127.0.0.1:9000'
const req=createRequire(new URL('../functions/package.json',import.meta.url))
const app=req('firebase-admin/app').initializeApp({projectId:'demo-youth-pulse-audit',databaseURL:'https://molodeh-c523e-default-rtdb.europe-west1.firebasedatabase.app'})
const s=(await req('firebase-admin/database').getDatabase(app).ref(`sessions/${room}`).get()).val()
const ps=Object.values(s.participants||{}),events=Object.values(s.events||{})
const started=events.find(e=>e.type==='room_started')?.createdAt||s.startedAt
const data={environment:'LOCAL emulator; read-only aggregate',room,phase:s.phase,registered:ps.length,distinctKeys:Object.keys(s.participants||{}).length,answerCounts:ps.map(p=>Object.keys(p.answers||{}).length).sort((a,b)=>a-b),finished:ps.filter(p=>p.status==='finished').length,startedAt:started,closedAt:s.closedAt||null,liveMs:s.closedAt?s.closedAt-started:null,lastActivityAt:s.lastActivityAt,events:events.map(e=>({type:e.type,createdAt:e.createdAt,actorIsHost:e.hostUid===s.hostUid}))}
const db=req('firebase-admin/database').getDatabase(app)
const qs=Object.values((await db.ref(`roomParticipantQuestions/${room}/questions`).get()).val()||{})
const privateQs=Object.values((await db.ref(`roomPrivateQuestions/${room}/questions`).get()).val()||{})
const results=(await db.ref(`roomParticipantResults/${room}`).get()).val()||{}
data.expectedAnswerMismatches=0;data.finishedIndexMismatches=0;data.resultMismatches=0;data.recomputedPoints=[]
for(const p of ps){
 const local=/^Local(\d+)$/.exec(p.nickname||'')
 const expected=local?['A','B','C','D'][(Number(local[1])-1)%4]:'A'
 for(const [id,value]of Object.entries(p.answers||{}))if(!qs.some(q=>q.id===id)||value!==expected)data.expectedAnswerMismatches++
 if(p.status==='finished'){
  if(p.currentQuestionIndex!==qs.length||Object.keys(p.answers||{}).length!==qs.length)data.finishedIndexMismatches++
  if(s.mode==='quiz'){
   const correct=qs.reduce((n,q)=>n+(p.answers[q.id]===privateQs.find(x=>x.id===q.id)?.correctAnswer?1:0),0),actual=results[p.id]
   if(!actual||actual.correct!==correct||actual.total!==qs.length||actual.percentage!==Math.round(correct/qs.length*100))data.resultMismatches++
   data.recomputedPoints.push(correct)
  }else data.recomputedPoints.push(Object.values(p.answers).reduce((n,a)=>n+({A:3,B:2,C:1,D:0,SKIP:-1}[a]),0))
 }
}
data.recomputedPoints.sort((a,b)=>a-b)
writeFileSync(`audit-results/closure-state-${room}.json`,JSON.stringify(data,null,2));console.log(JSON.stringify(data))
await req('firebase-admin/app').deleteApp(app);process.exit(0)
