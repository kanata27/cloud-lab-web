import {DEFAULT_CURRENCIES,today,duration,validateEntry,convert,summary} from './earnings-model.js';
import {DateFilters} from './date-filter.js';
const $=id=>document.getElementById(id),tokenKey='kanata_admin_token';
const number=new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}),one=new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1});
const names=new Intl.DisplayNames(['ru'],{type:'currency'});
const money=(minor,unit='Kč')=>`${number.format(minor/100)} ${unit}`;
const hours=m=>`${Math.floor(m/60)} ч ${m%60?`${m%60} мин`:''}`.trim();
const shortDate=d=>new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(d));
let entries=[],spots=[],editing=null,entryId=null,snapshot=null,rateSerial=0,loadSerial=0,chartMode='sum',saving=false,dirty=false,deleteTarget=null;
let dateFilters;
function node(tag,text,className){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n;}
function errorAt(id,message){$(id).textContent=message;$(id).hidden=!message;}
function closeEntryMenus(){document.querySelectorAll('.entry-menu:popover-open').forEach(menu=>menu.hidePopover());}
function expire(){closeEntryMenus();sessionStorage.removeItem(tokenKey);$('app').hidden=true;for(const d of document.querySelectorAll('dialog[open]'))d.close();location.replace('/stat-panel/login.html');}
async function api(path,options={}){
 const token=sessionStorage.getItem(tokenKey);if(!token){expire();throw new Error('Войди заново.');}
 const response=await fetch('/earnings-api'+path,{...options,cache:'no-store',credentials:'omit',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',...options.headers},signal:AbortSignal.timeout(20000)});
 if(response.status===401){expire();throw new Error('Сессия истекла.');}
 let data;try{data=await response.json();}catch{throw new Error('Сервис заработков пока недоступен.');}
 if(!response.ok)throw new Error(data.error||'Не удалось выполнить запрос.');return data;
}
function populateSpots(){
 for(const id of ['filter-spot','entry-spot']){
  const select=$(id),old=select.value;select.replaceChildren();
  if(id==='filter-spot')select.add(new Option('Все точки',''));
  else if(!spots.length){const empty=new Option('Пока нет точек','');empty.disabled=true;select.add(empty);}
  spots.forEach(s=>select.add(new Option(s.name,s.id)));
  select.disabled=id==='entry-spot'&&!spots.length;
  select.value=spots.some(s=>s.id===old)?old:id==='entry-spot'?(spots[0]?.id||''):'';
 }
}
async function load(){
 closeEntryMenus();
 const serial=++loadSerial;$('show').disabled=true;$('report').hidden=true;errorAt('message','Загрузка…');$('message').classList.remove('error');
 try{
  const query=new URLSearchParams({...dateFilters.selection(),spot:$('filter-spot').value});
  const [list,locations]=await Promise.all([api('/entries?'+query),api('/spots')]);
  if(serial!==loadSerial)return;entries=list.entries;spots=locations.spots;populateSpots();render();errorAt('message','');$('report').hidden=false;
 }catch(error){if(serial===loadSerial){errorAt('message',error.message);$('message').classList.add('error');}}
 finally{if(serial===loadSerial)$('show').disabled=false;}
}
function render(){
 closeEntryMenus();
 const s=summary(entries);$('total-czk').textContent=money(s.czkMinor);$('total-eur').textContent=`(${money(s.eurMinor,'€')})`;
 $('hour-czk').textContent=one.format(s.hourCzk)+' Kč';$('hour-eur').textContent=`(${one.format(s.hourEur)} €/ч)`;
 $('total-time').textContent=hours(s.minutes);$('count').textContent=s.count;
 $('empty').hidden=entries.length>0;$('entries-table').hidden=!entries.length;
 const body=$('entries-body');body.replaceChildren();
 for(const entry of entries){
  const tr=node('tr');tr.append(node('td',entry.date.split('-').reverse().join('.')));
  const time=node('td',`${entry.start}–${entry.end}`);time.append(node('small',hours(entry.minutes)));tr.append(time);
  tr.append(node('td',spots.find(s=>s.id===entry.spotId)?.name||'Точка'));
  tr.append(node('td',entry.amounts.filter(a=>a.minor>0).map(a=>money(a.minor,a.currency)).join(' · ')||'0 CZK'));
  const total=node('td');total.append(node('strong',money(entry.czkMinor)),node('small',`(${money(entry.eurMinor,'€')})`));tr.append(total);
  const hourly=node('td');hourly.append(node('strong',`${one.format(entry.czkMinor/100*60/entry.minutes)} Kč`),node('small',`(${one.format(entry.eurMinor/100*60/entry.minutes)} €/ч)`));tr.append(hourly);
  const actions=node('td'),controls=node('div',undefined,'entry-actions'),trigger=node('button','⋯','entry-trigger'),menu=node('div',undefined,'entry-menu');
  trigger.type='button';trigger.setAttribute('aria-label',`Действия для ${entry.date}`);trigger.setAttribute('aria-expanded','false');
  menu.id='entry-menu-'+entry.id;menu.popover='auto';trigger.setAttribute('aria-controls',menu.id);trigger.setAttribute('popovertarget',menu.id);
  const edit=node('button','Изменить данные'),remove=node('button','Удалить запись');edit.type=remove.type='button';
  edit.addEventListener('click',()=>{menu.hidePopover();openEntry(entry);});remove.addEventListener('click',()=>{menu.hidePopover();deleteTarget=entry;$('delete-description').textContent=`${shortDate(entry.date)} · ${money(entry.czkMinor)}. Эту запись нельзя будет восстановить.`;errorAt('delete-error','');$('delete-dialog').showModal();});
  menu.addEventListener('beforetoggle',event=>trigger.setAttribute('aria-expanded',String(event.newState==='open')));
  trigger.addEventListener('click',event=>{event.preventDefault();if(menu.matches(':popover-open'))menu.hidePopover();else{menu.showPopover({source:trigger});positionEntryMenu(trigger,menu);edit.focus({preventScroll:true});}});
  menu.append(edit,remove);controls.append(trigger,menu);actions.append(controls);tr.append(actions);body.append(tr);
 }
 renderCharts();
}
function positionEntryMenu(trigger,menu){
 const anchor=trigger.getBoundingClientRect(),box=menu.getBoundingClientRect(),edge=8,gap=6;
 const left=Math.max(edge,Math.min(anchor.right-box.width,innerWidth-box.width-edge));
 const below=anchor.bottom+gap,top=below+box.height<=innerHeight-edge?below:Math.max(edge,anchor.top-gap-box.height);
 menu.style.left=left+'px';menu.style.top=top+'px';
}
function repositionEntryMenus(){
 document.querySelectorAll('.entry-menu:popover-open').forEach(menu=>{
  const trigger=menu.previousElementSibling,anchor=trigger.getBoundingClientRect();
  if(anchor.bottom<=0||anchor.top>=innerHeight||anchor.right<=0||anchor.left>=innerWidth)menu.hidePopover();else positionEntryMenu(trigger,menu);
 });
}
function svgNode(tag,attrs={},text){const n=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);if(text!==undefined)n.textContent=text;return n;}
function chartScale(values){
 const upper=Math.max(1,...values)*1.1,rawStep=upper/4,magnitude=10**Math.floor(Math.log10(rawStep)),fraction=rawStep/magnitude;
 const step=(fraction<1.5?1:fraction<3.5?2:fraction<7.5?5:10)*magnitude;
 const intervals=Math.ceil(upper/step),max=intervals*step;
 return {max,ticks:Array.from({length:intervals+1},(_,i)=>Number((i*step).toPrecision(12)))};
}
function renderCharts(){
 const host=$('daily-chart');host.replaceChildren();const groups=new Map();
 entries.forEach(e=>groups.set(e.date,[...(groups.get(e.date)||[]),e]));
 const data=[...groups].sort(([a],[b])=>a.localeCompare(b)).map(([date,items])=>({date,...summary(items),spotNames:[...new Set(items.map(e=>spots.find(s=>s.id===e.spotId)?.name).filter(Boolean))]}));
 if(!data.length)host.append(node('p','График появится после добавления выступлений.','muted'));
 else{
  const values=data.map(d=>chartMode==='sum'?d.czkMinor/100:d.hourCzk),{max,ticks}=chartScale(values);
  const width=Math.max(280,host.clientWidth),height=245,left=Math.max(45,number.format(max).length*7+16),right=12,top=30,bottom=35,plot=width-left-right;
  const svg=svgNode('svg',{viewBox:`0 0 ${width} ${height}`,role:'img','aria-label':chartMode==='sum'?'Заработок по дням в кронах':'Заработок за час по дням в кронах'});
  for(const tick of ticks){const y=top+(height-top-bottom)*(1-tick/max);svg.append(svgNode('line',{x1:left,x2:width-right,y1:y,y2:y,class:'chart-grid'}),svgNode('text',{x:left-10,y:y+4,'text-anchor':'end',class:'chart-label chart-tick'},number.format(tick)));}
  const step=plot/data.length,bar=Math.max(.8,Math.min(46,step*.6)),labelStep=Math.max(1,Math.ceil(data.length/Math.max(2,Math.floor(plot/90))));
  data.forEach((d,i)=>{const value=values[i],h=value/max*(height-top-bottom),x=left+i*step+(step-bar)/2,y=height-bottom-h;
   const rect=svgNode('rect',{x,y,width:bar,height:Math.max(h,1),rx:Math.min(3,bar/2),class:'chart-bar'});
   rect.append(svgNode('title',{},d.spotNames.join(' · ')));svg.append(rect);
   if(data.length<=7)svg.append(svgNode('text',{x:x+bar/2,y:y-7,'text-anchor':'middle',class:'chart-value'},one.format(value)));
   if(i%labelStep===0)svg.append(svgNode('text',{x:x+bar/2,y:height-10,'text-anchor':'middle',class:'chart-label'},shortDate(d.date)));
  });svg.append(svgNode('text',{x:left-10,y:14,'text-anchor':'end',class:'chart-label chart-unit'},chartMode==='sum'?'Kč':'Kč/ч'));host.append(svg);
 }
 const locationHost=$('spots-chart');locationHost.replaceChildren();
 // Compare registered places, not just the places active in this report.
 // A single registered place must not leave a panel or a grid gap behind.
 $('spots-panel').hidden=spots.length<=1;
 if($('spots-panel').hidden)return;
 const locationData=spots.map(spot=>({...spot,...summary(entries.filter(e=>e.spotId===spot.id))})).filter(s=>s.count).sort((a,b)=>b.hourCzk-a.hourCzk);
 if(!locationData.length)locationHost.append(node('p','Здесь будет сравнение точек.','muted'));
 const max=Math.max(1,...locationData.map(s=>s.hourCzk));
 locationData.forEach(s=>{const row=node('div',undefined,'spot-row'),label=node('div',undefined,'spot-label');label.append(node('span',s.name),node('strong',`${one.format(s.hourCzk)} Kč (${one.format(s.hourEur)} €)`));const bar=node('progress');bar.max=max;bar.value=s.hourCzk;bar.setAttribute('aria-label',`${s.name}: ${one.format(s.hourCzk)} крон в час`);row.append(label,bar);locationHost.append(row);});
}
function currencies(){return [...new Set([...DEFAULT_CURRENCIES,...Object.keys(snapshot?.rates||{}),...['PLN','HUF','GBP','CHF','SEK','NOK','DKK','RON','CAD','AUD','JPY']])].sort();}
function currencyRow(currency,amount='0',required=false){
 const row=node('div',undefined,'currency-row'+(required?'':' optional-currency'));row.dataset.required=String(required);
 const label=node('label');let selector;
 if(required){label.append(node('span',`${currency} · ${names.of(currency)} *`));row.dataset.currency=currency;}
 else{selector=node('select');selector.setAttribute('aria-label','Дополнительная валюта');currencies().filter(c=>!DEFAULT_CURRENCIES.includes(c)).forEach(c=>selector.add(new Option(`${c} · ${names.of(c)}`,c)));selector.value=currency;row.append(selector);selector.addEventListener('change',()=>{dirty=true;updateEstimate();});}
 const input=node('input');input.type='text';input.inputMode='decimal';input.required=true;input.value=amount;input.setAttribute('aria-label',`Сумма ${currency}`);input.autocomplete='off';input.pattern='[0-9]+([.,][0-9]{1,2})?';
 if(required){label.append(input);row.append(label);}else{row.append(input);const remove=node('button','×','icon-button');remove.type='button';remove.setAttribute('aria-label','Убрать валюту');remove.addEventListener('click',()=>{row.remove();dirty=true;updateEstimate();});row.append(remove);}
 $('amounts').append(row);
}
function inputData(){return {id:entryId,version:editing?.version,date:$('entry-date').value,start:$('entry-start').value,end:$('entry-end').value,nextDay:$('next-day').checked,spotId:$('entry-spot').value,amounts:[...$('amounts').children].map(row=>({currency:row.dataset.currency||row.querySelector('select').value,amount:row.querySelector('input').value}))};}
function updateEstimate(){
 $('estimate-total').textContent='—';$('estimate-hour').textContent='—';
 try{const d=duration($('entry-date').value,$('entry-start').value,$('entry-end').value,$('next-day').checked);$('duration').textContent=hours(d.minutes)+' · время Праги';}catch{$('duration').textContent='Время Праги';}
 if(!snapshot||snapshot.requestedDate!==$('entry-date').value)return;
 try{const data=validateEntry(inputData()),value=convert(data.amounts,snapshot);$('estimate-total').textContent=`${money(value.czkMinor)} (${money(value.eurMinor,'€')})`;$('estimate-hour').textContent=`${one.format(value.czkMinor/100*60/data.minutes)} Kč/ч (${one.format(value.eurMinor/100*60/data.minutes)} €/ч)`;}catch{/* incomplete form */}
}
async function loadRates(){
 const serial=++rateSerial,date=$('entry-date').value;snapshot=null;updateEstimate();errorAt('form-error','');
 if(!date)return;
 try{const result=editing?.date===date?editing.snapshot:await api('/rates?'+new URLSearchParams({date}));if(serial!==rateSerial)return;snapshot=result;updateEstimate();}
 catch(error){if(serial===rateSerial)errorAt('form-error',error.message);}
}
function openEntry(entry=null){
 editing=entry;entryId=entry?.id||crypto.randomUUID();dirty=false;saving=false;snapshot=null;$('entry-form').reset();$('amounts').replaceChildren();errorAt('form-error','');
 $('entry-title').textContent=entry?'Изменить выступление':'Добавить выступление';$('save-entry').textContent=entry?'Сохранить изменения':'Сохранить запись';
 $('entry-date').max=today();$('entry-date').value=entry?.date||today();$('entry-start').value=entry?.start||'';$('entry-end').value=entry?.end||'';$('next-day').checked=entry?.nextDay||false;
 populateSpots();$('entry-spot').value=entry?.spotId||$('filter-spot').value||spots[0]?.id||'';
 DEFAULT_CURRENCIES.forEach(c=>currencyRow(c,String((entry?.amounts.find(a=>a.currency===c)?.minor||0)/100),true));
 if(entry){snapshot=entry.snapshot;entry.amounts.filter(a=>!DEFAULT_CURRENCIES.includes(a.currency)).forEach(a=>currencyRow(a.currency,String(a.minor/100)));}
 $('entry-dialog').showModal();loadRates();
}
function closeEntry(){if(saving)return;if(dirty&&!confirm('Закрыть без сохранения изменений?'))return;++rateSerial;$('entry-dialog').close();}
$('add-entry').addEventListener('click',()=>openEntry());
for(const id of ['close-entry','cancel-entry'])$(id).addEventListener('click',closeEntry);
$('entry-dialog').addEventListener('cancel',e=>{e.preventDefault();closeEntry();});
$('entry-form').addEventListener('input',()=>{dirty=true;updateEstimate();});$('entry-spot').addEventListener('change',()=>{dirty=true;updateEstimate();});
$('entry-date').addEventListener('change',loadRates);
$('add-currency').addEventListener('click',()=>{const used=inputData().amounts.map(a=>a.currency),available=currencies().find(c=>!used.includes(c));if(!available)return;currencyRow(available);dirty=true;});
$('entry-form').addEventListener('submit',async event=>{
 event.preventDefault();if(saving)return;saving=true;$('save-entry').disabled=true;errorAt('form-error','');const input=inputData();
 try{validateEntry(input);if(!snapshot||snapshot.requestedDate!==input.date){await loadRates();if(!snapshot||snapshot.requestedDate!==input.date)throw new Error('Дождись загрузки курсов и повтори сохранение.');}convert(validateEntry(input).amounts,snapshot);
  saving=true;$('save-entry').disabled=true;const wasEditing=Boolean(editing);
  await api(wasEditing?`/entries/${entryId}`:'/entries',{method:wasEditing?'PUT':'POST',body:JSON.stringify(input)});
  dirty=false;$('entry-dialog').close();++rateSerial;
  if(input.date<$('from').value||input.date>$('to').value){
   let from=input.date<$('from').value?input.date:$('from').value,to=input.date>$('to').value?input.date:$('to').value;
   if((Date.parse(to)-Date.parse(from))/86400000>366)from=to=input.date;
   dateFilters.setRange(from,to);
  }
  if($('filter-spot').value&&$('filter-spot').value!==input.spotId)$('filter-spot').value='';await load();
 }catch(error){errorAt('form-error',error.message);}finally{saving=false;$('save-entry').disabled=false;}
});
$('new-spot').addEventListener('click',()=>{$('spot-form').reset();errorAt('spot-error','');$('spot-dialog').showModal();$('spot-name').focus();});
$('cancel-spot').addEventListener('click',()=>$('spot-dialog').close());
$('spot-form').addEventListener('submit',async e=>{e.preventDefault();$('save-spot').disabled=true;try{const spot=await api('/spots',{method:'POST',body:JSON.stringify({name:$('spot-name').value})});if(!spots.some(s=>s.id===spot.id))spots.push(spot);populateSpots();renderCharts();$('entry-spot').value=spot.id;dirty=true;updateEstimate();$('spot-dialog').close();}catch(error){errorAt('spot-error',error.message);}finally{$('save-spot').disabled=false;}});
$('cancel-delete').addEventListener('click',()=>$('delete-dialog').close());
$('confirm-delete').addEventListener('click',async()=>{$('confirm-delete').disabled=true;try{await api(`/entries/${deleteTarget.id}`,{method:'DELETE',body:JSON.stringify({version:deleteTarget.version})});$('delete-dialog').close();await load();}catch(error){errorAt('delete-error',error.message);}finally{$('confirm-delete').disabled=false;}});
document.querySelectorAll('[data-chart]').forEach(b=>b.addEventListener('click',()=>{chartMode=b.dataset.chart;document.querySelectorAll('[data-chart]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));renderCharts();}));
$('logout').addEventListener('click',expire);window.addEventListener('pageshow',e=>{if(e.persisted&&!sessionStorage.getItem(tokenKey))expire();});
window.addEventListener('resize',closeEntryMenus);document.addEventListener('scroll',repositionEntryMenus,true);
new ResizeObserver(()=>{if(!$('report').hidden)renderCharts();}).observe($('daily-chart'));
if(!sessionStorage.getItem(tokenKey))expire();else{dateFilters=new DateFilters({timeZone:'Europe/Prague',onChange:load});$('app').hidden=false;load();}
