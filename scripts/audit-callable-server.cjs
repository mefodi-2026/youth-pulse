// The real onCall HTTP handlers, with Auth and RTDB emulated, in one warm
// process. This avoids the CLI emulator's per-request worker spawning.
process.env.GCLOUD_PROJECT='demo-youth-pulse-audit'
process.env.FIREBASE_DATABASE_EMULATOR_HOST='127.0.0.1:9000'
process.env.FIREBASE_AUTH_EMULATOR_HOST='127.0.0.1:9099'
process.env.FUNCTIONS_EMULATOR='true'
process.env.FIREBASE_CONFIG=JSON.stringify({projectId:'demo-youth-pulse-audit',databaseURL:'https://molodeh-c523e-default-rtdb.europe-west1.firebasedatabase.app'})
const {createRequire}=require('node:module')
const requireFunction=createRequire(require('node:path').resolve('functions/package.json'))
const express=requireFunction('express')
// Keep runtime failures visible; omit repetitive successful token verification.
requireFunction('firebase-functions').logger.debug=()=>{}
let handlers
if(process.env.AUDIT_CAPACITY==='100'){
  // Test-only in-memory replacement; never writes or deploys production source.
  const filename=require('node:path').resolve('functions/index.js')
  const original=require('node:fs').readFileSync(filename,'utf8')
  const target='Math.min(30, Number(room.maxParticipants) || 30)'
  if(original.split(target).length!==2)throw new Error('Capacity replacement must match exactly once')
  const isolatedModule=new (require('node:module').Module)(filename)
  isolatedModule.filename=filename;isolatedModule.paths=require('node:module').Module._nodeModulePaths(require('node:path').dirname(filename))
  isolatedModule._compile(original.replace(target,'Math.min(100, Number(room.maxParticipants) || 30)'),filename)
  handlers=isolatedModule.exports
}else handlers=require('../functions/index.js')
const metrics={}
const app=express()
app.use(express.json({verify:(req,res,body)=>{req.auditBytes=body.length}}))
app.get('/__auditMetrics',(req,res)=>res.json(metrics))
app.all('/demo-youth-pulse-audit/europe-west1/:name',(req,res)=>{
  const name=req.params.name
  if(!['joinRoomAsGuest','submitQuizAnswer','createQuizRoom','copyQuizPackToWorkspace'].includes(name))return res.status(404).end()
  const start=performance.now()
  res.on('finish',()=>{
    const m=metrics[name]||={requests:0,requestPayloadBytes:0,responsePayloadBytes:0,statuses:{},latencies:[]}
    m.requests++;m.requestPayloadBytes+=req.auditBytes||0;m.responsePayloadBytes+=Number(res.getHeader('content-length')||0)
    m.statuses[res.statusCode]=(m.statuses[res.statusCode]||0)+1;m.latencies.push(performance.now()-start)
  })
  handlers[name](req,res)
})
const port=Number(process.env.AUDIT_SERVER_PORT||5002)
app.listen(port,'127.0.0.1',()=>console.log(`Real callable handlers ready at 127.0.0.1:${port}; demo Auth/RTDB only; capacity ${process.env.AUDIT_CAPACITY||30}.`))
