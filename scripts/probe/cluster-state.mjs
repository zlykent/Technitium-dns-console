// Ad-hoc probe: what does admin/cluster/state actually return, with and without
// includeServerIpAddresses? Run with `node scripts/probe/cluster-state.mjs`.
const BASE = process.env.E2E_DNS_URL || 'http://127.0.0.1:5380'
const USER = process.env.E2E_DNS_USER || 'admin'
const PASS = process.env.E2E_DNS_PASS || '123456'

const login = await (await fetch(`${BASE}/api/user/login?user=${USER}&pass=${PASS}`)).json()
console.log('login status:', login.status)
if (login.status !== 'ok') {
  console.log(JSON.stringify(login, null, 2))
  process.exit(1)
}
// `user/login` is the one endpoint whose payload is not nested under `response`:
// `token` sits next to `status` (see .probe/user.login.json).
const token = login.token

async function get(path) {
  const res = await fetch(`${BASE}/api/${path}${path.includes('?') ? '&' : '?'}token=${token}`)
  const json = await res.json()
  return json
}

for (const q of ['admin/cluster/state', 'admin/cluster/state?includeServerIpAddresses=true']) {
  const json = await get(q)
  console.log(`\n=== ${q} ===`)
  console.log('status:', json.status)
  console.log('response keys:', Object.keys(json.response ?? {}).join(', '))
  console.log(JSON.stringify(json.response, null, 2))
}
