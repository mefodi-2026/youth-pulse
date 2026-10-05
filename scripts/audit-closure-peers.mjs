// Local-only fault investigation: separate anonymous SDK registrations.
// UI host launches once. File commands coordinate faults; never Admin guests.
import {initializeApp,deleteApp} from 'firebase/app'
import {getAuth,connectAuthEmulator,signInAnonymously} from 'firebase/auth'
import {getDatabase,connectDatabaseEmulator,ref,get,update,onValue} from 'firebase/database'
import {getFunctions,connectFunctionsEmulator,httpsCallable} from 'firebase/functions'
import {readFileSync,writeFileSync,existsSync} from 'node:fs'
const room=process.env.AUDIT_ROOM, size=Number(process.env.AUDIT_PEERS||30)
if(!/^[A-Z0-9]{6}$/.test(room||'')||![29,30].includes(size))throw Error('Exact local room and 29/30 SDK guests required')
const commandFile=`audit-results/closure-command-${room}.json`
const result={environment:'LOCAL demo Auth/RTDB only; actual c56b6d2 host UI; SDK guests',room,requested:size,registered:0,firstQuestion:0,firstAnswerConfirmed:0,secondQuestion:0,finished:0,errors:[],phaseObservations:[]}
const save=()=>writeFileSync(`audit-results/closure-peers-${room}.json`,JSON.stringify(result,null,2))
const delay=ms=>new Promise(r=>setTimeout(r,ms)), clients=[]
const command=()=>existsSync(commandFile)?JSON.parse(readFileSync(commandFile,'utf8')).action:null
const waitFor=async test=>{const until=Date.now()+600000;while(!await test()){if(Date.now()>until)throw Error('LOCAL_TEST_TIMEOUT');await delay(150)}}
try{
  await Promise.all(Array.from({length:size},async(_,i)=>{
    const app=initializeApp({apiKey:'audit-emulator-key',projectId:'demo-youth-pulse-audit',databaseURL:'https://molodeh-c523e-default-rtdb.europe-west1.firebasedatabase.app'},`closure-${room}-${i}`)
    const auth=getAuth(app);connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true})
    const db=getDatabase(app);connectDatabaseEmulator(db,'127.0.0.1',9000)
    const functions=getFunctions(app,'europe-west1');connectFunctionsEmulator(functions,'127.0.0.1',5002)
    const {user}=await signInAnonymously(auth)
    const c={app,db,functions,uid:user.uid,index:0,ordinal:i,public:null};clients.push(c)
    const registration=await httpsCallable(functions,'joinRoomAsGuest')({roomId:room,nickname:`Local${i+1}`})
    const own=(await get(ref(db,`sessions/${room}/participants/${user.uid}`))).val()
    if(registration.data.participant.id!==user.uid||own?.id!==user.uid)throw Error('REGISTRATION_NOT_CONFIRMED')
    c.stop=onValue(ref(db,`publicRooms/${room}`),s=>{c.public=s.val();if(i===0){result.phaseObservations.push({time:new Date().toISOString(),phase:c.public?.phase});save()}},e=>result.errors.push({stage:'subscription',code:e.code}))
    result.registered++;save()
  }))
  console.log('Registered distinct local guests:',result.registered)
  await waitFor(()=>clients.every(c=>c.public?.phase==='live'))
  await Promise.all(clients.map(async c=>{const set=(await get(ref(c.db,`roomParticipantQuestions/${room}`))).val();c.questions=Object.values(set.questions);result.firstQuestion++;save()}))
  await waitFor(()=>['answer','clock-back','finish','abort'].includes(command()))
  if(command()!=='abort'){
    async function answer(c,index,clockBack=false){
      const q=c.questions[index],a=['A','B','C','D'][c.ordinal%4]
      if(c.public?.mode==='quiz')await httpsCallable(c.functions,'submitQuizAnswer')({roomId:room,questionId:q.id,answer:a})
      else await update(ref(c.db),{[`sessions/${room}/participants/${c.uid}/answers/${q.id}`]:a,[`sessions/${room}/participants/${c.uid}/currentQuestionIndex`]:index+1,[`sessions/${room}/participants/${c.uid}/status`]:index+1===c.questions.length?'finished':'answering',...(index+1===c.questions.length?{[`sessions/${room}/participants/${c.uid}/completedAt`]:Date.now()}:{}),[`sessions/${room}/lastActivityAt`]:Date.now()-(clockBack?11*60000:0)})
      const saved=(await get(ref(c.db,`sessions/${room}/participants/${c.uid}`))).val()
      if(saved.answers?.[q.id]!==a||saved.currentQuestionIndex!==index+1)throw Error('ANSWER_NOT_CONFIRMED')
      c.index=index+1
      if(index===0){result.firstAnswerConfirmed++;if(c.questions[1])result.secondQuestion++;save()}
    }
    if(command()==='clock-back'){
      await answer(clients[0],0,true);await waitFor(()=>clients.some(c=>c.public?.phase==='closed'))
    }else{
      await Promise.all(clients.map(c=>answer(c,0)))
      await waitFor(()=>['finish','abort'].includes(command()))
      if(command()==='finish')for(let i=1;i<clients[0].questions.length;i++)await Promise.all(clients.map(c=>answer(c,i)))
    }
    await Promise.all(clients.map(async c=>{const p=(await get(ref(c.db,`sessions/${room}/participants/${c.uid}`))).val();if(p.status==='finished'&&Object.keys(p.answers||{}).length===c.questions.length)result.finished++}))
  }
}catch(e){result.errors.push({stage:'test',code:e.code||e.message});process.exitCode=1}
finally{save();await Promise.all(clients.map(async c=>{c.stop?.();await deleteApp(c.app)}))}
console.log(JSON.stringify(result));process.exit(process.exitCode||0)
