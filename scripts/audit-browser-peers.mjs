// Companion SDK guests for a room CREATED AND STARTED through the browser UI.
// No Admin participant writes. All endpoints are pinned to local emulators.
import {initializeApp,deleteApp} from 'firebase/app'
import {getAuth,connectAuthEmulator,signInAnonymously} from 'firebase/auth'
import {getDatabase,connectDatabaseEmulator,ref,get,update,onValue} from 'firebase/database'
import {getFunctions,connectFunctionsEmulator,httpsCallable} from 'firebase/functions'
import {writeFileSync} from 'node:fs'
const room=process.env.AUDIT_ROOM
if(!/^[A-Z0-9]{6}$/.test(room||''))throw Error('AUDIT_ROOM required')
const size=Number(process.env.AUDIT_PEERS||29)
if(size<1||size>29)throw Error('Only 1..29 companion guests permitted')
const clients=[]
const result={environment:'local only; UI host and one browser guest + SDK companion guests',room,requested:size,joined:0,firstQuestion:0,finished:0,errors:[]}
const save=()=>writeFileSync(`audit-results/browser-peers-${room}.json`,JSON.stringify(result,null,2))
const wait=(db,path,predicate)=>new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>{stop();reject(Error('LOCAL_WAIT_TIMEOUT'))},240000)
  const stop=onValue(ref(db,path),s=>{if(predicate(s.val())){clearTimeout(timeout);stop();resolve(s.val())}},e=>{clearTimeout(timeout);reject(e)})
})
try{
  await Promise.all(Array.from({length:size},async(_,i)=>{
    const app=initializeApp({apiKey:'audit-emulator-key',projectId:'demo-youth-pulse-audit',databaseURL:'https://molodeh-c523e-default-rtdb.europe-west1.firebasedatabase.app'},`browser-peer-${room}-${i}`)
    const auth=getAuth(app);connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true})
    const db=getDatabase(app);connectDatabaseEmulator(db,'127.0.0.1',9000)
    const functions=getFunctions(app,'europe-west1');connectFunctionsEmulator(functions,'127.0.0.1',5002)
    const {user}=await signInAnonymously(auth)
    await httpsCallable(functions,'joinRoomAsGuest')({roomId:room,nickname:`Peer${i+1}`})
    clients.push({app,db,functions,uid:user.uid});result.joined++;save()
  }))
  console.log(`Ready: ${result.joined} separate SDK guests; launch through browser UI.`)
  await Promise.all(clients.map(async(c)=>{
    const publicRoom=await wait(c.db,`publicRooms/${room}`,v=>v?.phase==='live')
    const qset=(await get(ref(c.db,`roomParticipantQuestions/${room}`))).val()
    const qs=Object.values(qset.questions)
    result.firstQuestion++;save()
    for(let i=0;i<qs.length;i++){
      const q=qs[i],answer=['A','B','C','D'][i%4]
      if(publicRoom.mode==='quiz')await httpsCallable(c.functions,'submitQuizAnswer')({roomId:room,questionId:q.id,answer})
      else await update(ref(c.db),{[`sessions/${room}/participants/${c.uid}/answers/${q.id}`]:answer,[`sessions/${room}/participants/${c.uid}/currentQuestionIndex`]:i+1,[`sessions/${room}/participants/${c.uid}/status`]:i+1===qs.length?'finished':'answering',...(i+1===qs.length?{[`sessions/${room}/participants/${c.uid}/completedAt`]:Date.now()}:{}),[`sessions/${room}/lastActivityAt`]:Date.now()})
    }
    const record=(await get(ref(c.db,`sessions/${room}/participants/${c.uid}`))).val()
    if(record.status!=='finished'||Object.keys(record.answers||{}).length!==qs.length)throw Error('PERSISTED_PROGRESS_MISMATCH')
    result.finished++;save()
  }))
}catch(e){result.errors.push(e.code||e.message);save();process.exitCode=1}
finally{await Promise.all(clients.map(c=>deleteApp(c.app)));save()}
console.log(JSON.stringify(result))
process.exit(process.exitCode||0)
