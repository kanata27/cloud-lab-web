import {body,fail} from './http.js';
import {dateValid,today,validateEntry,validateNote,convert} from '../statistics-panel/earnings-model.js';
const PREFIX='/earnings-api';
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'",'Vary':'Authorization'}});
function spotName(data){
  const name=typeof data.name==='string'?data.name.trim().normalize('NFC'):'';
  if(!name||name.length>80||/[\u0000-\u001f]/.test(name))fail('Название точки: от 1 до 80 символов.');
  return name;
}
export async function ratesFor(date,db,fetcher=fetch) {
  if(!dateValid(date)||date<'2000-01-01'||date>today()) fail('Выбери дату не позже сегодняшней.');
  const cached=await db.prepare('SELECT payload,fetched_at FROM earnings_rates WHERE date=?').bind(date).first();
  if(cached&&(date<today()||Date.now()-Date.parse(cached.fetched_at)<3600000)) return JSON.parse(cached.payload);
  let response;
  try{response=await fetcher(`https://api.frankfurter.dev/v2/providers/ecb/rates?base=EUR&date=${date}`,{signal:AbortSignal.timeout(12000)});}catch{fail('Не удалось получить курсы валют. Попробуй ещё раз.',503);}
  if(!response.ok) fail('Курсы на эту дату недоступны. Запись не сохранена.',503);
  let rows;try{rows=await response.json();}catch{fail('Некорректный ответ сервиса курсов.',503);}
  if(!Array.isArray(rows)) fail('Некорректный ответ сервиса курсов.',503);
  const czk=rows.find(r=>r.quote==='CZK'&&r.base==='EUR');
  if(!czk||!Number.isFinite(czk.rate)||czk.rate<=0||!dateValid(czk.date)||czk.date>date) fail('Нет курса кроны на эту дату.',503);
  const snapshot={requestedDate:date,source:'Frankfurter / ECB',rates:{CZK:1,EUR:czk.rate},dates:{CZK:czk.date,EUR:czk.date}};
  for(const row of rows) if(row.base==='EUR'&&/^[A-Z]{3}$/.test(row.quote)&&Number.isFinite(row.rate)&&row.rate>0&&dateValid(row.date)&&row.date<=date){snapshot.rates[row.quote]=czk.rate/row.rate;snapshot.dates[row.quote]=row.date;}
  snapshot.rates.CZK=1;
  await db.prepare('INSERT INTO earnings_rates(date,payload,fetched_at) VALUES(?,?,?) ON CONFLICT(date) DO UPDATE SET payload=excluded.payload,fetched_at=excluded.fetched_at').bind(date,JSON.stringify(snapshot),new Date().toISOString()).run();
  return snapshot;
}
function entryOf(row){return {note:'',...JSON.parse(row.payload),id:row.id,version:row.version,createdAt:row.created_at,updatedAt:row.updated_at};}
const ENTRY_PAGE_SIZE=1000;
function entryCursor(row,range){
  return btoa(JSON.stringify({...range,date:row.date,createdAt:row.created_at,id:row.id})).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
}
function readEntryCursor(value,range){
  if(value===null)return null;
  let cursor;
  try{
    if(!/^[\w-]{1,2048}$/.test(value))throw new Error();
    cursor=JSON.parse(atob(value.replaceAll('-','+').replaceAll('_','/')));
    if(!cursor||cursor.from!==range.from||cursor.to!==range.to||cursor.spot!==range.spot
      ||!dateValid(cursor.date)||cursor.date<range.from||cursor.date>range.to
      ||typeof cursor.createdAt!=='string'||cursor.createdAt.length>64||!Number.isFinite(Date.parse(cursor.createdAt))
      ||typeof cursor.id!=='string'||!/^[\w-]{1,64}$/.test(cursor.id))throw new Error();
  }catch{fail('Список выступлений изменился. Обнови отчёт.');}
  return cursor;
}
export default {async fetch(request,env) {
  const url=new URL(request.url);
  if(!url.pathname.startsWith(PREFIX+'/')) return env.ASSETS.fetch(request);
  try{
    if(!['GET','POST','PUT','DELETE'].includes(request.method)) fail('Метод не поддерживается.',405);
    const origin=request.headers.get('Origin');
    if(origin&&origin!==url.origin) fail('Запрос с другого сайта запрещён.',403);
    if(Number(request.headers.get('Content-Length')||0)>16000) fail('Слишком большая запись.',413);
    if(!env.EARNINGS_DB) fail('Хранилище заработков ещё не подключено.',503);
    const db=env.EARNINGS_DB,path=url.pathname.slice(PREFIX.length);
    if(path==='/rates'&&request.method==='GET') return json(await ratesFor(url.searchParams.get('date'),db));
    if(path==='/calendar'&&request.method==='GET'){
      const year=url.searchParams.get('year');
      if(!/^\d{4}$/.test(year||'')||Number(year)<2000||Number(year)>Number(today().slice(0,4))) fail('Выбери год от 2000 до текущего.');
      // Aggregate in D1: a full year needs no private notes or 2000-entry limit.
      const {results}=await db.prepare(`SELECT e.date,
        SUM(json_extract(e.payload,'$.czkMinor')) AS czkMinor,
        SUM(json_extract(e.payload,'$.eurMinor')) AS eurMinor,
        SUM(json_extract(e.payload,'$.minutes')) AS minutes,COUNT(*) AS count,
        json_group_array(DISTINCT s.name) AS spots
        FROM earnings_entries e LEFT JOIN earnings_spots s ON s.id=e.spot_id
        WHERE e.date BETWEEN ? AND ? GROUP BY e.date ORDER BY e.date`)
        .bind(year+'-01-01',year+'-12-31').all();
      return json({year:Number(year),days:results.map(row=>({...row,
        spots:JSON.parse(row.spots).map(name=>name||'Без точки').sort((a,b)=>a.localeCompare(b,'ru'))}))});
    }
    if(path==='/spots'&&request.method==='GET') return json({spots:(await db.prepare('SELECT id,name FROM earnings_spots ORDER BY name').all()).results});
    if(path==='/spots'&&request.method==='POST'){
      const name=spotName(await body(request));
      const id=crypto.randomUUID(),key=name.toLocaleLowerCase('ru-RU');
      await db.prepare('INSERT OR IGNORE INTO earnings_spots(id,name,name_key,created_at) VALUES(?,?,?,?)').bind(id,name,key,new Date().toISOString()).run();
      return json(await db.prepare('SELECT id,name FROM earnings_spots WHERE name_key=?').bind(key).first(),201);
    }
    const spotMatch=path.match(/^\/spots\/([\w-]{1,64})$/);
    if(spotMatch&&request.method==='PUT'){
      const id=spotMatch[1],name=spotName(await body(request)),key=name.toLocaleLowerCase('ru-RU');
      // Update the existing ID so every past entry keeps its spot association.
      // One atomic statement also prevents competing renames taking the same name.
      const result=await db.prepare('UPDATE earnings_spots SET name=?,name_key=? WHERE id=? AND NOT EXISTS (SELECT 1 FROM earnings_spots WHERE name_key=? AND id<>?)').bind(name,key,id,key,id).run();
      const spot=await db.prepare('SELECT id,name FROM earnings_spots WHERE id=?').bind(id).first();
      if(!spot) fail('Точка не найдена. Обнови страницу.',404);
      if(result.meta.changes!==1) fail('Точка с таким названием уже существует.',409);
      return json(spot);
    }
    if(path==='/entries'&&request.method==='GET'){
      const from=url.searchParams.get('from'),to=url.searchParams.get('to'),spot=url.searchParams.get('spot')||'';
      if(!dateValid(from)||!dateValid(to)||from>to)fail('Выбери корректный период.');
      if(spot&&!/^[\w-]{1,64}$/.test(spot))fail('Некорректная точка.');
      const range={from,to,spot},cursor=readEntryCursor(url.searchParams.get('cursor'),range);
      const conditions=['date BETWEEN ? AND ?'],args=[from,to];
      if(spot){conditions.push('spot_id=?');args.push(spot);}
      if(cursor){
        conditions.push('(date < ? OR (date=? AND created_at<?) OR (date=? AND created_at=? AND id<?))');
        args.push(cursor.date,cursor.date,cursor.createdAt,cursor.date,cursor.createdAt,cursor.id);
      }
      const {results}=await db.prepare(`SELECT * FROM earnings_entries WHERE ${conditions.join(' AND ')} ORDER BY date DESC,created_at DESC,id DESC LIMIT ?`)
        .bind(...args,ENTRY_PAGE_SIZE+1).all();
      const rows=results.slice(0,ENTRY_PAGE_SIZE);
      return json({entries:rows.map(entryOf),nextCursor:results.length>ENTRY_PAGE_SIZE?entryCursor(rows.at(-1),range):null});
    }
    const noteMatch=path.match(/^\/entries\/([\w-]{1,64})\/note$/);
    if(noteMatch&&request.method==='PUT'){
      const input=await body(request),id=noteMatch[1];
      const previous=await db.prepare('SELECT * FROM earnings_entries WHERE id=?').bind(id).first();
      if(!previous) fail('Выступление не найдено. Обнови страницу.',404);
      if(!Number.isInteger(input.version)||input.version!==previous.version) fail('Выступление изменено в другой вкладке. Обнови страницу перед сохранением заметки.',409);
      let note;try{note=validateNote(input.note);}catch(error){fail(error.message);}
      // Keep money, rates and timing exactly as stored; notes need no FX lookup.
      const payload=JSON.stringify({...JSON.parse(previous.payload),note});
      const result=await db.prepare('UPDATE earnings_entries SET payload=?,version=version+1,updated_at=? WHERE id=? AND version=?').bind(payload,new Date().toISOString(),id,input.version).run();
      if(result.meta.changes!==1) fail('Выступление уже изменено. Обнови страницу перед сохранением заметки.',409);
      return json(entryOf(await db.prepare('SELECT * FROM earnings_entries WHERE id=?').bind(id).first()));
    }
    const match=path.match(/^\/entries\/([\w-]{1,64})$/);
    if((path==='/entries'&&request.method==='POST')||(match&&request.method==='PUT')){
      const input=await body(request),id=match?match[1]:input.id;
      if(typeof id!=='string'||!/^[\w-]{1,64}$/.test(id)) fail('Некорректный идентификатор.');
      const previous=await db.prepare('SELECT * FROM earnings_entries WHERE id=?').bind(id).first();
      if(match&&!previous) fail('Запись не найдена.',404);
      if(match&&(!Number.isInteger(input.version)||input.version!==previous.version)) fail('Запись изменена в другой вкладке. Обнови страницу.',409);
      let record;try{record=validateEntry({...input,note:input.note===undefined&&previous?entryOf(previous).note:input.note});}catch(error){fail(error.message);}
      const spot=await db.prepare('SELECT id FROM earnings_spots WHERE id=?').bind(record.spotId).first();
      if(!spot) fail('Эта точка не найдена.');
      const old=previous?entryOf(previous):null;
      const snapshot=old&&old.date===record.date?old.snapshot:await ratesFor(record.date,db);
      let totals;try{totals=convert(record.amounts,snapshot);}catch(error){fail(error.message);}
      const payload=JSON.stringify({...record,...totals,snapshot});
      if(!match&&previous){if(previous.payload===payload)return json(entryOf(previous));fail('Запись с этим идентификатором уже существует. Обнови страницу.',409);}
      const timestamp=new Date().toISOString();
      if(match){
        const result=await db.prepare('UPDATE earnings_entries SET date=?,spot_id=?,payload=?,version=version+1,updated_at=? WHERE id=? AND version=?').bind(record.date,record.spotId,payload,timestamp,id,input.version).run();
        if(result.meta.changes!==1) fail('Запись уже изменена. Обнови страницу.',409);
      }else{
        await db.prepare('INSERT OR IGNORE INTO earnings_entries(id,date,spot_id,payload,created_at,updated_at) VALUES(?,?,?,?,?,?)').bind(id,record.date,record.spotId,payload,timestamp,timestamp).run();
        const stored=await db.prepare('SELECT * FROM earnings_entries WHERE id=?').bind(id).first();
        if(stored.payload!==payload) fail('Конфликт записи. Обнови страницу.',409);
      }
      return json(entryOf(await db.prepare('SELECT * FROM earnings_entries WHERE id=?').bind(id).first()),match?200:201);
    }
    if(match&&request.method==='DELETE'){
      const input=await body(request);if(!Number.isInteger(input.version))fail('Обнови страницу перед удалением.');
      const result=await db.prepare('DELETE FROM earnings_entries WHERE id=? AND version=?').bind(match[1],input.version).run();
      if(result.meta.changes!==1)fail('Запись уже изменена или удалена. Обнови страницу.',409);
      return json({deleted:true});
    }
    return json({error:'Не найдено.'},404);
  }catch(error){
    if(!error.status) console.error('earnings request failed',error.name); // never log tokens or private payloads
    return json({error:error.status?error.message:'Не удалось выполнить запрос. Проверь подключение базы и повтори.'},error.status||500);
  }
}};
