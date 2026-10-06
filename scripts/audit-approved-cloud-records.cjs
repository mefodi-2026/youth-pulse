// Read-only verification of explicitly approved 2026-10-06 AUDIT rooms.
const fs=require('node:fs'),path=require('node:path')
const room=process.argv[3],load=name=>require(path.join(path.resolve(process.argv[2]),'lib',name))
if(!/^[A-Z0-9]{6}$/.test(room||''))throw Error('Exact room required')
async function main(){
 const account=load('auth').getGlobalDefaultAccount()
 await load('requireAuth').requireAuth({project:'molodeh-c523e',user:account.user,tokens:account.tokens})
 const api=new(load('apiv2').Client)({urlPrefix:'https://molodeh-c523e-default-rtdb.europe-west1.firebasedatabase.app'})
 const s=(await api.get(`/sessions/${room}.json`)).body
 if(!String(s?.roomTitle).startsWith('AUDIT 2026-10-06 '))throw Error('Not approved audit room; refusing further reads')
 const keys=s.mode==='quiz'?(await api.get(`/roomPrivateQuestions/${room}.json`)).body:null
 const questions=Object.values(keys?.questions||{}),participants=Object.entries(s.participants||{})
 const results=s.mode==='quiz'?(await api.get(`/roomParticipantResults/${room}.json`)).body:null
 const rows=participants.map(([uid,p],i)=>({ordinal:i+1,identityMatchesKey:uid===p.id,status:p.status,index:p.currentQuestionIndex,answers:Object.keys(p.answers||{}).length,diagnosticPoints:s.mode==='diagnostic'?Object.values(p.answers||{}).reduce((v,a)=>v+({A:3,B:2,C:1,D:0,SKIP:-1}[a]??0),0):null,quizComputedCorrect:s.mode==='quiz'?questions.filter(q=>p.answers?.[q.id]===q.correctAnswer).length:null,quizSavedCorrect:p.quizResult?.correct??null}))
 if(results)participants.forEach(([uid],i)=>{rows[i].storedResultCorrect=results[uid]?.correctCount??results[uid]?.correct??null;rows[i].storedResultTotal=results[uid]?.totalQuestions??results[uid]?.total??null})
 const result={capturedAt:new Date().toISOString(),room,title:s.roomTitle,mode:s.mode,phase:s.phase,createdAt:s.createdAt,startedAt:s.startedAt??null,closedAt:s.closedAt??null,lastActivityAt:s.lastActivityAt,uniqueRegistered:participants.length,finished:rows.filter(p=>p.status==='finished').length,rows}
 fs.writeFileSync(`audit-results/approved-cloud-records-${room}.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result))
}
main().catch(e=>{console.error('READ_ONLY_AUDIT_CHECK_FAILED',e.status||e.code||'unknown');process.exitCode=1})
