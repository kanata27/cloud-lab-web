import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

function attribute(item,key,type,fallback) {
  const value=item[key];
  if(value===undefined)return fallback;
  if(!value||typeof value!=='object'||Object.keys(value).length!==1||!(type in value))throw Error(`Invalid DynamoDB attribute: ${key}`);
  return value[type];
}
function timestamp(value) {
  if(value===null||value===undefined||value==='')return null;
  if(typeof value!=='string'||value.length>64||!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value)))throw Error('Invalid session timestamp');
  return new Date(value).toISOString();
}
function counter(value) {
  if(typeof value!=='string'||!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value)))throw Error('Invalid session counter');
  return Number(value);
}
export function parseExport(data) {
  if(!data||!Array.isArray(data.Items)||data.LastEvaluatedKey||data.NextToken
    ||(data.Count!==undefined&&data.Count!==data.Items.length))throw Error('Expected a complete AWS CLI scan export');
  const seen=new Set();
  return data.Items.map(item=>{
    const id=attribute(item,'session_id','S');
    if(typeof id!=='string'||!id||id.length>200||/[\u0000-\u001f]/.test(id)||seen.has(id))throw Error('Invalid or duplicate session ID');
    seen.add(id);
    const src=attribute(item,'source','S','direct');
    const clicked=attribute(item,'social_clicked','BOOL',false);
    if(typeof clicked!=='boolean')throw Error('Invalid social_clicked flag');
    const row={session_id:id,started_at:timestamp(attribute(item,'started_at','S',null)),
      last_seen:timestamp(attribute(item,'last_seen','S',null)),source:['qr','direct'].includes(src)?src:'direct',
      page_views:counter(attribute(item,'page_views','N','0')),
      youtube_clicks:counter(attribute(item,'youtube_clicks','N','0')),
      instagram_clicks:counter(attribute(item,'instagram_clicks','N','0')),social_clicked:Number(clicked)};
    if(clicked&&row.youtube_clicks+row.instagram_clicks===0)throw Error('Converted session has no destination counters');
    return row;
  });
}
const literal=value=>value===null?'NULL':typeof value==='number'?String(value):"'"+String(value).replaceAll("'","''")+"'";

export function importSQL(rows,digest) {
  if(!/^[a-f0-9]{64}$/.test(digest))throw Error('Invalid export digest');
  const commands=rows.map(row=>`INSERT INTO analytics_sessions
 (session_id,started_at,last_seen,source,base_page_views,base_youtube_clicks,base_instagram_clicks,base_social_clicked)
 VALUES(${[row.session_id,row.started_at,row.last_seen,row.started_at?row.source:null,row.page_views,row.youtube_clicks,row.instagram_clicks,row.social_clicked].map(literal).join(',')})
 ON CONFLICT(session_id) DO UPDATE SET
 source=CASE WHEN excluded.started_at IS NOT NULL AND (analytics_sessions.started_at IS NULL OR excluded.started_at<=analytics_sessions.started_at) THEN excluded.source ELSE analytics_sessions.source END,
 started_at=CASE WHEN analytics_sessions.started_at IS NULL THEN excluded.started_at WHEN excluded.started_at IS NULL THEN analytics_sessions.started_at ELSE MIN(analytics_sessions.started_at,excluded.started_at) END,
 last_seen=MAX(COALESCE(analytics_sessions.last_seen,''),COALESCE(excluded.last_seen,'')),
 base_page_views=MAX(analytics_sessions.base_page_views,excluded.base_page_views),
 base_youtube_clicks=MAX(analytics_sessions.base_youtube_clicks,excluded.base_youtube_clicks),
 base_instagram_clicks=MAX(analytics_sessions.base_instagram_clicks,excluded.base_instagram_clicks),
 base_social_clicked=MAX(analytics_sessions.base_social_clicked,excluded.base_social_clicked);`);
  commands.push(`INSERT INTO analytics_imports(digest,session_count,imported_at) VALUES('${digest}',${rows.length},strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(digest) DO NOTHING;`);
  return '-- Private history. Never commit this file or put it in dist.\n'+commands.join('\n')+'\n';
}
export function exportSummary(rows) {
  const valid=rows.filter(row=>row.started_at);
  return {sessions:valid.length,rows:rows.length,page_views:valid.reduce((n,r)=>n+r.page_views,0),
    youtube:valid.reduce((n,r)=>n+r.youtube_clicks,0),instagram:valid.reduce((n,r)=>n+r.instagram_clicks,0),
    converted_sessions:valid.reduce((n,r)=>n+r.social_clicked,0),
    from:valid.length?valid.map(r=>r.started_at.slice(0,10)).sort()[0]:null,
    to:valid.length?valid.map(r=>r.started_at.slice(0,10)).sort().at(-1):null};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [input,output]=process.argv.slice(2);
  if(!input||!output)throw Error('Usage: node tools/import-analytics.mjs EXPORT.json OUTPUT.sql');
  const raw=await readFile(input,'utf8'),rows=parseExport(JSON.parse(raw));
  await mkdir(dirname(resolve(output)),{recursive:true});
  await writeFile(output,importSQL(rows,createHash('sha256').update(raw).digest('hex')),{mode:0o600});
  console.log(JSON.stringify(exportSummary(rows),null,2));
  console.log('Saved private SQL to '+resolve(output));
}
