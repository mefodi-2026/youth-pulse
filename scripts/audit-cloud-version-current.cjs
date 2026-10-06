// Existing CLI login, read-only deployment metadata and bounded sanitized logs.
const fs=require('node:fs'),path=require('node:path'),load=name=>require(path.join(path.resolve(process.argv[2]),'lib',name))
async function main(){
 const project='molodeh-c523e',account=load('auth').getGlobalDefaultAccount()
 await load('requireAuth').requireAuth({project,user:account.user,tokens:account.tokens})
 const Client=load('apiv2').Client,api=new Client({urlPrefix:'https://cloudfunctions.googleapis.com',apiVersion:'v2'})
 const response=await api.get(`/projects/${project}/locations/europe-west1/functions`)
 const functions=response.body.functions.filter(f=>['joinRoomAsGuest','submitQuizAnswer','createQuizRoom'].includes(f.buildConfig.entryPoint)).map(f=>({name:f.buildConfig.entryPoint,state:f.state,updateTime:f.updateTime,revision:f.serviceConfig.revision,database:JSON.parse(f.serviceConfig.environmentVariables.FIREBASE_CONFIG).databaseURL}))
 const logging=new Client({urlPrefix:'https://logging.googleapis.com',apiVersion:'v2'})
 const logs=await logging.post('/entries:list',{resourceNames:[`projects/${project}`],filter:'resource.type="cloud_run_revision" AND (resource.labels.service_name="joinroomasguest" OR resource.labels.service_name="submitquizanswer") AND timestamp>="2026-10-06T02:32:00Z" AND timestamp<="2026-10-06T02:35:00Z"',orderBy:'timestamp desc',pageSize:1000})
 const entries=logs.body.entries||[],histogram={}
 for(const e of entries){const k=`${e.resource?.labels?.service_name}:${e.httpRequest?.status??e.severity??'unknown'}`;histogram[k]=(histogram[k]||0)+1}
 const result={capturedAt:new Date().toISOString(),functions,window:'2026-10-06 02:32..02:35 UTC; project-wide service logs, not proof of per-room correlation',count:entries.length,hasMore:!!logs.body.nextPageToken,histogram,failures:entries.filter(e=>e.httpRequest?.status>=400).map(e=>({at:e.timestamp,status:e.httpRequest.status,latency:e.httpRequest.latency,service:e.resource.labels.service_name}))}
 fs.writeFileSync('audit-results/cloud-version-2026-10-06.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result))
}
main().catch(e=>{console.error('READ_ONLY_METADATA_FAILED',e.status||e.code||'unknown');process.exitCode=1})
