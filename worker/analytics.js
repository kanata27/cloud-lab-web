import {body, fail, json, requireSameOrigin} from './http.js';

const DAY = 86400000;
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const dateValid = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '')
  && Number.isFinite(Date.parse(value + 'T00:00:00Z'))
  && new Date(value + 'T00:00:00Z').toISOString().slice(0,10) === value;

export async function acceptEvent(request, env) {
  if (request.method !== 'POST') fail('Метод не поддерживается.', 405);
  requireSameOrigin(request);
  if (!env.EVENTS_RATE_LIMITER) fail('Сбор статистики ещё не настроен.', 503);
  const key = request.headers.get('CF-Connecting-IP') || 'unknown';
  const {success} = await env.EVENTS_RATE_LIMITER.limit({key});
  if (!success) return new Response(JSON.stringify({error:'Слишком много событий.'}), {
    status:429,headers:{'Content-Type':'application/json','Cache-Control':'no-store','Retry-After':'60'},
  });
  const input = await body(request, 2048);
  if (typeof input.session_id !== 'string' || !uuid.test(input.session_id)) fail('Некорректный идентификатор сессии.');
  if (!['page_view','social_click'].includes(input.event)) fail('Неподдерживаемое событие.');
  const source = input.source ?? 'direct';
  if (!['qr','direct'].includes(source)) fail('Некорректный источник.');
  if (input.event === 'social_click' && !['youtube','instagram'].includes(input.platform)) fail('Некорректная платформа.');
  if (input.event_id !== undefined && (typeof input.event_id !== 'string' || !uuid.test(input.event_id))) fail('Некорректный идентификатор события.');
  // Older cached frontend versions omit event_id; no retries were used there.
  const id = input.event_id ?? crypto.randomUUID();
  await env.EARNINGS_DB.prepare(`INSERT INTO analytics_events(event_id,session_id,event,source,platform,received_at)
    VALUES(?,?,?,?,?,?) ON CONFLICT(event_id) DO NOTHING`)
    .bind(id,input.session_id,input.event,source,input.event === 'social_click' ? input.platform : null,new Date().toISOString()).run();
  return json({ok:true,session_id:input.session_id,event:input.event});
}

export async function readStats(request, db) {
  if (request.method !== 'GET') fail('Метод не поддерживается.',405);
  const qs = new URL(request.url).searchParams;
  const from = qs.get('from'), to = qs.get('to'), source = qs.get('source') || 'all';
  if (!dateValid(from) || !dateValid(to) || from > to) fail('Выбери корректный период.');
  const days = (Date.parse(to)-Date.parse(from))/DAY+1;
  if (days > 90) fail('Максимальный период — 90 дней.');
  if (!['all','qr','direct'].includes(source)) fail('Некорректный источник.');
  if (qs.has('time_zone') && qs.get('time_zone') !== 'UTC') fail('Отчёт использует UTC.');
  const end = new Date(Date.parse(to)+DAY).toISOString();
  const query = `WITH selected AS (
   SELECT substr(started_at,1,10) AS date, COALESCE(source,'direct') AS source,
    page_views+base_page_views AS views, youtube_clicks+base_youtube_clicks AS yt,
    instagram_clicks+base_instagram_clicks AS ig, MAX(social_clicked,base_social_clicked) AS clicked
   FROM analytics_sessions WHERE started_at>=? AND started_at<?${source==='all'?'':' AND source=?'}
  ) SELECT date,source,COUNT(*) AS sessions,SUM(views) AS page_views,SUM(yt) AS youtube,SUM(ig) AS instagram,
   SUM(clicked) AS converted_sessions,
   SUM(clicked=1 AND ig>0 AND yt=0) AS instagram_only,
   SUM(clicked=1 AND yt>0 AND ig=0) AS youtube_only,
   SUM(clicked=1 AND yt>0 AND ig>0) AS both
  FROM selected GROUP BY date,source ORDER BY date`;
  const args = [from+'T00:00:00.000Z',end];
  if (source !== 'all') args.push(source);
  const {results} = await db.prepare(query).bind(...args).all();
  const totals = {page_views:0,sessions:0,outbound_clicks:0,converted_sessions:0,youtube:0,instagram:0};
  const sources = {qr:0,direct:0}, destinations = {instagram_only:0,youtube_only:0,both:0};
  const daily = Array.from({length:days},(_,i)=>({date:new Date(Date.parse(from)+i*DAY).toISOString().slice(0,10),
    page_views:0,sessions:0,outbound_clicks:0,youtube:0,instagram:0}));
  const byDay = new Map(daily.map(day=>[day.date,day]));
  for (const row of results) {
    row.outbound_clicks = row.youtube + row.instagram;
    for (const key of Object.keys(totals)) totals[key] += row[key];
    for (const key of ['page_views','sessions','outbound_clicks','youtube','instagram']) byDay.get(row.date)[key] += row[key];
    sources[row.source] += row.page_views;
    for (const key of Object.keys(destinations)) destinations[key] += row[key];
  }
  return json({version:1,generated_at:new Date().toISOString(),range:{from,to,source,time_zone:'UTC'},totals,daily,sources,destinations});
}

export async function cleanupEvents(db, now = new Date()) {
  // Only the deduplication ledger expires. Session history and earnings never expire.
  const before = new Date(now.getTime()-30*DAY).toISOString();
  await db.prepare(`DELETE FROM analytics_events WHERE event_id IN
    (SELECT event_id FROM analytics_events WHERE received_at<? ORDER BY received_at LIMIT 5000)`).bind(before).run();
}
