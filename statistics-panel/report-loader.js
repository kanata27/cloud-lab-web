import {dateValid,plusDays as addDays} from './earnings-model.js';
import {splitRanges} from './insights-model.js';
const DAY=86400000;

export async function loadTrafficReport(selection, read, signal) {
  const ranges=splitRanges(selection.from,selection.to),reports=new Array(ranges.length);
  const batch=new AbortController(),combined=signal?AbortSignal.any([signal,batch.signal]):batch.signal;
  let next=0;
  try{
    await Promise.all(Array.from({length:Math.min(3,ranges.length)},async()=>{
      for(;;){
        combined.throwIfAborted();
        const index=next++;if(index>=ranges.length)return;
        const range={...ranges[index],source:selection.source};
        reports[index]=assertReport(await read(range,combined),range,'UTC');
      }
    }));
  }catch(error){batch.abort();throw error;}
  const result={version:1,range:{...selection,time_zone:'UTC'},generated_at:reports[0].generated_at,
    totals:{page_views:0,sessions:0,outbound_clicks:0,converted_sessions:0,youtube:0,instagram:0},
    sources:{qr:0,direct:0},destinations:{instagram_only:0,youtube_only:0,both:0},daily:[]};
  for(const report of reports){
    for(const group of ['totals','sources','destinations'])for(const key of Object.keys(result[group]))result[group][key]+=report[group][key];
    result.daily.push(...report.daily);
    if(Date.parse(report.generated_at)>Date.parse(result.generated_at))result.generated_at=report.generated_at;
  }
  return assertReport(result,selection,'UTC');
}

export async function loadEarningsEntries(selection, read, signal) {
  const entries=[],ids=new Set(),cursors=new Set();let cursor;
  for(;;){
    signal?.throwIfAborted();
    const page=await read({...selection,...(cursor?{cursor}:{})},signal);
    if(!Array.isArray(page?.entries))throw new Error('Не удалось прочитать выступления.');
    for(const entry of page.entries){
      if(typeof entry?.id!=='string'||!entry.id||ids.has(entry.id)||!dateValid(entry.date)||entry.date<selection.from||entry.date>selection.to)throw new Error('Список выступлений изменился. Обнови отчёт.');
      ids.add(entry.id);entries.push(entry);
    }
    if(page.nextCursor===null||page.nextCursor===undefined)return {entries};
    if(typeof page.nextCursor!=='string'||!page.nextCursor||page.nextCursor.length>2048||!page.entries.length||cursors.has(page.nextCursor))throw new Error('Не удалось загрузить полный список выступлений.');
    cursor=page.nextCursor;cursors.add(cursor);
  }
}

export function assertReport(data, selection, timeZone) {
  const count = value => Number.isSafeInteger(value) && value >= 0;
  const totals = data?.totals;
  const expectedDays = (Date.parse(selection.to) - Date.parse(selection.from)) / DAY + 1;
  if (data?.version !== 1 || data?.range?.from !== selection.from
      || data?.range?.to !== selection.to || data?.range?.source !== selection.source
      || data?.range?.time_zone !== timeZone || !totals
      || !Number.isFinite(Date.parse(data.generated_at))
      || !Array.isArray(data.daily) || data.daily.length !== expectedDays) {
    throw new Error("API вернул отчёт в неожиданном формате.");
  }
  const fields = ["page_views", "sessions", "outbound_clicks", "converted_sessions", "youtube", "instagram"];
  if (!fields.every(key => count(totals[key]))
      || totals.converted_sessions > totals.sessions
      || totals.outbound_clicks !== totals.youtube + totals.instagram
      || !data.sources || !["qr", "direct"].every(key => count(data.sources[key]))) {
    throw new Error("В отчёте обнаружены некорректные показатели.");
  }
  for (const [index, day] of data.daily.entries()) {
    if (day.date !== addDays(selection.from, index)
        || !["page_views", "sessions", "outbound_clicks", "youtube", "instagram"].every(key => count(day[key]))
        || day.outbound_clicks !== day.youtube + day.instagram) {
      throw new Error("В ежедневной статистике обнаружена ошибка.");
    }
  }
  for (const key of ["page_views", "outbound_clicks", "youtube", "instagram"]) {
    if (data.daily.reduce((sum, day) => sum + day[key], 0) !== totals[key]) {
      throw new Error("Суммы за период и по дням не совпадают.");
    }
  }
  if (data.sources.qr + data.sources.direct !== totals.page_views) {
    throw new Error("Распределение источников не совпадает с числом просмотров.");
  }
  if (!data.destinations || !["instagram_only", "youtube_only", "both"].every(key => count(data.destinations[key]))
      || Object.values(data.destinations).reduce((sum, value) => sum + value, 0) !== totals.converted_sessions) {
    throw new Error("В распределении переходов обнаружена ошибка.");
  }
  return data;
}
