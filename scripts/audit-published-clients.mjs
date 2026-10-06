// Read-only public publication check. Never reads browser storage or credentials.
import {createHash} from 'node:crypto'
import {writeFileSync} from 'node:fs'
const sites=[['pages','https://mefodi-2026.github.io/youth-pulse/'],['develop','https://youth-pulse-dev-git-develop-comanda1.vercel.app/']]
const report=[]
for(const [publication,base]of sites){
 const htmlResponse=await fetch(base),html=await htmlResponse.text()
 const src=html.match(/<script[^>]+src="([^"]+\.js)"/)?.[1]
 if(!src)throw Error(`${publication}: no public app bundle; HTTP ${htmlResponse.status}`)
 const url=new URL(src,base).href,response=await fetch(url),code=await response.text()
 const project=code.match(/projectId:"([^"]+)"/)?.[1],database=code.match(/databaseURL:"([^"]+)"/)?.[1]
 const activityOffsets=[...code.matchAll(/sessions\/\$\{[^}]+\}\/lastActivityAt/g)].map(m=>m.index)
 const activity=activityOffsets.map(i=>code.slice(Math.max(0,i-40),i+110))
 const row={publication,checkedAt:new Date().toISOString(),base,htmlStatus:htmlResponse.status,bundleUrl:url,bundleStatus:response.status,bundleSha256:createHash('sha256').update(code).digest('hex'),bytes:Buffer.byteLength(code),firebaseProject:project,firebaseDatabase:database,activityWriteSnippets:activity}
 report.push(row)
 console.log(JSON.stringify(row))
}
const workflowResponse=await fetch('https://api.github.com/repos/mefodi-2026/youth-pulse/actions/runs?head_sha=be630ad93466bf3b94d5ecb6a6a63f7fe7d62839&per_page=3')
const workflow=workflowResponse.ok?(await workflowResponse.json()).workflow_runs?.map(r=>({id:r.id,name:r.name,headSha:r.head_sha,status:r.status,conclusion:r.conclusion,createdAt:r.created_at,updatedAt:r.updated_at,url:r.html_url})):[]
writeFileSync('audit-results/published-clients-2026-10-06.json',JSON.stringify({clients:report,pagesWorkflow:{httpStatus:workflowResponse.status,runs:workflow}},null,2))
console.log(JSON.stringify({pagesWorkflow:workflow}))
