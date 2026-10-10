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
 await expect(page.locator('#spots-panel')).toBeHidden();
 await page.locator('#add-entry').click();await expect(page.locator('#entry-spot')).toBeDisabled();await page.locator('#entry-start').fill('14:20');await page.locator('#entry-end').fill('17:12');
 await page.locator('#new-spot').click();await page.locator('#spot-name').fill('Набережная');await page.locator('#save-spot').click();
 await expect(page.locator('#spot-dialog')).not.toBeVisible();
 await expect(page.locator('#entry-spot')).toHaveValue('spot-a');
 await expect(page.locator('#entry-spot')).toBeEnabled();
 await expect(page.locator('#entry-spot option')).toHaveText(['Набережная']);
 await page.getByRole('textbox',{name:'Сумма CZK',exact:true}).fill('220');await page.getByRole('textbox',{name:'Сумма EUR',exact:true}).fill('2,2');await page.getByRole('textbox',{name:'Сумма USD',exact:true}).fill('2');
 await expect(page.getByRole('textbox',{name:'Сумма CZK',exact:true})).toHaveValue('220');
 await expect(page.getByRole('textbox',{name:'Сумма EUR',exact:true})).toHaveValue('2,2');
 await expect(page.getByRole('textbox',{name:'Сумма USD',exact:true})).toHaveValue('2');
 await expect(page.locator('#estimate-total')).toContainText('315');await expect(page.locator('#estimate-hour')).toContainText('€/ч');
 await page.locator('#save-entry').click();await expect(page.locator('#entries-body tr')).toHaveCount(1);await expect(page.locator('#total-czk')).toHaveText('315 Kč');await expect(page.locator('#hour-eur')).toContainText('€/ч');
 await expect(page.locator('#spots-panel')).toBeHidden();
 await expect(page.locator('#entries-body select')).toHaveCount(0);await page.locator('.entry-trigger').click();await page.getByRole('button',{name:'Изменить данные'}).click();
 await page.locator('#entry-end').fill('18:20');await page.locator('#save-entry').click();await expect(page.locator('#hour-czk')).toHaveText('78,8 Kč');
 await page.locator('#from').fill('2026-09-01');await page.locator('#to').fill('2026-09-02');await page.locator('#show').click();await expect(page.locator('#empty')).toBeVisible();
 await page.getByRole('button',{name:'Последний месяц',exact:true}).click();await expect(page.locator('#entries-body tr')).toHaveCount(1);
 for(const width of [320,390,1440]){
  await page.setViewportSize({width,height:844});
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }
 await page.setViewportSize({width:390,height:844});
 await page.locator('.entry-trigger').click();await page.getByRole('button',{name:'Удалить запись',exact:true}).click();await page.locator('#confirm-delete').click();await expect(page.locator('#empty')).toBeVisible();
 expect(await page.evaluate(()=>window.violations)).toEqual([]);
});
test('earnings: real spots only and hover duration and names for one or several places',async({page})=>{
 await page.clock.setFixedTime(new Date('2026-10-09T20:00:00Z'));
 await page.addInitScript(()=>sessionStorage.setItem('kanata_admin_token','test'));
 const spots=[{id:'spot-a',name:'Malostranské schody'},{id:'spot-b',name:'Anděl'}];
 const snapshot={rates:{CZK:1,EUR:25,USD:20}};
 const entries=[['2026-10-03','spot-a'],['2026-10-03','spot-b'],['2026-10-03','spot-a'],['2026-10-04','spot-b']].map(([date,spotId],i)=>{
  const model=validateEntry({date,spotId,start:'14:20',end:'17:12',nextDay:false,amounts:[{currency:'CZK',amount:'220'},{currency:'EUR',amount:'0'},{currency:'USD',amount:'0'}]});
  return {...model,...convert(model.amounts,snapshot),snapshot:{...snapshot,requestedDate:date},id:'entry-'+i,version:1};
 });
 await page.route('**/earnings-api/**',async route=>{
  const url=new URL(route.request().url());
  await route.fulfill({json:url.pathname.endsWith('/spots')?{spots}:url.pathname.endsWith('/rates')?{...snapshot,requestedDate:url.searchParams.get('date')}:{entries:entries.filter(e=>!url.searchParams.get('spot')||e.spotId===url.searchParams.get('spot'))}});
 });
 await page.goto('/stat-panel/earnings');await expect(page.locator('#entries-body tr')).toHaveCount(4);
 await expect(page.locator('#spots-panel')).toBeVisible();
 await expect(page.locator('#daily-chart .chart-bar title')).toHaveText(['8ч 36м | Malostranské schody · Anděl','2ч 52м | Anděl']);
 await page.getByRole('button',{name:'За час',exact:true}).click();
 await expect(page.locator('#daily-chart .chart-bar title')).toHaveText(['8ч 36м | Malostranské schody · Anděl','2ч 52м | Anděl']);
 for(const width of [320,390,1440]){
  await page.setViewportSize({width,height:1000});
  const trigger=page.locator('.entry-trigger').first();await trigger.scrollIntoViewIfNeeded();
  const dimensions=()=>page.locator('#entries-table').evaluate(table=>({width:table.getBoundingClientRect().width,height:table.getBoundingClientRect().height,scrollWidth:table.parentElement.scrollWidth,cells:[...table.rows[1].cells].map(cell=>cell.getBoundingClientRect().width)}));
  const before=await dimensions();await trigger.click();
  await expect(page.locator('.entry-menu:popover-open')).toHaveCount(1);
  await expect(page.getByRole('button',{name:'Изменить данные',exact:true})).toBeVisible();
  await expect(trigger).toHaveAttribute('aria-expanded','true');
  expect(await dimensions()).toEqual(before);
  expect(await page.locator('.entry-menu:popover-open').evaluate(menu=>{
   const box=menu.getBoundingClientRect();return box.left>=8&&box.right<=innerWidth-8&&box.top>=8&&box.bottom<=innerHeight-8;
  })).toBe(true);
  await trigger.click();await expect(page.locator('.entry-menu:popover-open')).toHaveCount(0);
  await trigger.click();await page.keyboard.press('Escape');await expect(page.locator('.entry-menu:popover-open')).toHaveCount(0);
  await trigger.click();await page.getByRole('heading',{name:'Выступления',exact:true}).click();await expect(page.locator('.entry-menu:popover-open')).toHaveCount(0);
 }
 await page.locator('#add-entry').click();
 await expect(page.locator('#entry-spot option')).toHaveText(['Malostranské schody','Anděl']);
 await expect(page.locator('#entry-spot')).toHaveValue('spot-a');
 await page.locator('#cancel-entry').click();
 await page.locator('#filter-spot').selectOption('spot-b');await page.locator('#show').click();
 await expect(page.locator('#entries-body tr')).toHaveCount(2);
 // Registered spots, not active spots in the selected report, control visibility.
 await expect(page.locator('#spots-panel')).toBeVisible();
 await expect(page.locator('#daily-chart .chart-bar title')).toHaveText(['2ч 52м | Anděl','2ч 52м | Anděl']);
 await page.locator('#add-entry').click();await expect(page.locator('#entry-spot')).toHaveValue('spot-b');
});
test('earnings requires a session',async({page})=>{await page.goto('/stat-panel/earnings');await expect(page).toHaveURL(/login/);});
test('earnings: pencil renames a spot, handles conflicts and preserves the unsaved entry and history',async({page})=>{
 await page.clock.setFixedTime(new Date('2026-10-10T09:00:00Z'));
 await page.addInitScript(()=>{sessionStorage.setItem('kanata_admin_token','test');window.violations=[];document.addEventListener('securitypolicyviolation',e=>window.violations.push(e.violatedDirective));});
 const spots=[{id:'spot-a',name:'Malostranké schody'},{id:'spot-b',name:'Anděl'}],renames=[];
 const snapshot={requestedDate:'2026-10-04',rates:{CZK:1,EUR:25,USD:20}};
 const model=validateEntry({date:'2026-10-04',spotId:'spot-a',start:'11:00',end:'12:00',nextDay:false,amounts:[{currency:'CZK',amount:'444'},{currency:'EUR',amount:'0'},{currency:'USD',amount:'0'}]});
 const entry={...model,...convert(model.amounts,snapshot),snapshot,id:'entry-a',version:1};
 await page.route('**/earnings-api/**',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(req.method()==='PUT'&&url.pathname.includes('/spots/')){
   const id=url.pathname.split('/').at(-1),data=req.postDataJSON();renames.push({id,data});
   if(spots.some(spot=>spot.id!==id&&spot.name===data.name))return route.fulfill({status:409,json:{error:'Точка с таким названием уже существует.'}});
   await new Promise(resolve=>setTimeout(resolve,250));
   const spot=spots.find(item=>item.id===id);spot.name=data.name.trim();return route.fulfill({json:spot});
  }
  expect(req.method()).toBe('GET');
  await route.fulfill({json:url.pathname.endsWith('/spots')?{spots}:url.pathname.endsWith('/rates')?{...snapshot,requestedDate:url.searchParams.get('date')}:{entries:[entry]}});
 });
 await page.goto('/stat-panel/earnings');await expect(page.locator('#entries-body')).toContainText('Malostranké schody');
 await page.locator('#add-entry').click();
 await page.locator('#entry-start').fill('14:20');await page.locator('#entry-end').fill('17:12');
 await page.getByRole('textbox',{name:'Сумма CZK',exact:true}).fill('220');
 await page.locator('#open-spots').focus();await page.keyboard.press('ArrowDown');
 await expect(page.locator('#spot-picker-menu')).toBeVisible();
 await expect(page.locator('.spot-edit')).toHaveCount(2);
 await page.keyboard.press('End');await page.keyboard.press('Enter');
 await expect(page.locator('#entry-spot')).toHaveValue('spot-b');
 await expect(page.locator('#entry-spot-value')).toHaveText('Anděl');
 await page.locator('#open-spots').click();
 await page.getByRole('button',{name:'Изменить название точки «Malostranké schody»',exact:true}).click();
 await expect(page.locator('#spot-picker-menu')).toBeHidden();
 await expect(page.locator('#spot-title')).toHaveText('Изменить название точки');
 await expect(page.locator('#spot-name')).toHaveValue('Malostranké schody');
 await page.locator('#spot-name').fill('Anděl');await page.locator('#save-spot').click();
 await expect(page.locator('#spot-error')).toContainText('уже существует');
 await expect(page.locator('#spot-dialog')).toBeVisible();await expect(page.locator('#save-spot')).toBeEnabled();
 await page.locator('#spot-name').fill('Malostranské schody');await page.locator('#save-spot').click();
 await expect(page.locator('#cancel-spot')).toBeDisabled();await page.keyboard.press('Escape');
 await expect(page.locator('#spot-dialog')).toBeVisible();
 await expect(page.locator('#spot-dialog')).toBeHidden();
 await expect(page.locator('#open-spots')).toBeFocused();
 await expect(page.locator('#entry-spot')).toHaveValue('spot-b');
 await expect(page.locator('#entry-start')).toHaveValue('14:20');await expect(page.locator('#entry-end')).toHaveValue('17:12');
 await expect(page.getByRole('textbox',{name:'Сумма CZK',exact:true})).toHaveValue('220');
 await expect(page.locator('#entry-spot option')).toHaveText(['Malostranské schody','Anděl']);
 expect(renames).toEqual([{id:'spot-a',data:{name:'Anděl'}},{id:'spot-a',data:{name:'Malostranské schody'}}]);
 await page.locator('#open-spots').click();
 await page.getByRole('button',{name:'Изменить название точки «Anděl»',exact:true}).click();
 await page.locator('#spot-name').fill('Cancelled');await page.keyboard.press('Escape');
 await expect(page.locator('#spot-dialog')).toBeHidden();
 await expect(page.locator('#entry-spot-value')).toHaveText('Anděl');expect(renames).toHaveLength(2);
 page.once('dialog',dialog=>dialog.accept());await page.locator('#cancel-entry').click();
 await expect(page.locator('#entries-body')).toContainText('Malostranské schody');
 await expect(page.locator('#filter-spot option')).toHaveText(['Все точки','Malostranské schody','Anděl']);
 await expect(page.locator('#total-czk')).toHaveText('444 Kč');
 await page.reload();await expect(page.locator('#entries-body')).toContainText('Malostranské schody');
 expect(entry.spotId).toBe('spot-a');expect(entry.version).toBe(1);
 expect(await page.evaluate(()=>window.violations)).toEqual([]);
});
test('earnings: full-width chart, rounded axes, compact spots and overnight display',async({page})=>{
 await page.clock.setFixedTime(new Date('2026-10-09T20:00:00Z'));
 await page.addInitScript(()=>sessionStorage.setItem('kanata_admin_token','test'));
 const snapshot={requestedDate:'2026-10-03',rates:{CZK:1,EUR:24.47,USD:21.8}};
 const spot={id:'spot-a',name:'Malostranské schody'};
 const model=validateEntry({date:'2026-10-03',start:'11:11',end:'04:12',nextDay:true,spotId:spot.id,amounts:[{currency:'CZK',amount:'123'},{currency:'EUR',amount:'2'},{currency:'USD',amount:'1'}]});
 let records=[{...model,...convert(model.amounts,snapshot),snapshot,id:'entry-a',version:1}];
 await page.route('**/earnings-api/**',async route=>{
  const url=new URL(route.request().url());
  await route.fulfill({json:url.pathname.endsWith('/spots')?{spots:[spot,{id:'spot-b',name:'Anděl'}]}:{entries:records}});
 });
 await page.goto('/stat-panel/earnings');await expect(page.locator('#entries-body tr')).toHaveCount(1);
 await expect(page.getByRole('heading',{name:'Заработки',exact:true})).toHaveCount(0);
 await expect(page.locator('#entries-body')).not.toContainText('+1 день');
 await expect(page.locator('#entries-body td').nth(1)).toHaveText('11:11–04:1217 ч 1 мин');
 for(const width of [1440,1000,390,320]){
  await page.setViewportSize({width,height:1000});
  await expect.poll(()=>page.evaluate(()=>{
   const daily=document.querySelector('.daily-panel').getBoundingClientRect(),spots=document.querySelector('.spots-panel').getBoundingClientRect();
   return spots.top>=daily.bottom&&Math.abs(spots.width-daily.width)<1&&spots.height<daily.height&&document.documentElement.scrollWidth<=innerWidth;
  })).toBe(true);
 }
 await page.setViewportSize({width:1440,height:1000});
 // Typical small, larger, zero and fractional hourly amounts all stay readable.
 for(const [amount,expected] of [[444,['0','100','200','300','400','500']],[853,['0','200','400','600','800','1 000']],[0,['0','0,2','0,4','0,6','0,8','1','1,2']]]){
  records=[{...records[0],czkMinor:amount*100}];await page.locator('#show').click();
  await expect(page.locator('#daily-chart .chart-tick')).toHaveText(expected);
  await expect.poll(()=>page.evaluate(()=>{
   const unit=document.querySelector('#daily-chart .chart-unit'),tick=document.querySelector('#daily-chart .chart-tick'),bar=document.querySelector('#daily-chart .chart-bar');
   return {aligned:unit.getAttribute('x')===tick.getAttribute('x'),above:unit.getBoundingClientRect().bottom<bar.getBoundingClientRect().top,inside:unit.getBoundingClientRect().left>=document.querySelector('#daily-chart').getBoundingClientRect().left};
  })).toEqual({aligned:true,above:true,inside:true});
 }
 await page.getByRole('button',{name:'За час',exact:true}).click();
 await expect(page.locator('#daily-chart .chart-unit')).toHaveText('Kč/ч');
 await page.locator('.entry-trigger').click();await page.getByRole('button',{name:'Изменить данные'}).click();
 await expect(page.locator('#next-day')).toBeChecked();
 await expect(page.locator('#duration')).toHaveText('17 ч 1 мин · время Праги');
});

