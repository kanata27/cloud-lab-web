import test from 'node:test';
import assert from 'node:assert/strict';
import {authorize,accessSettings} from '../worker/access.js';
import worker from '../worker/index.js';
import {accessEnv,accessToken,keysResponse} from './support/access-fixture.mjs';
const request=token=>new Request('https://kanata.test/api/session',{headers:token?{'Cf-Access-Jwt-Assertion':token}:{}});

test('Access verifies signature, issuer, audience, expiry, type and exact owner email',async()=>{
  const original=globalThis.fetch;let calls=0;
  globalThis.fetch=async(url,options)=>{calls++;assert.equal(options.redirect,'manual');return keysResponse(url);};
  try{
    assert.equal((await authorize(request(await accessToken()),accessEnv)).email,'owner@example.test');
    for(const [claims,status] of [
      [{email:'stranger@example.test'},403],[{type:'service'},403],
      [{aud:['b'.repeat(64)]},401],[{iss:'https://attacker.invalid'},401],
      [{exp:Math.floor(Date.now()/1000)-1},401],[{nbf:Math.floor(Date.now()/1000)+600},401],
      [{iat:Math.floor(Date.now()/1000)-9*3600},401],[{email:undefined},401],
    ]) await assert.rejects(()=>accessToken(claims).then(t=>authorize(request(t),accessEnv)),e=>e.status===status);
    const token=await accessToken();
    const parts=token.split('.');parts[1]=Buffer.from(JSON.stringify({email:accessEnv.ACCESS_ALLOWED_EMAIL})).toString('base64url');
    await assert.rejects(()=>authorize(request(parts.join('.')),accessEnv),e=>e.status===401);
    await assert.rejects(()=>authorize(request('a.b.c'),accessEnv),e=>e.status===401);
    for(const headers of [{},{Authorization:'Bearer old-aws-token'},{'Cf-Access-Authenticated-User-Email':'owner@example.test'},{Cookie:'CF_Authorization=forged'}]){
      await assert.rejects(()=>authorize(new Request('https://kanata.test/api/session',{headers}),accessEnv),e=>e.status===401);
    }
    assert.equal(calls,1,'public key is reused, not fetched for every API call');
  }finally{globalThis.fetch=original;}
});

test('missing configuration, wrong hosts and every protected page/alias fail closed',async()=>{
  const env={...accessEnv,EARNINGS_DB:{},ASSETS:{fetch(){throw Error('Unauthenticated private asset reached storage');}}};
  for(const path of ['/stat-panel/','/stat-panel/earnings','/stat-panel/insights.html','/stat-panel/dashboard.js','/stat-%70anel/earnings','/api/stats','/earnings-api/spots']){
    const response=await worker.fetch(new Request('https://kanata.test'+path),env);
    assert.equal(response.status,401,path);assert.match(response.headers.get('Cache-Control'),/no-store/);
  }
  for(const path of ['/statpanel','/statistics-panel/index.html']){
    const response=await worker.fetch(new Request('https://kanata.test'+path),env);
    assert.equal(response.status,302,path);
    assert.ok(response.headers.get('Location').startsWith('https://kanata.test/stat-panel/'));
  }
  for(const bad of [{ACCESS_ALLOWED_EMAIL:''},{ACCESS_TEAM_DOMAIN:'https://attacker.invalid'},{ACCESS_AUD:''}]){
    assert.equal((await worker.fetch(request(),{...env,...bad})).status,503);
  }
  assert.equal((await worker.fetch(new Request('https://kanata-web.workers.dev/api/session'),env)).status,404);
  assert.equal((await worker.fetch(new Request('https://kanata.test/stat-panel%252Fearnings'),env)).status,400);
});

test('identity-service failure and forged email headers cannot authorize a request',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async()=>new Response('',{status:503});
  try{
    const env={...accessEnv,ACCESS_TEAM_DOMAIN:'https://unavailable-test.cloudflareaccess.com'};
    const token=await accessToken({iss:env.ACCESS_TEAM_DOMAIN});
    await assert.rejects(()=>authorize(request(token),env),error=>error.status===503);
  }finally{globalThis.fetch=original;}
});

