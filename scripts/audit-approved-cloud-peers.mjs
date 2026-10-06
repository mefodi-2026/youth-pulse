// Authorized 2026-10-06 cloud tests ONLY in explicitly named UI-created rooms.
// 30 independent anonymous SDK sessions, NOT 30 browser contexts.
// Never creates rooms, changes capacities, uses Admin writes, or prints tokens.
import {initializeApp,deleteApp} from 'firebase/app'
import {getAuth,signInAnonymously} from 'firebase/auth'
import {getDatabase,ref,get,update,onValue,serverTimestamp} from 'firebase/database'
import {getFunctions,httpsCallable} from 'firebase/functions'
import {readFileSync,writeFileSync,existsSync} from 'node:fs'
const publication=process.env.AUDIT_PUBLICATION,room=process.env.AUDIT_APPROVED_ROOM
const bases={pages:'https://mefodi-2026.github.io/youth-pulse/',develop:'https://youth-pulse-dev-git-develop-comanda1.vercel.app/'}
if(process.env.AUDIT_PRODUCTION_TESTS_APPROVED!=='2026-10-06'||!bases[publication]||!/^[A-Z0-9]{6}$/.test(room||''))throw Error('Explicit approved test room/publication required')
const strategy=process.env.AUDIT_STRATEGY||'sequential'
if(!['sequential','simultaneous'].includes(strategy))throw Error('Unknown bounded strategy')
const html=await(await fetch(bases[publication])).text(),src=html.match(/<script[^>]+src="([^"]+\.js)"/)?.[1]
if(!src)throw Error('Published bundle missing')
const bundleUrl=new URL(src,bases[publication]).href,code=await(await fetch(bundleUrl)).text()
const config=Object.fromEntries(['apiKey','authDomain','projectId','databaseURL','appId'].map(key=>[key,code.match(new RegExp(key+':"([^"]+)"'))?.[1]]))
if(config.projectId!=='molodeh-c523e'||config.databaseURL!=='https://molodeh-c523e-default-rtdb.europe-west1.firebasedatabase.app'||!config.apiKey)throw Error('Publication configuration mismatch')
const output=`audit-results/approved-cloud-${publication}-${room}.json`,commandFile=`audit-results/approved-cloud-command-${room}.json`
const clockSkew=process.env.AUDIT_GUEST_CLOCK_MS==='mixed'?'mixed':Number(process.env.AUDIT_GUEST_CLOCK_MS||0)
if(![0,-660000,660000,'mixed'].includes(clockSkew))throw Error('Only bounded clock scenarios allowed')
const result={environment:'Authorized production TEST room; 30 independent SDK anonymous sessions',publication,bundleUrl,room,strategy,guestClockSkewMs:clockSkew,serverActivity:process.env.AUDIT_SERVER_ACTIVITY==='1',registered:0,firstQuestion:0,firstAnswerConfirmed:0,secondQuestion:0,finished:0,errors:[],checkpoints:[],phases:[],startedAt:new Date().toISOString()}
const save=()=>writeFileSync(output,JSON.stringify(result,null,2)),clients=[],pause=ms=>new Promise(r=>setTimeout(r,ms))
const command=()=>existsSync(commandFile)?JSON.parse(readFileSync(commandFile,'utf8')).action:null
const wait=async fn=>{const until=Date.now()+9*60000;while(!await fn()){if(Date.now()>until)throw Error('CONTROL_WAIT_TIMEOUT');if(clients.some(c=>c.public?.phase==='closed'))throw Error('ROOM_CLOSED_DURING_TEST');await pause(200)}}
async function join(i){
 const app=initializeApp(config,`approved-${room}-${i}`),auth=getAuth(app),db=getDatabase(app),functions=getFunctions(app,'europe-west1')
 const c={app,auth,db,functions,ordinal:i};clients.push(c)
 const authStarted=Date.now()
 try {const signed=await signInAnonymously(auth);c.uid=signed.user.uid}
 catch(e){result.errors.push({stage:'guest-auth',participant:i+1,code:e.code||'AUTH_FAILED'});save();throw e}
 c.public=(await get(ref(db,`publicRooms/${room}`))).val()
 if(!String(c.public?.roomTitle).startsWith('AUDIT 2026-10-06 ')||c.public.phase!=='lobby')throw Error('Not an approved fresh lobby; refusing registration')
 const before=c.public.phase,start=Date.now()
 try{
  const response=await httpsCallable(functions,'joinRoomAsGuest')({roomId:room,nickname:`AUDIT guest ${i+1}`})
  const own=(await get(ref(db,`sessions/${room}/participants/${c.uid}`))).val()
  if(response.data?.participant?.id!==c.uid||own?.id!==c.uid)throw Error('REGISTRATION_NOT_CONFIRMED')
  result.registered++
  c.stop=onValue(ref(db,`publicRooms/${room}`),s=>{c.public=s.val();if(i===0&&result.phases.at(-1)?.phase!==c.public?.phase){result.phases.push({at:new Date().toISOString(),phase:c.public?.phase});save()}},e=>{result.errors.push({stage:'public-subscription',participant:i+1,code:e.code});save()})
  if([10,11,12].includes(i))result.checkpoints.push({participant:i+1,auth:'anonymous-confirmed',authMs:Date.now()-authStarted,phaseBefore:before,phaseAfter:(await get(ref(db,`publicRooms/${room}/phase`))).val(),joinCode:'OK',joinAndConfirmMs:Date.now()-start,confirmedRegistrations:result.registered})
 }catch(e){result.errors.push({stage:'join',participant:i+1,code:e.code||e.message});if([10,11,12].includes(i))result.checkpoints.push({participant:i+1,phaseBefore:before,auth:'anonymous-confirmed',joinCode:e.code||e.message,phaseAfter:(await get(ref(db,`publicRooms/${room}/phase`))).val()});throw e}
 save()
}
try{
 if(strategy==='sequential')for(let i=0;i<30;i++){await join(i);await pause(150)}
 else {const attempts=await Promise.allSettled(Array.from({length:30},(_,i)=>join(i)));if(attempts.some(r=>r.status==='rejected'))throw Error('CONCURRENT_REGISTRATION_FAILED')}
 if(new Set(clients.map(c=>c.uid)).size!==30||result.registered!==30)throw Error('Distinct registration count mismatch')
 console.log('SERVER-CONFIRMED distinct SDK guests:',result.registered,'room',room);save()
 await wait(()=>clients.every(c=>c.public?.phase==='live'))
 await Promise.all(clients.map(async c=>{const qs=(await get(ref(c.db,`roomParticipantQuestions/${room}`))).val();c.questions=Object.values(qs.questions||{});if(!c.questions.length)throw Error('FIRST_QUESTION_MISSING');result.firstQuestion++}));save()
 await wait(()=>['answer','finish','abort'].includes(command()))
 async function answer(c,index){
  const q=c.questions[index],a=['A','B','C','D'][c.ordinal%4],finished=index+1===c.questions.length,skew=clockSkew==='mixed'?[-660000,660000,0][c.ordinal%3]:clockSkew
  if(c.public.phase!=='live')throw Error('Room not live before answer')
  if(c.public.mode==='quiz')await httpsCallable(c.functions,'submitQuizAnswer')({roomId:room,questionId:q.id,answer:a})
  else await update(ref(c.db),{[`sessions/${room}/participants/${c.uid}/answers/${q.id}`]:a,[`sessions/${room}/participants/${c.uid}/currentQuestionIndex`]:index+1,[`sessions/${room}/participants/${c.uid}/status`]:finished?'finished':'answering',...(finished?{[`sessions/${room}/participants/${c.uid}/completedAt`]:Date.now()+skew}:{}),[`sessions/${room}/lastActivityAt`]:process.env.AUDIT_SERVER_ACTIVITY==='1'?serverTimestamp():Date.now()+skew})
  const own=(await get(ref(c.db,`sessions/${room}/participants/${c.uid}`))).val()
  if(own.answers?.[q.id]!==a||own.currentQuestionIndex!==index+1)throw Error('ANSWER_NOT_CONFIRMED')
  if(index===0){result.firstAnswerConfirmed++;if(c.questions[1])result.secondQuestion++}
  if(finished){if(own.status!=='finished'||Object.keys(own.answers||{}).length!==c.questions.length)throw Error('COMPLETE_ANSWERS_NOT_CONFIRMED');for(const question of c.questions)if(own.answers[question.id]!==a)throw Error('SAVED_ANSWER_MISMATCH');result.finished++}
  save()
 }
 async function round(index){
  const attempts=await Promise.allSettled(clients.map(async c=>{try{await answer(c,index)}catch(e){result.errors.push({stage:'answer',participant:c.ordinal+1,questionIndex:index,code:e.code||e.message});save();throw e}}))
  if(attempts.some(r=>r.status==='rejected'))throw Error('ANSWER_ROUND_FAILED')
 }
 if(command()!=='abort'){
  await round(0);console.log('FIRST ANSWERS confirmed:',result.firstAnswerConfirmed);save()
  await wait(()=>['finish','abort'].includes(command()))
  if(command()==='finish')for(let i=1;i<clients[0].questions.length;i++)await round(i)
 }
}catch(e){result.errors.push({stage:'test',code:e.code||e.message});process.exitCode=1}
finally{result.endedAt=new Date().toISOString();save();await Promise.all(clients.map(async c=>{c.stop?.();await deleteApp(c.app)}))}
console.log(JSON.stringify(result));process.exit(process.exitCode||0)
