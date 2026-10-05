import {readFileSync,writeFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import ts from 'typescript'
import {initializeApp,deleteApp} from 'firebase/app'
import {getAuth,connectAuthEmulator,createUserWithEmailAndPassword,signInWithEmailAndPassword} from 'firebase/auth'
process.env.GCLOUD_PROJECT='demo-youth-pulse-audit'
process.env.FIREBASE_DATABASE_EMULATOR_HOST='127.0.0.1:9000'
const req=createRequire(new URL('../functions/package.json',import.meta.url))
const databaseURL='https://molodeh-c523e-default-rtdb.europe-west1.firebasedatabase.app'
const app=req('firebase-admin/app').initializeApp({projectId:process.env.GCLOUD_PROJECT,databaseURL},'browser-fixtures')
const db=req('firebase-admin/database').getDatabase(app)
const client=initializeApp({projectId:process.env.GCLOUD_PROJECT,apiKey:'audit-emulator-key'})
const auth=getAuth(client);connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true})
const existing=process.env.AUDIT_REUSE_FIXTURE?JSON.parse(readFileSync('audit-results/browser-fixtures.json','utf8')):null
const email=existing?.email||`browser-audit-${Date.now()}@example.test`,password='LocalAuditOnly-2026'
const {user}=await (existing?signInWithEmailAndPassword(auth,email,password):createUserWithEmailAndPassword(auth,email,password))
const uid=user.uid,workspaceId=`audit-${uid}`,now=Date.now()
const catalog=JSON.parse(readFileSync(process.env.AUDIT_CATALOG,'utf8'))
const questionsSource=ts.transpile(readFileSync(new URL('../src/data/questions.ts',import.meta.url),'utf8'),{module:ts.ModuleKind.ES2022})
const {questions}=await import(`data:text/javascript;base64,${Buffer.from(questionsSource).toString('base64')}`)
const patch={
  [`users/${uid}`]:{uid,fullName:'Audit Host',phone:'',email,workspaceId,status:'active',createdAt:now,updatedAt:now},
  [`workspaces/${workspaceId}`]:{id:workspaceId,name:'Audit group',city:'Local',ownerUid:uid,createdAt:now,updatedAt:now},
}
for(const pack of Object.values(catalog)){
  const {createdBy,copiedBy,updatedBy,...source}=pack
  patch[`globalPacks/${pack.packId}`]=source
  if(pack.mode==='quiz'){
    const copy={...source,workspaceId,templateOrigin:'workspace',sourcePackId:pack.packId,sourcePackVersion:pack.packVersion||pack.version||1,copiedBy:uid,copiedAt:now,createdAt:now,updatedAt:now}
    const safeQuestions=Object.values(source.questions||source.content.questions).map(({correctAnswer,explanation,...q})=>q)
    const workspace=patch[`workspaces/${workspaceId}`]
    ;(workspace.workspacePacks||={})[pack.packId]=copy
    const safe={...copy,questions:safeQuestions,content:{questions:safeQuestions},privateContent:null,publicContent:{questions:safeQuestions}}
    ;(workspace.workspacePackPublics||={})[pack.packId]=safe
    patch[`globalPackPublics/${pack.packId}`]=safe
    patch[`publishedPacks/${pack.packId}`]=safe
  }
}
const diagnostic={packId:'youth-atmosphere-diagnostic',productId:'youth-atmosphere',mode:'diagnostic',status:'published',title:'Проверь себя',version:1,packVersion:1,questions,content:{questions},settings:{},ruleConfig:{},createdAt:now,updatedAt:now}
patch['publishedPacks/youth-atmosphere-diagnostic']=diagnostic
await db.ref().update(patch)
for(const [roomId,mode] of [['AUDIAG','diagnostic'],['AUQUIZ','quiz']]){
  const pack=mode==='quiz'?catalog['bible-quiz-hard-v1']:null
  const raw=pack?Object.values(pack.questions||pack.content.questions):questions
  const safe=raw.map(({correctAnswer,explanation,...q})=>q)
  const session={roomId,hostUid:uid,workspaceId,roomTitle:'Audit browser room',createdAt:now,lastActivityAt:now,phase:'lobby',status:'lobby',maxParticipants:30,mode,productId:mode==='quiz'?'bible-quiz':'youth-atmosphere',packId:pack?.packId||'youth-atmosphere-diagnostic',packVersion:1,snapshotId:`audit-${roomId}`,settings:{roomMode:mode},questions:safe,packSnapshot:{title:pack?.title||'Проверь себя',questions:safe}}
  await db.ref().update({[`sessions/${roomId}`]:session,[`publicRooms/${roomId}`]:{roomId,roomTitle:session.roomTitle,createdAt:now,lastActivityAt:now,phase:'lobby',maxParticipants:30,mode,packTitle:session.packSnapshot.title},[`roomParticipantQuestions/${roomId}`]:{roomId,createdAt:now,mode,packTitle:session.packSnapshot.title,questions:Object.fromEntries(safe.map(q=>[q.id,q]))},...(pack?{[`roomPrivateQuestions/${roomId}`]:{roomId,createdAt:now,questions:raw.map(q=>({id:q.id,correctAnswer:q.correctAnswer}))}}:{})})
}
writeFileSync('audit-results/browser-fixtures.json',JSON.stringify({email,password,uid,workspaceId,rooms:['AUDIAG','AUQUIZ']},null,2))
console.log(JSON.stringify({email,rooms:['AUDIAG','AUQUIZ'],environment:'local emulators only'}))
await deleteApp(client);await req('firebase-admin/app').deleteApp(app);process.exit(0)
