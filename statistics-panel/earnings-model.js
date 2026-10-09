export const DEFAULT_CURRENCIES = ['CZK', 'EUR', 'USD'];
export function dateValid(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
}
export function today() {
  return new Intl.DateTimeFormat('en-CA', {timeZone:'Europe/Prague',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
}
export function plusDays(date, days) { return new Date(Date.parse(date)+days*86400000).toISOString().slice(0,10); }
function localParts(timestamp) {
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Prague',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(timestamp).map(p=>[p.type,p.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
export function pragueInstant(date,time) {
  if(!dateValid(date)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Проверь дату и время.');
  const nominal=Date.parse(`${date}T${time}:00Z`);
  const candidates=[1,2].map(offset=>nominal-offset*3600000).filter(t=>localParts(t)===`${date}T${time}`);
  if(candidates.length!==1) throw new Error('Это время неоднозначно или отсутствует из-за перевода часов. Выбери время вне перехода.');
  return candidates[0];
}
export function duration(date,start,end,nextDay=false) {
  const a=pragueInstant(date,start),b=pragueInstant(nextDay?plusDays(date,1):date,end);
  const minutes=(b-a)/60000;
  if(minutes<=0||minutes>1440) throw new Error('Окончание должно быть позже начала; выступление — не длиннее 24 часов.');
  return {minutes,startAt:new Date(a).toISOString(),endAt:new Date(b).toISOString()};
}
export function parseAmount(value) {
  const normalized=String(value??'').trim().replace(',','.');
  if(!/^\d{1,7}(\.\d{1,2})?$/.test(normalized)) throw new Error('Сумма должна быть от 0 до 9 999 999,99, не более двух знаков после запятой.');
  return Math.round(Number(normalized)*100);
}
export function validateEntry(input, now=Date.now()) {
  if(!input||typeof input!=='object'||!dateValid(input.date)||input.date<'2000-01-01'||typeof input.nextDay!=='boolean') throw new Error('Некорректная дата выступления.');
  if(typeof input.spotId!=='string'||!/^[\w-]{1,64}$/.test(input.spotId)) throw new Error('Выбери точку выступления.');
  const time=duration(input.date,input.start,input.end,input.nextDay);
  if(Date.parse(time.endAt)>now+60000) throw new Error('Нельзя сохранить ещё не закончившееся выступление.');
  if(!Array.isArray(input.amounts)||input.amounts.length<3||input.amounts.length>30) throw new Error('Проверь список валют.');
  const seen=new Set();
  const amounts=input.amounts.map(row=>{
    if(!row||!/^[A-Z]{3}$/.test(row.currency)||seen.has(row.currency)) throw new Error('Валюты не должны повторяться.');
    seen.add(row.currency);return {currency:row.currency,minor:parseAmount(row.amount)};
  });
  if(!DEFAULT_CURRENCIES.every(c=>seen.has(c))) throw new Error('Заполни CZK, EUR и USD; можно указать 0.');
  return {date:input.date,start:input.start,end:input.end,nextDay:input.nextDay,spotId:input.spotId,amounts,...time};
}
export function convert(amounts,snapshot) {
  let czk=0;
  for(const row of amounts) {
    if(row.minor===0) continue;
    const rate=snapshot.rates[row.currency];
    if(!Number.isFinite(rate)||rate<=0) throw new Error(`Нет курса ${row.currency} на эту дату.`);
    czk+=row.minor*rate;
  }
  if(!(snapshot.rates.EUR>0)) throw new Error('Нет курса евро.');
  return {czkMinor:Math.round(czk),eurMinor:Math.round(czk/snapshot.rates.EUR)};
}
export function summary(entries) {
  const result=entries.reduce((s,e)=>({czkMinor:s.czkMinor+e.czkMinor,eurMinor:s.eurMinor+e.eurMinor,minutes:s.minutes+e.minutes,count:s.count+1}),{czkMinor:0,eurMinor:0,minutes:0,count:0});
  return {...result,hourCzk:result.minutes?result.czkMinor/100*60/result.minutes:0,hourEur:result.minutes?result.eurMinor/100*60/result.minutes:0};
}
