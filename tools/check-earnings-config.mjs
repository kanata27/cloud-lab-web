import {readFile} from 'node:fs/promises';
const target=process.argv[2];
if(!['preview','production'].includes(target))throw Error('Choose preview or production.');
const config=JSON.parse(await readFile(new URL(`../wrangler.${target}.jsonc`,import.meta.url)));
const id=config.d1_databases?.find(b=>b.binding==='EARNINGS_DB')?.database_id;
if(!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id||'')||id==='00000000-0000-0000-0000-000000000000')throw Error(`Set the real D1 database_id in wrangler.${target}.jsonc. See EARNINGS-SETUP.md.`);
