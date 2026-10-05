// Read-only, bounded incident-window query. Never persist raw payloads or identities.
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(process.argv[2])
const load = name => require(path.join(root, 'lib', name))
async function main() {
  const account = load('auth').getGlobalDefaultAccount()
  if (!account) throw Error('Firebase CLI login unavailable')
  await load('requireAuth').requireAuth({project:'molodeh-c523e', user:account.user, tokens:account.tokens})
  const filter = 'resource.type="cloud_run_revision" AND resource.labels.service_name="joinroomasguest" AND timestamp>="2026-09-29T15:38:00Z" AND timestamp<="2026-09-29T15:43:00Z"'
  const entries = []
  let pageToken
  do {
    const page = await load('gcp/cloudlogging').listEntries('molodeh-c523e', filter, 1000, 'asc', pageToken)
    entries.push(...page.entries); pageToken = page.nextPageToken
  } while (pageToken && entries.length < 10000)
  const requests = entries.filter(e => e.httpRequest)
  const histogram = {}
  for (const e of requests) { const key = `${e.httpRequest.requestMethod}:${e.httpRequest.status}`; histogram[key] = (histogram[key] || 0) + 1 }
  const failures = requests.filter(e => e.httpRequest.status === 429).map((e, i) => {
    const related = entries.filter(x => x.trace && x.trace === e.trace && !x.httpRequest)
    return {requestId:`window-429-${i+1}`, time:e.timestamp, status:429, latency:e.httpRequest.latency,
      reachedVerifiedHandler:related.some(x => x.jsonPayload?.message === 'Callable request verification passed'),
      relatedSeverities:related.map(x => x.severity),
      capacityMessageRecorded:related.some(x => /Комната уже заполнена/.test(x.textPayload || x.jsonPayload?.message || '')),
      infrastructureRejectionRecorded:related.some(x => /no available instance|maximum instance|rate limit|quota/i.test(x.textPayload || x.jsonPayload?.message || ''))}
  })
  const result = {capturedAt:new Date().toISOString(), window:{from:'2026-09-29T15:38:00Z',to:'2026-09-29T15:43:00Z'}, entries:entries.length, truncated:Boolean(pageToken), histogram, failures,
    caveat:'Request logs do not contain callable response bodies. Verified handler entry excludes rejection before handler, but does not prove capacity failure without body or application outcome log.'}
  fs.writeFileSync('audit-results/cloud-429-correlation.json', JSON.stringify(result,null,2))
  console.log(JSON.stringify({entries:result.entries,histogram,failures:failures.length,verified:failures.filter(x=>x.reachedVerifiedHandler).length,capacityMessageRecorded:failures.filter(x=>x.capacityMessageRecorded).length,infrastructureRejectionRecorded:failures.filter(x=>x.infrastructureRejectionRecorded).length,truncated:result.truncated}))
}
main().catch(e => { console.error(e.code || 'AUDIT_QUERY_FAILED'); process.exitCode=1 })