test('authenticated assets are never public-cacheable and unsafe requests are rejected',async()=>{
  const original=globalThis.fetch;globalThis.fetch=async(url)=>keysResponse(url);
  try{
    const token=await accessToken(),headers={'Cf-Access-Jwt-Assertion':token};
    const env={...accessEnv,EARNINGS_DB:{},ASSETS:{fetch:async()=>new Response('PRIVATE',{headers:{'Cache-Control':'public,max-age=86400'}})}};
    const response=await worker.fetch(new Request('https://kanata.test/stat-panel/earnings',{headers}),env);
    assert.equal(response.status,200);assert.match(response.headers.get('Cache-Control'),/no-store/);
    assert.match(response.headers.get('Vary'),/Cf-Access/);
    assert.equal((await worker.fetch(new Request('https://kanata.test/api/session',{headers}),env)).status,200);
    for(const origin of [undefined,'https://attacker.invalid']){
      const h={...headers,'Content-Type':'application/json'};if(origin)h.Origin=origin;
      assert.equal((await worker.fetch(new Request('https://kanata.test/earnings-api/spots',{method:'POST',headers:h,body:'{}'}),env)).status,403);
    }
    const alias=await worker.fetch(new Request('https://www.kanata.test/stat-panel/earnings'),env);
    assert.equal(alias.status,302);assert.equal(alias.headers.get('Location'),'https://kanata.test/stat-panel/earnings');
    const login=await worker.fetch(new Request('https://kanata.test/stat-panel/login.html',{headers}),env);
    assert.equal(login.status,302);assert.equal(login.headers.get('Location'),'https://kanata.test/stat-panel/earnings.html');
  }finally{globalThis.fetch=original;}
});

test('the email allowlist accepts either exact address, without extending trust to other identities',async()=>{
  const original=globalThis.fetch;globalThis.fetch=async(url)=>keysResponse(url);
  const env={...accessEnv,ACCESS_ALLOWED_EMAILS:' OWNER@example.test , backup@example.test,owner@example.test '};
  try{
    assert.deepEqual([...accessSettings(env).emails],['owner@example.test','backup@example.test']);
    for(const email of ['owner@example.test','backup@example.test','BACKUP@example.test']){
      const identity=await authorize(request(await accessToken({email})),env);
      assert.equal(identity.email,email.toLowerCase());
    }
    for(const email of ['stranger@example.test','owner@example.test.attacker.invalid','owner+other@example.test']){
      await assert.rejects(()=>accessToken({email}).then(token=>authorize(request(token),env)),e=>e.status===403);
    }
    for(const claims of [{email:'backup@example.test',type:'service'},
      {email:'backup@example.test',aud:['b'.repeat(64)]},
      {email:'backup@example.test',exp:Math.floor(Date.now()/1000)-1}]){
      await assert.rejects(()=>accessToken(claims).then(token=>authorize(request(token),env)),e=>[401,403].includes(e.status));
    }
    // Configuring the new secret replaces the legacy address; it is not a union.
    await assert.rejects(()=>accessToken().then(token=>authorize(request(token),{
      ...env,ACCESS_ALLOWED_EMAILS:'backup@example.test',
    })),e=>e.status===403);
    assert.equal((await authorize(request(await accessToken()),accessEnv)).email,'owner@example.test');
  }finally{globalThis.fetch=original;}
});

test('an invalid allowlist fails closed even when a valid legacy secret still exists',()=>{
  const invalid=['',null,123,[],{},'owner@example.test,','owner@example.test,,backup@example.test',
    '*@example.test','owner@example.test;backup@example.test','Name <owner@example.test>',
    'a'.repeat(255)+'@example.test','owner@example.test,'.repeat(300),
    Array.from({length:9},(_,i)=>`owner${i}@example.test`).join(',')];
  for(const value of invalid){
    assert.throws(()=>accessSettings({...accessEnv,ACCESS_ALLOWED_EMAILS:value}),error=>error.status===503);
  }
});

