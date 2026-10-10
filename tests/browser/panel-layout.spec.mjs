import {test,expect} from '@playwright/test';
import {trafficReport} from '../support/insights-fixtures.mjs';

test('panels share tab baselines and underline position; mobile date fields stay separate',async({page})=>{
  await page.clock.setFixedTime(new Date('2026-10-09T20:00:00Z'));
  await page.addInitScript(()=>{
    sessionStorage.setItem('kanata_admin_token','test-token');window.violations=[];
    document.addEventListener('securitypolicyviolation',e=>window.violations.push(e.violatedDirective));
  });
  await page.route('https://dupt8l46y1.execute-api.eu-north-1.amazonaws.com/**',async route=>{
    const headers={'Access-Control-Allow-Origin':'http://127.0.0.1:8787','Access-Control-Allow-Headers':'authorization,content-type','Access-Control-Allow-Methods':'GET,OPTIONS'};
    if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
    const range=new URL(route.request().url()).searchParams;
    await route.fulfill({headers,json:trafficReport(range.get('from'),range.get('to'))});
  });
  await page.route('**/earnings-api/**',route=>route.fulfill({json:route.request().url().includes('/spots')?{spots:[]}:{entries:[]}}));
  const pages=[['/stat-panel/earnings','Заработки'],['/stat-panel/insights','Инсайты'],['/stat-panel/','Посещения']];
  for(const width of [1440,414,320]){
    await page.setViewportSize({width,height:900});
    const baselines=[];
    for(const [url,title] of pages){
      await page.goto(url);await expect(page.locator('#report')).toBeVisible();await page.evaluate(()=>document.fonts.ready);
      await expect(page.locator('.masthead nav a')).toHaveText(['Заработки','Инсайты','Посещения']);
      await expect(page.locator('.masthead nav [aria-current="page"]')).toHaveText(title);
      const geometry=await page.evaluate(()=>{
        const header=document.querySelector('.masthead').getBoundingClientRect();
        const active=document.querySelector('.masthead nav [aria-current="page"]'),box=active.getBoundingClientRect();
        const line=getComputedStyle(active,'::after'),text=document.createRange();text.selectNodeContents(active);
        const textBox=text.getBoundingClientRect();
        const from=document.querySelector('#from').getBoundingClientRect(),to=document.querySelector('#to').getBoundingClientRect();
        const panel=document.querySelector('#filters').getBoundingClientRect();
        return {
          baseline:textBox.bottom-header.top,underline:box.bottom-parseFloat(line.bottom)-header.top,
          headerHeight:header.height,color:line.backgroundColor,lineHeight:line.height,border:getComputedStyle(active).borderBottomWidth,
          separate:innerWidth<=380?to.top>=from.bottom+13:to.left>=from.right+(innerWidth<=760?19:13),
          contained:from.left>=panel.left&&to.right<=panel.right&&from.width>0&&to.width>0,
          overflow:document.documentElement.scrollWidth>innerWidth,
        };
      });
      expect(geometry.color).toBe('rgb(99, 129, 111)');expect(geometry.lineHeight).toBe('2px');expect(geometry.border).toBe('0px');
      expect(geometry.separate).toBe(true);expect(geometry.contained).toBe(true);expect(geometry.overflow).toBe(false);
      if(width>380){
        expect(Math.abs(geometry.underline-geometry.headerHeight)).toBeLessThan(1);
        baselines.push(geometry.baseline);
      }
      expect(await page.evaluate(()=>window.violations)).toEqual([]);
    }
    if(baselines.length)expect(Math.max(...baselines)-Math.min(...baselines)).toBeLessThan(1);
  }
});