test('earnings: spots comparison hides for zero or one place and updates after adding a second',async({page})=>{
 await page.clock.setFixedTime(new Date('2026-10-10T09:00:00Z'));
 await page.addInitScript(()=>sessionStorage.setItem('kanata_admin_token','test'));
 let spots=[];
 await page.route('**/earnings-api/**',async route=>{
  const req=route.request(),url=new URL(req.url());let result;
  if(url.pathname.endsWith('/spots')){
   if(req.method()==='POST'){result={id:'spot-'+(spots.length+1),name:req.postDataJSON().name};spots.push(result);}
   else result={spots};
  }else if(url.pathname.endsWith('/rates'))result={requestedDate:url.searchParams.get('date'),rates:{CZK:1,EUR:25,USD:20}};
  else result={entries:[]};
  await route.fulfill({json:result});
 });
 await page.goto('/stat-panel/earnings');await expect(page.locator('#report')).toBeVisible();
 await expect(page.locator('#spots-panel')).toBeHidden();
 await page.locator('#add-entry').click();
 for(const [name,visible] of [['Набережная',false],['Anděl',true]]){
  await page.locator('#new-spot').click();await page.locator('#spot-name').fill(name);await page.locator('#save-spot').click();
  await expect(page.locator('#spot-dialog')).toBeHidden();
  // The entry drawer covers the report, so assert the hidden attribute directly.
  await expect(page.locator('#spots-panel')).toHaveJSProperty('hidden',!visible);
 }
 page.once('dialog',dialog=>dialog.accept());
 await page.locator('#cancel-entry').click();
 await expect(page.locator('#entry-dialog')).toBeHidden();
 await expect(page.locator('#spots-panel')).toBeVisible();
 spots=spots.slice(0,1);await page.locator('#show').click();
 await expect(page.locator('#spots-panel')).toBeHidden();
});

