// READ ONLY. Only the two explicitly named test rooms from this audit are allowed.
const fs=require('node:fs'),path=require('node:path')
const cli=path.resolve(process.argv[2]),room=process.argv[3]
if(!['MZVCPD','MFC5QS'].includes(room))throw Error('Only named audit rooms allowed')
const load=name=>require(path.join(cli,'lib',name))
async function main(){
 const account=load('auth').getGlobalDefaultAccount()
 await load('requireAuth').requireAuth({project:'molodeh-c523e',user:account.user,tokens:account.tokens})
 const api=new (load('apiv2').Client)({urlPrefix:'https://molodeh-c523e-default-rtdb.europe-west1.firebasedatabase.app'})
 const s=(await api.get(`/sessions/${room}.json`)).body
 if(!String(s.roomTitle).startsWith('AUDIT 2026-10-05'))throw Error('Not an audit room')
 const keys=s.mode==='quiz'?(await api.get(`/roomPrivateQuestions/${room}.json`)).body:null
 const rows=Object.entries(s.participants||{}).map(([uid,p],index)=>{
  const questions=Object.values(keys?.questions||[])
  const computed=s.mode==='quiz'?questions.filter(q=>p.answers?.[q.id]===q.correctAnswer).length:null
  const diagnosticPoints=s.mode==='diagnostic'?Object.values(p.answers||{}).reduce((sum,a)=>sum+({A:3,B:2,C:1,D:0,SKIP:-1}[a]??0),0):null
  return {participant:index+1,identityMatchesKey:p.id===uid,status:p.status,index:p.currentQuestionIndex,answers:Object.keys(p.answers||{}).length,computedCorrect:computed,quizResultCorrect:p.quizResult?.correct??null,diagnosticPoints}
 })
 const results=s.mode==='quiz'?(await api.get(`/roomParticipantResults/${room}.json`)).body:null
 if(results)Object.entries(s.participants).forEach(([uid],i)=>{rows[i].storedResult=results[uid]?.correct??results[uid]?.result?.correct??null})
 const result={capturedAt:new Date().toISOString(),environment:'production; read-only named smoke-test room, not load test',room,mode:s.mode,phase:s.phase,participants:rows}
 fs.writeFileSync(`audit-results/cloud-test-records-${room}.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result))
}
main().catch(e=>{console.error('READ_ONLY_TEST_RECORD_CHECK_FAILED',e.status||e.code||'unknown');process.exitCode=1})
