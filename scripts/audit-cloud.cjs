// Read-only metadata and redacted logs using an already authenticated Firebase CLI.
// Usage: node scripts/audit-cloud.cjs <firebase-tools directory>
const fs = require('node:fs')
const path = require('node:path')
const { pipeline } = require('node:stream/promises')
const root = path.resolve(process.argv[2])
const load = module => require(path.join(root,'lib',module))
const project = 'molodeh-c523e'
const safeMessage = text => String(text || '').replace(/[\w.+-]+@[\w.-]+/g,'[redacted-email]').replace(/\b[\w-]{24,}\b/g,'[redacted-id]').split('\n')[0].slice(0,300)
async function main(){
  const account=load('auth').getGlobalDefaultAccount()
  if(!account)throw new Error('Firebase CLI is not authenticated')
  await load('requireAuth').requireAuth({project,user:account.user,tokens:account.tokens})
  const {Client}=load('apiv2')
  const api=new Client({urlPrefix:'https://cloudfunctions.googleapis.com',apiVersion:'v2'})
  const response=await api.get(`/projects/${project}/locations/europe-west1/functions`)
  const functions=response.body.functions.filter(f=>['joinRoomAsGuest','submitQuizAnswer','createQuizRoom'].includes(f.buildConfig.entryPoint))
  const meta=functions.map(f=>({name:f.buildConfig.entryPoint,state:f.state,updateTime:f.updateTime,revision:f.serviceConfig.revision,sourceGeneration:f.buildConfig.source?.storageSource?.generation,hash:f.labels?.['firebase-functions-hash'],database:JSON.parse(f.serviceConfig.environmentVariables.FIREBASE_CONFIG).databaseURL,maxInstances:f.serviceConfig.maxInstanceCount,concurrency:f.serviceConfig.maxInstanceRequestConcurrency}))
  const {listEntries}=load('gcp/cloudlogging')
  const filter='resource.type="cloud_run_revision" AND (resource.labels.service_name="joinroomasguest" OR resource.labels.service_name="submitquizanswer") AND timestamp>="2026-09-01T00:00:00Z"'
  const logs=await listEntries(project,filter,1000,'desc')
  const serverErrors=await listEntries(project,filter+' AND severity>=ERROR',1000,'desc')
  const histogram={}
  for(const e of logs.entries){const key=`${e.resource?.labels?.service_name}:${e.httpRequest?.status??e.severity??'unknown'}`;histogram[key]=(histogram[key]||0)+1}
  const failures=logs.entries.filter(e=>Number(e.httpRequest?.status)>=400||['ERROR','CRITICAL','ALERT','EMERGENCY'].includes(e.severity)).map(e=>({timestamp:e.timestamp,service:e.resource.labels.service_name,status:e.httpRequest?.status,latency:e.httpRequest?.latency,severity:e.severity,message:safeMessage(e.jsonPayload?.message||e.textPayload)}))
  const result={capturedAt:new Date().toISOString(),functions:meta,logEntries:logs.entries.length,hasMore:Boolean(logs.nextPageToken),histogram,failures,serverErrors:serverErrors.entries.map(e=>({timestamp:e.timestamp,service:e.resource.labels.service_name,status:e.httpRequest?.status,message:safeMessage(e.jsonPayload?.message||e.textPayload)}))}
  fs.mkdirSync('audit-results',{recursive:true});fs.writeFileSync('audit-results/cloud-metadata.json',JSON.stringify(result,null,2));console.log(JSON.stringify({...result,failures:failures.slice(0,5)},null,2))
  if(process.env.AUDIT_DOWNLOAD_SOURCE==='1'){
    const source=functions.find(f=>f.buildConfig.entryPoint==='joinRoomAsGuest').buildConfig.source.storageSource
    const storage=new Client({urlPrefix:'https://storage.googleapis.com',apiVersion:'storage/v1'})
    const data=await storage.get(`/b/${source.bucket}/o/${encodeURIComponent(source.object)}`,{queryParams:{alt:'media',generation:source.generation},responseType:'stream',resolveOnHTTPError:true})
    if(data.status>=400)throw new Error(`Source download HTTP ${data.status}`)
    await pipeline(data.body,fs.createWriteStream(path.join(process.env.TEMP,'youth-pulse-audit-deployed-functions.zip')))
    console.log('Deployed function source downloaded to the temporary audit ZIP.')
  }
}
main().catch(e=>{console.error(safeMessage(e.message));process.exitCode=1})
