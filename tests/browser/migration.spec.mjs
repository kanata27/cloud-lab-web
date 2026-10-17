import {randomUUID} from 'node:crypto';
import {test,expect} from '../support/browser.mjs';

test('Cloudflare pipeline: public deduplicated events reach Visits; logout protects pages and both APIs',async({page,context})=>{
 const today=new Date().toISOString().slice(0,10),session_id=randomUUID(),event_id=randomUUID();
 const headers={Origin:'http://127.0.0.1:8787'};
 const event={session_id,event_id,event:'page_view',source:'qr'};
 for(const data of [event,event,{...event,event_id:randomUUID(),event:'social_click',platform:'youtube'}]){
  const response=await context.request.post('/events',{headers,data});expect(response.status()).toBe(200);
 }
 const session=await context.request.get('/api/session');expect(session.status()).toBe(200);
 const response=await context.request.get(`/api/stats?from=${today}&to=${today}&source=qr`);
 expect(response.status()).toBe(200);
 expect((await response.json()).totals).toEqual({sessions:1,page_views:1,outbound_clicks:1,converted_sessions:1,youtube:1,instagram:0});
 await page.goto('/stat-panel/');
 await page.locator('#from').fill(today);await page.locator('#to').fill(today);
 await page.locator('#source').selectOption('qr');
 await page.getByRole('button',{name:'Показать',exact:true}).click();
 await expect(page.locator('#views-value')).toHaveText('1');
 await expect(page.locator('#clicks-value')).toHaveText('1');
 await page.locator('#logout').click();await expect(page).toHaveURL(/\/test\/access\/login/);
 for(const path of ['/api/session','/api/stats?from='+today+'&to='+today,'/earnings-api/spots']){
  const denied=await context.request.get(path,{headers:{'Cf-Access-Authenticated-User-Email':'owner@example.test',Authorization:'Bearer forged'}});
  expect(denied.status()).toBe(401);
 }
 await page.goto('/stat-panel/earnings');await expect(page).toHaveURL(/\/test\/access\/login/);
});
