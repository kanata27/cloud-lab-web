import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {projectRoot,publicFiles} from '../tools/build.mjs';

test('all three panels load the same versioned Golos Text stylesheet last',async()=>{
 for(const page of ['index.html','earnings.html','insights.html']){
  const html=await readFile(join(projectRoot,'statistics-panel',page),'utf8');
  const styles=[...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*>/g)].map(([tag])=>tag);
  assert.match(styles.at(-1),/panel-typography\.css\?v=20261010-2/);
  assert.match(html,/<body class="panel-page">/);
  assert.match(html,/golos-text-cyrillic-wght-normal\.woff2/);
  assert.match(html,/golos-text-latin-wght-normal\.woff2/);
 }
});

test('each self-hosted font and its license are included in the deployment allowlist',async()=>{
 const css=await readFile(join(projectRoot,'statistics-panel/panel-typography.css'),'utf8');
 const fonts=[...css.matchAll(/url\("\.\/fonts\/([^"\)]+)"\)/g)].map(([,file])=>file);
 assert.equal(fonts.length,4);
 assert.match(css,/--panel-font:"Golos Text",/);
 assert.doesNotMatch(css,/@import|url\(["']?https?:/);
 for(const file of fonts){
  const source='statistics-panel/fonts/'+file;
  assert.ok(publicFiles.some(([from,to])=>from===source&&to==='stat-panel/fonts/'+file));
  const bytes=await readFile(join(projectRoot,source));
  assert.equal(bytes.subarray(0,4).toString(),'wOF2');
  assert.equal(bytes.readUInt32BE(8),bytes.length);
 }
 const license='statistics-panel/fonts/OFL-Golos-Text.txt';
 assert.ok(publicFiles.some(([from])=>from===license));
 assert.match(await readFile(join(projectRoot,license),'utf8'),/SIL OPEN FONT LICENSE Version 1\.1/);
});

test('earnings action is attached to the content and the spots panel starts hidden',async()=>{
 const html=await readFile(join(projectRoot,'statistics-panel/earnings.html'),'utf8');
 assert.match(html,/class="shell earnings-shell"/);
 assert.match(html,/<div class="earnings-actions"><button id="add-entry"/);
 assert.match(html,/<section class="panel spots-panel" id="spots-panel" hidden>/);
 const css=await readFile(join(projectRoot,'statistics-panel/earnings.css'),'utf8');
 for(const [,rules] of css.matchAll(/\.add-entry-fab\s*\{([^}]+)\}/g))assert.doesNotMatch(rules,/position:fixed/);
 assert.match(css,/left:calc\(100% \+ 20px\)/);
});
