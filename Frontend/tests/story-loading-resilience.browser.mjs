import {chromium} from 'playwright';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const api='http://127.0.0.1:8788',out='../.local-run/story-loading-fix';await mkdir(out,{recursive:true});
const catalog=await(await fetch(api+'/api/stories')).json();const sk=catalog.filter(s=>s.owner==='sk');const stories=new Map();let assets=0;
for(const entry of sk){
 const raw=await(await fetch(`${api}/api/stories/${entry.slug}`)).json();stories.set(entry.slug,raw);
 for(const frame of raw.observations){
  const response=await fetch(`${api}/case-studies/${entry.slug}/${frame.image}`);assert.equal(response.status,200);assert.ok(response.headers.get('content-type').startsWith('image/'));
  assert.equal(createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex'),frame.imageSha256);assets++;
 }
}
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-swiftshader']});const results=[],errors=[];
async function waitFrame(page,i,date){await page.waitForFunction(({i,date})=>document.querySelector('.flood-narrative .section-kicker')?.textContent?.includes(`Chapter ${String(i+1).padStart(2,'0')}`)&&document.querySelector('.flood-narrative time')?.getAttribute('datetime')===date&&!document.querySelector('.flood-map-tools [role="status"]')?.textContent?.includes('Loading'),{i,date},{timeout:30000});}
async function checkVisible(page){assert.equal(await page.locator('.stories-alert-error').count(),0);assert.equal(await page.evaluate(async()=>{for(const im of document.querySelectorAll('.story-frame-visible')){const url=im.getAttribute('href');if(!url)return false;try{const r=await fetch(url);if(!r.ok)return false;const img=new Image();img.src=url;await img.decode();}catch{return false;}}return true;}),true,'Displayed object URLs must remain live');}
try{
 for(const origin of ['http://localhost:5173','http://127.0.0.1:5173']){
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin,{waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'Stories',exact:true}).click();await page.locator('.story-card').first().waitFor();
  for(const entry of sk){
   const raw=stories.get(entry.slug);await page.locator('.story-card').filter({hasText:entry.title}).click();await page.getByRole('heading',{name:entry.title,exact:true}).waitFor();await waitFrame(page,0,raw.observations[0].date);
   for(let cycle=0;cycle<3;cycle++){
    for(let i=raw.observations.length-1;i>=0;i--){await page.locator('.timeline-checkpoint-dates button').nth(i).click();await waitFrame(page,i,raw.observations[i].date);await checkVisible(page);}
    // Rapid input deliberately supersedes pending loads, then commits the last date.
    await page.locator('.timeline-checkpoint-dates button').evaluateAll(async buttons=>{for(let n=0;n<2;n++)for(const b of buttons){b.click();await new Promise(r=>setTimeout(r,15));}});
    await waitFrame(page,raw.observations.length-1,raw.observations.at(-1).date);await checkVisible(page);
    await page.getByRole('button',{name:'Compare With Baseline',exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll('.flood-map').length===2&&!document.querySelector('.flood-map-tools [role="status"]')?.textContent?.includes('Loading'));
    await checkVisible(page);await page.getByRole('button',{name:'Compare With Baseline',exact:true}).click();await waitFrame(page,raw.observations.length-1,raw.observations.at(-1).date);
   }
   await page.getByRole('button',{name:'All stories',exact:true}).click();results.push({origin,slug:entry.slug,cycles:3,status:'passed'});
  }
  const raw=stories.get('nepal-glacier-flood-2026');const entry=sk.find(x=>x.slug===raw.slug);
  await page.locator('.story-card').filter({hasText:entry.title}).click();await waitFrame(page,0,raw.observations[0].date);
  let attempts=0;await page.route('**/nepal-glacier-flood-2026/frame-3.png*',route=>++attempts===1?route.fulfill({status:503,body:'temporary failure'}):route.continue());
  await page.locator('.timeline-checkpoint-dates button').nth(2).click();await waitFrame(page,2,raw.observations[2].date);assert.ok(attempts>=2);await checkVisible(page);await page.unroute('**/nepal-glacier-flood-2026/frame-3.png*');
  const background=await browser.newPage();await background.goto('about:blank');await page.waitForTimeout(10000);await background.close();await page.bringToFront();
  await page.locator('.timeline-checkpoint-dates button').nth(0).click();await waitFrame(page,0,raw.observations[0].date);await checkVisible(page);
  await page.screenshot({path:`${out}/${origin.includes('localhost')?'localhost':'loopback'}-after-idle.png`});await page.close();
 }
 // Strict lifecycle replay previously left the comparison AbortController aborted.
 const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:5173',{waitUntil:'domcontentloaded'});
 const raw=stories.get('punjab-floods-2025');await page.evaluate(async raw=>{document.getElementById('root').style.display='none';const el=document.createElement('div');document.body.append(el);const f=await import('/tests/viewer-fixture.tsx');f.mountStrictStory(el,f.adapt(raw));},raw);
 await waitFrame(page,0,raw.observations[0].date);await page.locator('.timeline-checkpoint-dates button').nth(3).click();await waitFrame(page,3,raw.observations[3].date);await page.getByRole('button',{name:'Compare With Baseline',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.flood-map').length===2&&!document.querySelector('.flood-map-tools [role="status"]')?.textContent?.includes('Loading'));await checkVisible(page);await page.close();
 assert.deepEqual(errors,[]);await writeFile(`${out}/resilience-results.json`,JSON.stringify({status:'passed',verifiedHttpAssets:assets,results,automatic503Recovery:true,backgroundIdleRecovery:true,strictLifecycleComparison:true,errors},null,2));console.log(JSON.stringify({status:'passed',assets,originStoryChecks:results.length,strictLifecycleComparison:true}));
}catch(e){await writeFile(`${out}/failure.txt`,String(e.stack));throw e;}finally{await browser.close();}
