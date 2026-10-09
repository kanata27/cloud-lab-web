import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker from '../worker/earnings.js';
import {duration,validateEntry,convert,summary} from '../statistics-panel/earnings-model.js';
const base={id:'record-1',date:'2026-09-01',start:'14:20',end:'17:12',nextDay:false,spotId:'spot-a',amounts:[{currency:'CZK',amount:'220'},{currency:'EUR',amount:'2,2'},{currency:'USD',amount:'2'}]};
test('duration, mixed currencies, weighted hourly totals and DST validation',()=>{
 const record=validateEntry(base);assert.equal(record.minutes,172);
 const totals=convert(record.amounts,{rates:{CZK:1,EUR:25,USD:20}});assert.deepEqual(totals,{czkMinor:31500,eurMinor:1260});
 assert.equal(summary([{...record,...totals},{minutes:60,czkMinor:10000,eurMinor:400}]).hourCzk,415*60/232);
 assert.equal(duration('2026-09-01','23:30','00:30',true).minutes,60);
 assert.throws(()=>duration('2026-03-29','02:30','04:00'));
 assert.throws(()=>duration('2026-10-25','02:30','04:00'));
 assert.throws(()=>validateEntry({...base,amounts:base.amounts.slice(1)}));
 assert.throws(()=>validateEntry({...base,amounts:[...base.amounts,{currency:'EUR',amount:'1'}]}));
 assert.throws(()=>validateEntry({...base,end:'13:00'}));
 assert.throws(()=>validateEntry({...base,amounts:base.amounts.map(a=>({...a,amount:'-1'}))}));
});
test('authenticated persistent CRUD, server conversion, snapshots, conflicts, filtering and deletion',async()=>{
 const sqlite=new DatabaseSync(':memory:');sqlite.exec(readFileSync(new URL('../migrations/0001_earnings.sql',import.meta.url),'utf8'));
 const db={prepare(sql){return {bind(...args){return {async first(){return sqlite.prepare(sql).get(...args)||null;},async all(){return {results:sqlite.prepare(sql).all(...args)};},async run(){return {meta:{changes:Number(sqlite.prepare(sql).run(...args).changes)}};}}},async all(){return {results:sqlite.prepare(sql).all()};}}}};
 let rateCalls=0,authDown=false;
 const original=globalThis.fetch;globalThis.fetch=async(url,options)=>{
  if(String(url).includes('/stats?'))return authDown?new Response('',{status:503}):options.headers.Authorization==='Bearer valid'?Response.json({version:1,totals:{},daily:[]}):new Response('',{status:401});
  rateCalls++;return Response.json([{base:'EUR',quote:'CZK',date:'2026-09-01',rate:25},{base:'EUR',quote:'USD',date:'2026-09-01',rate:1.25}]);
 };
 const call=async(path,method='GET',data,token='valid')=>{const res=await worker.fetch(new Request('https://kanata.test/earnings-api'+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined}),{EARNINGS_DB:db});return {status:res.status,data:await res.json()};};
 try{
  assert.equal((await call('/spots','POST',{name:'A'},'bad')).status,401);
  assert.equal((await call('/spots')).data.spots.length,0);
  const spot=(await call('/spots','POST',{name:'A'})).data;
  assert.equal((await call('/spots','POST',{name:'a'})).data.id,spot.id);
  const input={...base,spotId:spot.id,czkMinor:99999999};
  const created=await call('/entries','POST',input);assert.equal(created.status,201);assert.equal(created.data.czkMinor,31500);assert.equal(created.data.eurMinor,1260);
  assert.equal((await call('/entries','POST',input)).status,200);assert.equal(rateCalls,1);
  const edited=await call('/entries/record-1','PUT',{...input,version:1,end:'18:20'});assert.equal(edited.status,200);assert.equal(edited.data.version,2);assert.equal(edited.data.minutes,240);assert.equal(rateCalls,1);
  assert.equal((await call('/entries/record-1','PUT',{...input,version:1})).status,409);
  assert.equal((await call('/entries?from=2026-09-01&to=2026-09-30')).data.entries.length,1);
  assert.equal((await call('/entries?from=2026-09-01&to=2026-09-30&spot=another')).data.entries.length,0);
  authDown=true;assert.equal((await call('/spots')).status,503);authDown=false;
  assert.equal((await call('/entries/record-1','DELETE',{version:1})).status,409);
  assert.equal((await call('/entries/record-1','DELETE',{version:2})).status,200);
  assert.equal((await call('/entries?from=2026-09-01&to=2026-09-30')).data.entries.length,0);
 }finally{globalThis.fetch=original;sqlite.close();}
});
