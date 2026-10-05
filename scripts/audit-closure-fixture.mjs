// Creates only empty LOCAL fixtures. Never creates participants or answers.
import {createRequire} from 'node:module'
const target=process.env.AUDIT_ROOM,source=process.env.AUDIT_SOURCE||'AUDIAG'
if(!/^[A-Z0-9]{6}$/.test(target||'')||!['AUDIAG','AUQUIZ'].includes(source))throw Error('Exact local fixture required')
process.env.FIREBASE_DATABASE_EMULATOR_HOST='127.0.0.1:9000'
const req=createRequire(new URL('../functions/package.json',import.meta.url))
const app=req('firebase-admin/app').initializeApp({projectId:'demo-youth-pulse-audit',databaseURL:'https://molodeh-c523e-default-rtdb.europe-west1.firebasedatabase.app'})
const db=req('firebase-admin/database').getDatabase(app)
if((await db.ref(`sessions/${target}`).get()).exists())throw Error('Refusing to overwrite fixture')
const original=(await db.ref(`sessions/${source}`).get()).val()
const {participants,events,closedAt,endedAt,participantCount,completedCount,...base}=original
const now=Date.now(),session={...base,roomId:target,phase:'lobby',status:'lobby',createdAt:now,lastActivityAt:now}
const pub=(await db.ref(`publicRooms/${source}`).get()).val()
const qs=(await db.ref(`roomParticipantQuestions/${source}`).get()).val()
const privateQuestions=(await db.ref(`roomPrivateQuestions/${source}`).get()).val()
await db.ref().update({[`sessions/${target}`]:session,[`publicRooms/${target}`]:{...pub,roomId:target,phase:'lobby',createdAt:now,lastActivityAt:now,closedAt:null,endedAt:null},[`roomParticipantQuestions/${target}`]:{...qs,roomId:target,createdAt:now}})
if(privateQuestions)await db.ref(`roomPrivateQuestions/${target}`).set({...privateQuestions,roomId:target,createdAt:now})
console.log(`Created empty LOCAL ${target}`)
await req('firebase-admin/app').deleteApp(app);process.exit(0)
