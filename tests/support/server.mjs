// Loopback-only identity-provider stand-in. Never included in dist or deployed.
import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {build,securityHeaders} from '../../tools/build.mjs';
import worker from '../../worker/index.js';
import {accessEnv,accessToken,keysResponse} from './access-fixture.mjs';
import {database} from './database.mjs';

const root=await build(),{db}=database();
const tokens={
 valid:await accessToken(),
 denied:await accessToken({email:'backup@example.test'}),
 expired:await accessToken({exp:Math.floor(Date.now()/1000)-1}),
};
globalThis.fetch=async(url)=>keysResponse(url);
const origin='http://127.0.0.1:8787';
const config=JSON.parse(await readFile(new URL('../../site.config.json',import.meta.url)));
const csp=securityHeaders(config).split('\n').find(line=>line.includes('Content-Security-Policy:')).trim().slice('Content-Security-Policy: '.length);
const assets={async fetch(request){
 try{
  const url=new URL(request.url),path=decodeURIComponent(url.pathname);
  let file=resolve(root,'.'+path);
  if(!file.startsWith(root+'/')&&file!==root)return new Response('',{status:400});
  if(path.endsWith('/'))file=resolve(file,'index.html');
  try{const info=await stat(file);if(info.isDirectory())return Response.redirect(url.origin+path+'/',307);}catch{if(!extname(file))file+='.html';}
  const content=await readFile(file);
  const type={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp','.woff2':'font/woff2'}[extname(file)]||'application/octet-stream';
  return new Response(request.method==='HEAD'?null:content,{headers:{'Content-Type':type,'Content-Security-Policy':csp,'X-Content-Type-Options':'nosniff','Cache-Control':'no-store'}});
 }catch{return new Response('Not found',{status:404});}
}};
http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,origin),cookie=req.headers.cookie||'';
  if(url.pathname==='/test/access/login') {
   res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}).end('<!doctype html><html lang="ru"><title>Access test login</title><h1>Email + код · test fixture</h1><p>No real OTP is sent.</p><a href="/test/access/sign-in?account=primary">Email + код</a></html>');return;
  }
  if(url.pathname==='/test/access/sign-in'){
   const identities={primary:'valid'};
   const account=url.searchParams.get('account');
   if(!Object.hasOwn(identities,account)){res.writeHead(400).end('Unknown test identity');return;}
   res.writeHead(302,{'Set-Cookie':`test_access=${identities[account]}; Path=/; HttpOnly; SameSite=Lax`,Location:'/stat-panel/'}).end();return;
  }
  if(url.pathname==='/cdn-cgi/access/logout'){
   res.writeHead(302,{'Set-Cookie':'test_access=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax',Location:'/test/access/login'}).end();return;
  }
  const identity=/(?:^|;\s*)test_access=(valid|denied|expired)(?:;|$)/.exec(cookie)?.[1];
  const authenticated=Boolean(identity);
  const path=decodeURIComponent(url.pathname);
  if(/^\/(?:stat-panel|statpanel|statistics-panel)(?:\/|$)/.test(path)&&!authenticated){
   res.writeHead(302,{Location:'/test/access/login','Cache-Control':'no-store'}).end();return;
  }
  const headers=new Headers();
  for(const [key,value] of Object.entries(req.headers))if(value)headers.set(key,Array.isArray(value)?value.join(','):value);
  if(authenticated)headers.set('Cf-Access-Jwt-Assertion',tokens[identity]);
  else headers.delete('Cf-Access-Jwt-Assertion');
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const data=Buffer.concat(chunks);
  const request=new Request(url,{method:req.method,headers,body:data.length?data:undefined});
  const response=await worker.fetch(request,{...accessEnv,CANONICAL_HOST:'127.0.0.1:8787',PUBLIC_ALIASES:'',EARNINGS_DB:db,ASSETS:assets,EVENTS_RATE_LIMITER:{limit:async()=>({success:true})}});
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
 }catch(error){console.error(error);res.writeHead(500).end('Test server error');}
}).listen(8787,'127.0.0.1');
