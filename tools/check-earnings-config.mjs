import {readFile} from 'node:fs/promises';
const target=process.argv[2];
if(!['preview','production'].includes(target))throw Error('Choose preview or production.');
const config=JSON.parse(await readFile(new URL(`../wrangler.${target}.jsonc`,import.meta.url)));
const id=config.d1_databases?.find(b=>b.binding==='EARNINGS_DB')?.database_id;
if(!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id||'')||id==='00000000-0000-0000-0000-000000000000')throw Error(`Set the real D1 database_id in wrangler.${target}.jsonc. See EARNINGS-SETUP.md.`);
const vars=config.vars||{};
if(!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(vars.ACCESS_TEAM_DOMAIN||'')||vars.ACCESS_TEAM_DOMAIN.includes('replace-me'))throw Error('Set ACCESS_TEAM_DOMAIN in the selected Wrangler config. See MIGRATION-START.md.');
if(!/^[a-f0-9]{64}$/i.test(vars.ACCESS_AUD||'')||/^0+$/.test(vars.ACCESS_AUD))throw Error('Set the application ACCESS_AUD for this environment.');
const expected=target==='production'?'kanata27.com':'preview.kanata27.com';
if(vars.CANONICAL_HOST!==expected||config.workers_dev!==false||config.preview_urls!==false)throw Error('Unexpected host or unprotected alternate Worker URL.');
if(process.env.CLOUDFLARE_API_TOKEN&&process.env.CLOUDFLARE_ACCOUNT_ID){
 const url=`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(process.env.CLOUDFLARE_ACCOUNT_ID)}/workers/scripts/${encodeURIComponent(config.name)}/secrets`;
 const response=await fetch(url,{headers:{Authorization:'Bearer '+process.env.CLOUDFLARE_API_TOKEN},signal:AbortSignal.timeout(10000),redirect:'error'});
 if(!response.ok)throw Error('Cannot inspect the existing Worker secret names. Check the Cloudflare token permissions.');
 const data=await response.json();
 if(!data.success||!data.result?.some(s=>s.name==='ACCESS_ALLOWED_EMAIL'))throw Error('Add the ACCESS_ALLOWED_EMAIL Worker secret with the single owner email before deployment.');
}
