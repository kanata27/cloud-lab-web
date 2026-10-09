import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {mkdtemp,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';

test('earnings authentication runs in the Cloudflare runtime and fails closed',async()=>{
 const require=createRequire(import.meta.url);
 const binary=require('workerd').default;
 const {build}=require('esbuild');
 const support=fileURLToPath(new URL('./support/',import.meta.url));
 const directory=await mkdtemp(join(tmpdir(),'kanata-earnings-runtime-'));
 try{
  // Bundle JSON imports just as Wrangler does for deployment.
  await build({entryPoints:[join(support,'earnings-runtime.mjs')],bundle:true,
   format:'esm',platform:'browser',target:'es2022',outfile:join(directory,'earnings-runtime.mjs')});
  await copyFile(join(support,'earnings-runtime.capnp'),join(directory,'earnings-runtime.capnp'));
  await copyFile(join(support,'earnings-auth-upstream.mjs'),join(directory,'earnings-auth-upstream.mjs'));
  const schemaDirectory=dirname(require.resolve('workerd/workerd.capnp'));
  const result=spawnSync(binary,['test','--import-path='+schemaDirectory,
   join(directory,'earnings-runtime.capnp'),'earnings-auth:*'],{encoding:'utf8',timeout:30000});
  assert.equal(result.status,0,result.error?.message||result.stdout+result.stderr);
 }finally{await rm(directory,{recursive:true,force:true});}
});
