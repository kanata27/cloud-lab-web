import config from '../site.config.json' with {type:'json'};
import {dateValid,today,validateEntry,convert} from '../statistics-panel/earnings-model.js';
const PREFIX='/earnings-api';
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'",'Vary':'Authorization'}});
function fail(message,status=400){throw Object.assign(new Error(message),{status});}
async function body(request) {
  if(!request.headers.get('Content-Type')?.startsWith('application/json')) fail('Ожидается JSON.',415);
  const text=await request.text();if(text.length>16000) fail('Слишком большая запись.',413);
  let data;try{data=JSON.parse(text);}catch{fail('Некорректный JSON.');}
  if(!data||typeof data!=='object'||Array.isArray(data))fail('Ожидается объект записи.');
  return data;
}
export async function authorize(request,fetcher=fetch) {
  const token=request.headers.get('Authorization');
  if(!token||!/^Bearer [^\s]{1,4096}$/.test(token)) fail('Войди в панель заново.',401);
  const date=new Date().toISOString().slice(0,10);
  const query=new URLSearchParams({from:date,to:date,source:'all',time_zone:'UTC'});
  let response;
  // Workers supports manual redirects; the response checks below reject every 3xx.
  try{response=await fetcher(`${config.apiBase}/stats?${query}`,{headers:{Authorization:token,Accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(10000)});}catch{fail('Сервис входа временно недоступен. Попробуй ещё раз.',503);}
  if([401,403].includes(response.status)) fail('Сессия истекла. Войди заново.',401);
  if(!response.ok) fail('Не удалось проверить вход. Попробуй ещё раз.',503);
  // The existing protected endpoint is the authority; never trust a decoded JWT alone.
  let report;try{report=await response.json();}catch{fail('Сервис входа вернул некорректный ответ.',503);}
  if(report?.version!==1||!report.totals||!Array.isArray(report.daily)) fail('Не удалось подтвердить доступ к панели.',503);
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
function entryOf(row){return {...JSON.parse(row.payload),id:row.id,version:row.version,createdAt:row.created_at,updatedAt:row.updated_at};}
export default {async fetch(request,env) {
  const url=new URL(request.url);
  if(!url.pathname.startsWith(PREFIX+'/')) return env.ASSETS.fetch(request);
  try{
    if(!['GET','POST','PUT','DELETE'].includes(request.method)) fail('Метод не поддерживается.',405);
    const origin=request.headers.get('Origin');
    if(origin&&origin!==url.origin) fail('Запрос с другого сайта запрещён.',403);
    if(Number(request.headers.get('Content-Length')||0)>16000) fail('Слишком большая запись.',413);
    await authorize(request);
    if(!env.EARNINGS_DB) fail('Хранилище заработков ещё не подключено.',503);
    const db=env.EARNINGS_DB,path=url.pathname.slice(PREFIX.length);
    if(path==='/rates'&&request.method==='GET') return json(await ratesFor(url.searchParams.get('date'),db));
    if(path==='/spots'&&request.method==='GET') return json({spots:(await db.prepare('SELECT id,name FROM earnings_spots ORDER BY name').all()).results});
    if(path==='/spots'&&request.method==='POST'){
      const data=await body(request),name=typeof data.name==='string'?data.name.trim().normalize('NFC'):'';
      if(!name||name.length>80||/[\u0000-\u001f]/.test(name)) fail('Название точки: от 1 до 80 символов.');
      const id=crypto.randomUUID(),key=name.toLocaleLowerCase('ru-RU');
      await db.prepare('INSERT OR IGNORE INTO earnings_spots(id,name,name_key,created_at) VALUES(?,?,?,?)').bind(id,name,key,new Date().toISOString()).run();
      return json(await db.prepare('SELECT id,name FROM earnings_spots WHERE name_key=?').bind(key).first(),201);
    }
    if(path==='/entries'&&request.method==='GET'){
      const from=url.searchParams.get('from'),to=url.searchParams.get('to'),spot=url.searchParams.get('spot')||'';
      if(!dateValid(from)||!dateValid(to)||from>to||(Date.parse(to)-Date.parse(from))/86400000>366) fail('Выбери период не длиннее года.');
      const rows=await db.prepare('SELECT * FROM earnings_entries WHERE date BETWEEN ? AND ? AND (? = \'\' OR spot_id=?) ORDER BY date DESC,created_at DESC LIMIT 2001').bind(from,to,spot,spot).all();
      if(rows.results.length>2000) fail('Слишком много записей. Сократи период.');
      return json({entries:rows.results.map(entryOf)});
    }
    const match=path.match(/^\/entries\/([\w-]{1,64})$/);
    if((path==='/entries'&&request.method==='POST')||(match&&request.method==='PUT')){
      const input=await body(request),id=match?match[1]:input.id;
      if(typeof id!=='string'||!/^[\w-]{1,64}$/.test(id)) fail('Некорректный идентификатор.');
      const previous=await db.prepare('SELECT * FROM earnings_entries WHERE id=?').bind(id).first();
      if(match&&!previous) fail('Запись не найдена.',404);
      if(match&&(!Number.isInteger(input.version)||input.version!==previous.version)) fail('Запись изменена в другой вкладке. Обнови страницу.',409);
      let record;try{record=validateEntry(input);}catch(error){fail(error.message);}
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
