import {test,expect} from '../support/browser.mjs';

test('the one allowed email reaches the panel through the OTP fixture',async({page,context})=>{
  await context.clearCookies();
  await page.goto('/stat-panel/');
  await expect(page).toHaveURL(/\/test\/access\/login/);
  await expect(page.getByRole('link',{name:'Cloudflare',exact:true})).toHaveCount(0);
  await page.getByRole('link',{name:'Email + код',exact:true}).click();
  await expect(page).toHaveURL(/\/stat-panel\/$/);
  await expect(page.locator('#report')).toBeVisible();
  const session=await context.request.get('/api/session');
  expect(session.status()).toBe(200);expect(await session.json()).toMatchObject({ok:true,email:'owner@example.test'});
});

test('a previously allowed second email is denied and can reset the session to use the one owner email',async({page,context})=>{
 await context.addCookies([{name:'test_access',value:'denied',url:'http://127.0.0.1:8787',httpOnly:true}]);
 await page.addInitScript(()=>{
  window.__cspViolations=[];
  document.addEventListener('securitypolicyviolation',event=>window.__cspViolations.push(event.violatedDirective));
 });
 const response=await page.goto('/stat-panel/earnings.html');
 expect(response.status()).toBe(403);
 await expect(page.getByRole('heading',{name:'Этот email не допущен'})).toBeVisible();
 await expect(page.locator('#app,#report')).toHaveCount(0);
 for(const width of [320,390,1440]){
  await page.setViewportSize({width,height:844});
  await expect(page.getByRole('link',{name:'Сбросить сессию и войти',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:'test-results/access-denied-mobile.png',fullPage:true});
 expect(await page.evaluate(()=>window.__cspViolations)).toEqual([]);
 await page.getByRole('link',{name:'Сбросить сессию и войти',exact:true}).click();
 await expect(page).toHaveURL(/\/test\/access\/login/);
 expect((await context.cookies()).some(cookie=>cookie.name==='test_access')).toBe(false);
 await page.getByRole('link',{name:'Email + код',exact:true}).click();
 await expect(page.locator('#report')).toBeVisible();
 expect(await (await context.request.get('/api/session')).json()).toMatchObject({email:'owner@example.test'});
});

for(const [status,title,reason] of [[401,'Войди заново','expired'],[403,'Этот email не допущен','denied']]){
 test(`a ${status} API response opens a stable recovery screen with a reset action`,async({page})=>{
  await page.goto('/stat-panel/');
  await expect(page.locator('#report')).toBeVisible();
  let calls=0;
  await page.route('**/api/stats?**',route=>{
   calls++;
   return route.fulfill({status,json:{error:'test_access_rejected'}});
  });
  await page.locator('[data-days="1"]').click();
  await expect(page).toHaveURL(new RegExp(`/panel-login/\\?reason=${reason}$`));
  await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible();
  await expect(page.getByRole('link',{name:'Сбросить сессию и войти',exact:true})).toHaveAttribute('href','/cdn-cgi/access/logout');
  await expect(page.locator('#app,#report')).toHaveCount(0);
  expect(calls).toBe(1);
  await page.reload();
  await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible();
  expect(calls).toBe(1,'the recovery page does not automatically retry private requests');
 });
}

test('email-code session recovery works with JavaScript disabled',async({browser})=>{
 const context=await browser.newContext({javaScriptEnabled:false,viewport:{width:390,height:844}});
 try{
  const page=await context.newPage();
  const response=await page.goto('http://127.0.0.1:8787/panel-login/?reason=expired');
  expect(response.status()).toBe(200);
  await expect(page.getByRole('heading',{name:'Войди заново'})).toBeVisible();
  await page.getByRole('link',{name:'Сбросить сессию и войти',exact:true}).click();
  await expect(page).toHaveURL(/\/test\/access\/login/);
  await page.getByRole('link',{name:'Email + код',exact:true}).click();
  await expect(page).toHaveURL(/\/stat-panel\/$/);
  const session=await context.request.get('http://127.0.0.1:8787/api/session');
  expect(session.status()).toBe(200);expect(await session.json()).toMatchObject({email:'owner@example.test'});
 }finally{await context.close();}
});