test('a blocked page provides session recovery without leaking the allowlist or loading private assets',async()=>{
  const original=globalThis.fetch;globalThis.fetch=async(url)=>keysResponse(url);
  const env={...accessEnv,ACCESS_ALLOWED_EMAILS:'owner@example.test,backup@example.test',EARNINGS_DB:{},
    ASSETS:{fetch(){throw Error('A denied request must not load private assets');}}};
  try{
    for(const [token,status,title] of [
      [null,401,'Войди заново'],
      [await accessToken({email:'stranger@example.test'}),403,'Этот аккаунт не допущен'],
      [await accessToken({exp:Math.floor(Date.now()/1000)-1}),401,'Войди заново'],
    ]){
      const headers={Accept:'text/html'};if(token)headers['Cf-Access-Jwt-Assertion']=token;
      const response=await worker.fetch(new Request('https://kanata.test/stat-panel/earnings.html',{headers}),env);
      assert.equal(response.status,status);
      const html=await response.text();
      assert.ok(html.includes(`<h1>${title}</h1>`));
      assert.match(html,/href="\/cdn-cgi\/access\/logout"/);
      assert.match(html,/Сбросить сессию и войти/);
      assert.doesNotMatch(html,/owner@example|backup@example|stranger@example|<script/);
      const nonce=html.match(/<style nonce="([a-f0-9]+)">/)[1];
      assert.ok(response.headers.get('Content-Security-Policy').includes(`style-src 'nonce-${nonce}'`));
      assert.match(response.headers.get('Cache-Control'),/no-store/);
    }
    const unavailable=await worker.fetch(new Request('https://kanata.test/stat-panel/',{headers:{Accept:'text/html'}}),{
      ...env,ACCESS_ALLOWED_EMAILS:'',
    });
    assert.equal(unavailable.status,503);assert.match(await unavailable.text(),/Вход временно недоступен/);
  }finally{globalThis.fetch=original;}
});

test('public recovery remains reachable without a session or database and never reflects return destinations',async()=>{
  const env={...accessEnv,ASSETS:{fetch(){throw Error('Recovery must be self contained');}}};
  for(const [suffix,title] of [
    ['', 'Вход в панель'],['?reason=expired','Войди заново'],['?reason=denied','Этот аккаунт не допущен'],
    ['?reason=constructor&next=https://attacker.invalid','Вход в панель'],
    ['?reason=%3Cscript%3E&next=//attacker.invalid','Вход в панель'],
  ]){
    const response=await worker.fetch(new Request('https://kanata.test/panel-login/'+suffix),env);
    assert.equal(response.status,200);
    const html=await response.text();assert.ok(html.includes(`<h1>${title}</h1>`));
    assert.doesNotMatch(html,/attacker.invalid|<script|owner@example/);
    assert.match(response.headers.get('Cache-Control'),/no-store/);
  }
  const head=await worker.fetch(new Request('https://kanata.test/panel-login/',{method:'HEAD'}),env);
  assert.equal(head.status,200);assert.equal(await head.text(),'');
  const deniedHead=await worker.fetch(new Request('https://kanata.test/stat-panel/',{method:'HEAD',headers:{Accept:'text/html'}}),{
    ...env,EARNINGS_DB:{},
  });
  assert.equal(deniedHead.status,401);assert.equal(await deniedHead.text(),'');
  assert.equal((await worker.fetch(new Request('https://kanata.test/panel-login/',{method:'POST'}),env)).status,405);
  assert.equal((await worker.fetch(new Request('https://attacker.invalid/panel-login/'),env)).status,404);
  const alias=await worker.fetch(new Request('https://www.kanata.test/panel-login/'),env);
  assert.equal(alias.status,302);assert.equal(alias.headers.get('Location'),'https://kanata.test/panel-login/');
});
