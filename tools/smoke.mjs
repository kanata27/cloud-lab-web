// Read-only smoke: no events, credentials, OTP messages, or database writes.
import assert from 'node:assert/strict';
const target=process.argv[2];
assert.ok(['preview','production'].includes(target),'Choose preview or production');
const origin=target==='production'?'https://kanata27.com':'https://preview.kanata27.com';
async function read(path,headers={}) {
 return fetch(origin+path,{headers,redirect:'manual',signal:AbortSignal.timeout(15000)});
}
for(const path of ['/','/?q=migration-check','/assets/hero.webp','/site-config.js']) {
 const response=await read(path);
 assert.equal(response.status,200,'Public route failed: '+path);
 assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');
}
assert.equal((await read('/does-not-exist')).status,404);
for(const path of ['/stat-panel/','/stat-panel/earnings','/stat-panel/insights','/stat-panel/dashboard.js','/api/stats?from=2026-10-01&to=2026-10-01&source=all','/earnings-api/spots']) {
 for(const headers of [{},{Authorization:'Bearer forged-legacy-token','Cf-Access-Authenticated-User-Email':'forged@example.test'}]) {
  const response=await read(path,headers);
  assert.ok([302,303,401,403].includes(response.status),'Guest was not denied on '+path+' ('+response.status+')');
 }
}
if(target==='production')assert.equal((await fetch('https://www.kanata27.com/',{redirect:'manual'})).status,200);
console.log('PASS: public site works; guests and legacy/spoofed credentials cannot read panel or APIs.');