test('earnings: action stays accessible while scrolling, beside desktop content or mobile tabs',async({page})=>{
 await page.clock.setFixedTime(new Date('2026-10-10T09:00:00Z'));
 await page.addInitScript(()=>sessionStorage.setItem('kanata_admin_token','test'));
 const model=validateEntry({date:'2026-10-04',spotId:'spot-a',start:'11:11',end:'12:12',nextDay:false,amounts:[{currency:'CZK',amount:'444'},{currency:'EUR',amount:'0'},{currency:'USD',amount:'0'}]});
 const entry={...model,...convert(model.amounts,{rates:{CZK:1,EUR:25,USD:20}}),id:'entry-a',version:1};
 const entries=Array.from({length:12},(_,i)=>({...entry,id:'entry-'+i}));
 await page.route('**/earnings-api/**',async route=>{
  const url=new URL(route.request().url());
  await route.fulfill({json:url.pathname.endsWith('/spots')?{spots:[{id:'spot-a',name:'Malostranské schody'}]}:url.pathname.endsWith('/rates')?{requestedDate:url.searchParams.get('date'),rates:{CZK:1,EUR:25,USD:20}}:{entries}});
 });
 await page.goto('/stat-panel/earnings');await expect(page.locator('#entries-body tr')).toHaveCount(entries.length);
 await page.evaluate(()=>document.fonts.ready);
 for(const width of [320,390,414,700,760,999,1000,1024,1366,1440,1600,1920,2560]){
  await page.setViewportSize({width,height:900});
  await page.evaluate(()=>scrollTo(0,0));
  await expect.poll(()=>page.evaluate(()=>{
   const table=document.querySelector('.performances').getBoundingClientRect(),button=document.querySelector('#add-entry').getBoundingClientRect(),header=document.querySelector('.masthead').getBoundingClientRect();
   const desktop=innerWidth>=1000,size=desktop?64:44;
   const placed=desktop?Math.abs(button.left-table.right-24)<1&&Math.abs(button.bottom-(innerHeight-32))<1
    :button.top>=header.top&&button.bottom<=header.bottom&&[...document.querySelectorAll('.masthead nav a')].every(link=>link.getBoundingClientRect().right<=button.left);
   return placed&&button.width===size&&button.height===size
    &&button.left>=0&&button.right<=innerWidth&&document.documentElement.scrollWidth<=innerWidth;
  })).toBe(true);
  expect(await page.locator('#entries-table').evaluate(el=>getComputedStyle(el).fontSize)).toBe('16px');
  const before=await page.locator('#add-entry').boundingBox();
  await page.evaluate(()=>scrollTo(0,500));
  await expect.poll(()=>page.evaluate(()=>scrollY)).toBeGreaterThan(0);
  expect(await page.locator('#add-entry').boundingBox()).toEqual(before);
  await page.locator('#add-entry').click();await expect(page.locator('#entry-dialog')).toBeVisible();
  await page.locator('#cancel-entry').click();await expect(page.locator('#entry-dialog')).toBeHidden();
 }
});
