import {test,expect} from '@playwright/test';
import {validateEntry,convert} from '../../statistics-panel/earnings-model.js';
test('earnings: create spot and mixed-currency entry, edit, filter, mobile and delete',async({page})=>{
 await page.clock.setFixedTime(new Date('2026-09-13T20:00:00Z'));
 await page.addInitScript(()=>{sessionStorage.setItem('kanata_admin_token','test');window.violations=[];document.addEventListener('securitypolicyviolation',e=>window.violations.push(e.violatedDirective));});
 let entries=[],spots=[];const snapshot={requestedDate:'2026-09-13',rates:{CZK:1,EUR:25,USD:20,PLN:6,HUF:.06}};
 await page.route('**/earnings-api/**',async route=>{
  const req=route.request(),url=new URL(req.url()),data=req.postDataJSON();let result;
  if(url.pathname.endsWith('/rates'))result={...snapshot,requestedDate:url.searchParams.get('date')};
  // Exercise the asynchronous dialog close instead of relying on an instant response.
  else if(url.pathname.endsWith('/spots')){if(req.method()==='POST'){await new Promise(resolve=>setTimeout(resolve,150));result={id:'spot-a',name:data.name};spots.push(result);}else result={spots};}
  else if(req.method()==='GET')result={entries:entries.filter(e=>e.date>=url.searchParams.get('from')&&e.date<=url.searchParams.get('to'))};
  else if(req.method()==='DELETE'){entries=[];result={deleted:true};}
  else{const model=validateEntry(data);result={...model,...convert(model.amounts,snapshot),snapshot:{...snapshot,requestedDate:data.date},id:data.id,version:(data.version||0)+1};entries=[result];}
  await route.fulfill({json:result});
 });
 await page.goto('/stat-panel/earnings');await expect(page.locator('#empty')).toBeVisible();
 await page.locator('#add-entry').click();await page.locator('#entry-start').fill('14:20');await page.locator('#entry-end').fill('17:12');
 await page.locator('#new-spot').click();await page.locator('#spot-name').fill('Набережная');await page.locator('#save-spot').click();
 await expect(page.locator('#spot-dialog')).not.toBeVisible();
 await expect(page.locator('#entry-spot')).toHaveValue('spot-a');
 await page.getByRole('textbox',{name:'Сумма CZK',exact:true}).fill('220');await page.getByRole('textbox',{name:'Сумма EUR',exact:true}).fill('2,2');await page.getByRole('textbox',{name:'Сумма USD',exact:true}).fill('2');
 await expect(page.getByRole('textbox',{name:'Сумма CZK',exact:true})).toHaveValue('220');
 await expect(page.getByRole('textbox',{name:'Сумма EUR',exact:true})).toHaveValue('2,2');
 await expect(page.getByRole('textbox',{name:'Сумма USD',exact:true})).toHaveValue('2');
 await expect(page.locator('#estimate-total')).toContainText('315');await expect(page.locator('#estimate-hour')).toContainText('€/ч');
 await page.locator('#save-entry').click();await expect(page.locator('#entries-body tr')).toHaveCount(1);await expect(page.locator('#total-czk')).toHaveText('315 Kč');await expect(page.locator('#hour-eur')).toContainText('€/ч');
 await expect(page.locator('#entries-body select')).toHaveCount(0);await page.locator('.entry-actions summary').click();await page.getByRole('button',{name:'Изменить данные'}).click();
 await page.locator('#entry-end').fill('18:20');await page.locator('#save-entry').click();await expect(page.locator('#hour-czk')).toHaveText('78,8 Kč');
 await page.locator('#from').fill('2026-09-01');await page.locator('#to').fill('2026-09-02');await page.locator('#show').click();await expect(page.locator('#empty')).toBeVisible();
 await page.getByRole('button',{name:'Месяц',exact:true}).click();await expect(page.locator('#entries-body tr')).toHaveCount(1);
 for(const width of [320,390,1440]){
  await page.setViewportSize({width,height:844});
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }
 await page.setViewportSize({width:390,height:844});
 await page.locator('.entry-actions summary').click();await page.getByRole('button',{name:'Удалить запись',exact:true}).click();await page.locator('#confirm-delete').click();await expect(page.locator('#empty')).toBeVisible();
 expect(await page.evaluate(()=>window.violations)).toEqual([]);
});
test('earnings requires a session',async({page})=>{await page.goto('/stat-panel/earnings');await expect(page).toHaveURL(/login/);});
