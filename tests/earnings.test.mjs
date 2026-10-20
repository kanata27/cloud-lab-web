import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker from '../worker/index.js';
import {accessEnv,accessToken,keysResponse} from './support/access-fixture.mjs';
import {duration,validateEntry,convert,summary,weeklyFrequency} from '../statistics-panel/earnings-model.js';
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

test('average duration weights each performance equally and keeps precise monetary totals',()=>{
 const entries=[
  {date:'2026-10-01',spotId:'a',minutes:120,czkMinor:13860,eurMinor:554},
  {date:'2026-10-01',spotId:'b',minutes:180,czkMinor:22040,eurMinor:882},
  {date:'2026-10-19',spotId:'a',minutes:81,czkMinor:5050,eurMinor:202},
 ];
 const totals=summary(entries);
 assert.equal(totals.averageMinutes,127);
 assert.equal(totals.count,3);
 assert.equal(totals.czkMinor,40950);
 assert.equal(summary(entries.filter(entry=>entry.spotId==='a')).averageMinutes,100.5);
 assert.equal(summary(entries.slice(0,2)).averageMinutes,150);
 assert.equal(summary([]).averageMinutes,null);
});

test('weekly frequency uses only complete Monday–Sunday weeks, including zero weeks',()=>{
 const entries=['2026-10-04','2026-10-06','2026-10-08','2026-10-13','2026-10-15','2026-10-18','2026-10-19'].map(date=>({date}));
 assert.deepEqual(weeklyFrequency(entries,{from:'2026-10-05',to:'2026-10-18'}),{weeks:2,count:5,from:'2026-10-05',to:'2026-10-18',average:2.5});
 assert.deepEqual(weeklyFrequency(entries,{from:'2026-10-01',to:'2026-10-20'}),{weeks:2,count:5,from:'2026-10-05',to:'2026-10-18',average:2.5});
 assert.equal(weeklyFrequency(entries,{from:'2026-10-06',to:'2026-10-18'}).average,3);
 assert.equal(weeklyFrequency(entries,{from:'2026-09-21',to:'2026-10-18'}).average,1.5);
 assert.equal(weeklyFrequency([{date:'2026-10-06'},{date:'2026-10-06'}],{from:'2026-10-05',to:'2026-10-11'}).average,2);
 assert.equal(weeklyFrequency([],{from:'2026-10-05',to:'2026-10-18'}).average,0);
 assert.deepEqual(weeklyFrequency(entries,{from:'2026-10-06',to:'2026-10-11'}),{weeks:0,count:0,from:null,to:null,average:null});
 assert.equal(weeklyFrequency(entries,{from:'2026-10-05',to:'2026-10-05'}).average,null);
});

test('full-week boundaries remain calendar based across DST, leap days and New Year',()=>{
 assert.deepEqual(weeklyFrequency([{date:'2026-10-25'},{date:'2026-11-01'}],{from:'2026-10-19',to:'2026-11-01'}),{weeks:2,count:2,from:'2026-10-19',to:'2026-11-01',average:1});
 assert.deepEqual(weeklyFrequency([{date:'2025-12-28'},{date:'2026-01-04'}],{from:'2025-12-22',to:'2026-01-04'}),{weeks:2,count:2,from:'2025-12-22',to:'2026-01-04',average:1});
 assert.deepEqual(weeklyFrequency([],{from:'2024-02-01',to:'2024-02-29'}),{weeks:3,count:0,from:'2024-02-05',to:'2024-02-25',average:0});
 for(const range of [{from:'2026-02-30',to:'2026-03-10'},{from:'2026-10-20',to:'2026-10-01'}])assert.throws(()=>weeklyFrequency([],range));
 assert.throws(()=>weeklyFrequency([{date:'invalid'}],{from:'2026-10-05',to:'2026-10-18'}));
});
test('authenticated persistent CRUD, server conversion, snapshots, conflicts, filtering and deletion',async()=>{
 const sqlite=new DatabaseSync(':memory:');sqlite.exec(readFileSync(new URL('../migrations/0001_earnings.sql',import.meta.url),'utf8'));
 const db={prepare(sql){return {bind(...args){return {async first(){return sqlite.prepare(sql).get(...args)||null;},async all(){return {results:sqlite.prepare(sql).all(...args)};},async run(){return {meta:{changes:Number(sqlite.prepare(sql).run(...args).changes)}};}}},async all(){return {results:sqlite.prepare(sql).all()};}}}};
 let rateCalls=0,authDown=false;
 const original=globalThis.fetch;globalThis.fetch=async(url,options)=>{
  if(String(url).includes('/cdn-cgi/access/certs'))return keysResponse(url);
  rateCalls++;return Response.json([{base:'EUR',quote:'CZK',date:'2026-09-01',rate:25},{base:'EUR',quote:'USD',date:'2026-09-01',rate:1.25}]);
 };
 const call=async(path,method='GET',data,token='valid')=>{const res=await worker.fetch(new Request('https://kanata.test/earnings-api'+path,{method,headers:{'Cf-Access-Jwt-Assertion':token==='valid'?await accessToken():'invalid.invalid.invalid','Content-Type':'application/json',Origin:'https://kanata.test'},body:data?JSON.stringify(data):undefined}),{...accessEnv,EARNINGS_DB:db,...(authDown?{ACCESS_ALLOWED_EMAIL:''}:{})});return {status:res.status,data:await res.json()};};
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
  const originalSpot=sqlite.prepare('SELECT * FROM earnings_spots WHERE id=?').get(spot.id);
  await call('/spots','POST',{name:'Anděl'});
  assert.equal((await call('/spots/'+spot.id,'PUT',{name:'Unauthorized'},'bad')).status,401);
  const renamed=await call('/spots/'+spot.id,'PUT',{name:'  Malostranské schody  '});
  assert.deepEqual(renamed,{status:200,data:{id:spot.id,name:'Malostranské schody'}});
  const storedSpot=sqlite.prepare('SELECT * FROM earnings_spots WHERE id=?').get(spot.id);
  assert.equal(storedSpot.created_at,originalSpot.created_at);
  assert.equal(storedSpot.name_key,'malostranské schody');
  const history=(await call('/entries?from=2026-09-01&to=2026-09-30&spot='+spot.id)).data.entries;
  assert.deepEqual(history,[edited.data]); // A rename must not rewrite money, rates or entry versions.
  assert.equal((await call('/spots/'+spot.id,'PUT',{name:'Malostranské Schody'})).status,200);
  assert.equal((await call('/spots/'+spot.id,'PUT',{name:'ande\u030cl'})).status,409);
  for(const name of ['', 'a'.repeat(81), 'Bad\nName'])assert.equal((await call('/spots/'+spot.id,'PUT',{name})).status,400);
  assert.equal((await call('/spots/missing-spot','PUT',{name:'Missing'})).status,404);
  assert.equal((await call('/spots')).data.spots.find(item=>item.id===spot.id).name,'Malostranské Schody');
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM earnings_spots').get().count,2);
  authDown=true;assert.equal((await call('/spots')).status,503);authDown=false;
  assert.equal((await call('/entries/record-1','DELETE',{version:1})).status,409);
  assert.equal((await call('/entries/record-1','DELETE',{version:2})).status,200);
  assert.equal((await call('/entries?from=2026-09-01&to=2026-09-30')).data.entries.length,0);
 }finally{globalThis.fetch=original;sqlite.close();}
});
