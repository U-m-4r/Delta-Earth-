import { chromium } from 'playwright';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const output='../.local-run/sk-sequences-verification';await mkdir(output,{recursive:true});
const base='http://127.0.0.1:8788',origin='http://127.0.0.1:5173';
const catalog=await(await fetch(`${base}/api/stories`)).json();
const targets=catalog.filter(x=>x.owner==='sk'||['bangalore-sequence-2026','jeddah-sequence-2026'].includes(x.slug));
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[],results=[];
page.on('pageerror',e=>errors.push(e.message));
await page.route(/\/api\/(nisar\/(scenes|extractions)|study-areas\/analyze)/,route=>{errors.push('Unexpected satellite retrieval while viewing');return route.abort();});
async function waitFrame(i,date){await page.waitForFunction(({i,date})=>document.querySelector('.flood-narrative .section-kicker')?.textContent?.includes(`Chapter ${String(i+1).padStart(2,'0')}`)&&document.querySelector('.flood-narrative time')?.getAttribute('datetime')===date&&!document.querySelector('.flood-map-tools [role="status"]')?.textContent?.includes('Loading'),{i,date},{timeout:60000});}
try{
 await page.goto(origin,{waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'Stories',exact:true}).click();await page.locator('.story-card').first().waitFor();
 assert.equal(await page.locator('.story-card').count(),catalog.length);
 assert.equal(catalog.some(x=>x.slug==='pakistan-indus-2026'),false,'Archived Sukkur must stay out of active catalog');
 for(const entry of targets){
  const raw=await(await fetch(`${base}/api/stories/${entry.slug}`)).json();assert.equal(raw.kind,'sequence');
  if(entry.owner==='sk')assert.ok(raw.observations.length>=3&&raw.observations.length<=4);
  assert.deepEqual(raw.observations.map(o=>o.date),raw.observations.map(o=>o.date).sort());
  for(const o of raw.observations){const bytes=await readFile(`../Backend/Stories/case-studies/${entry.slug}/${o.image}`);assert.equal(createHash('sha256').update(bytes).digest('hex'),o.imageSha256);}
  await page.locator('.story-card').filter({hasText:entry.title}).click();await page.getByRole('heading',{name:entry.title,exact:true}).waitFor();await waitFrame(0,raw.observations[0].date);
  assert.equal(await page.locator('.flood-viewer').count(),1,'All stories use the shared viewer');
  assert.equal(await page.locator('.timeline-checkpoint-dates button').count(),raw.observations.length);
  for(let i=0;i<raw.observations.length;i++){await page.locator('.timeline-checkpoint-dates button').nth(i).click();await waitFrame(i,raw.observations[i].date);assert.equal(await page.locator('.flood-narrative h3').innerText(),raw.observations[i].label);}
  if(raw.mission==='Sentinel-1 RTC')assert.match(await page.locator('.stories-scroll').innerText(),/Sentinel-1/);
  await page.getByRole('button',{name:'Compare With Baseline',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.flood-map').length===2&&!document.querySelector('.flood-map-tools [role="status"]')?.textContent?.includes('Loading'));
  await page.getByRole('button',{name:'Zoom in',exact:true}).click();assert.equal(await page.locator('.flood-map svg').first().getAttribute('viewBox'),await page.locator('.flood-map svg').last().getAttribute('viewBox'));
  await page.locator('.flood-viewer').screenshot({path:`${output}/${entry.slug}.png`});
  await page.setViewportSize({width:390,height:844});assert.equal(await page.locator('.stories-scroll').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true,'No mobile page overflow');
  await page.getByRole('button',{name:'All stories',exact:true}).click();await page.setViewportSize({width:1440,height:1000});results.push({slug:entry.slug,frames:raw.observations.length,mission:raw.mission??'NISAR',checks:['all frame hashes','actual dates','shared viewer','date selection','matching captions','baseline comparison','synchronized zoom','mobile layout','no upstream retrieval']});
 }
 assert.deepEqual(errors,[]);await writeFile(`${output}/results.json`,JSON.stringify({status:'passed',results,errors,catalogCount:catalog.length},null,2));console.log(JSON.stringify({status:'passed',tested:results.length,catalogCount:catalog.length}));
}catch(e){await page.screenshot({path:`${output}/failure.png`});throw e;}finally{await browser.close();}
