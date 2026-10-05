// Remove only local load-run fixtures, keeping browser-created rooms intact.
process.env.GCLOUD_PROJECT='demo-youth-pulse-audit'
process.env.FIREBASE_DATABASE_EMULATOR_HOST='127.0.0.1:9000'
const {createRequire}=require('node:module')
const req=createRequire(require('node:path').resolve('functions/package.json'))
const app=req('firebase-admin/app').initializeApp({projectId:'demo-youth-pulse-audit',databaseURL:'https://molodeh-c523e-default-rtdb.europe-west1.firebasedatabase.app'},'audit-clean')
const db=req('firebase-admin/database').getDatabase(app)
async function main(){
  const sessions=(await db.ref('sessions').once('value')).val()||{}
  const ids=Object.entries(sessions).filter(([id,s])=>/^A[A-Z0-9]{6,15}$/.test(id)&&s.packId==='audit-pack'&&s.workspaceId?.startsWith('audit-')).map(([id])=>id)
  for(const id of ids)await db.ref().update(Object.fromEntries(['sessions','publicRooms','roomParticipantQuestions','roomPrivateQuestions','roomParticipantResults'].map(root=>[`${root}/${id}`,null])))
  console.log(JSON.stringify({deletedLocalLoadRooms:ids.length,environment:'localhost RTDB emulator only'}))
  await req('firebase-admin/app').deleteApp(app)
}
main().catch(e=>{console.error(e.code||e.name);process.exitCode=1})
