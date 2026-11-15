import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('../..',import.meta.url)));
const output='.local-run/globe-verification';await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader']});
const context=await browser.newContext({viewport:{width:1440,height:1000},hasTouch:true});
const page=await context.newPage();const errors=[];let catalogRequests=0;
page.on('pageerror',error=>errors.push(error.message));
page.on('request',request=>{ if(new URL(request.url()).pathname==='/api/stories')catalogRequests++; });
await page.route('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/**',route=>route.fulfill({body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64'),contentType:'image/png'}));
await page.route(/\/api\/(nisar\/(scenes|extractions)|study-areas\/analyze|studies\/.*\/process)/,route=>{errors.push(`Unexpected data retrieval: ${route.request().url()}`);return route.abort();});
const origin=process.env.STORIES_BASE_URL ?? 'http://localhost:5173';
const stats=()=>page.evaluate(()=>window.globeTest.stats());
const go=async(story,height=650000)=>{
  await page.evaluate(({location,height})=>window.globeTest.look(location.longitude,location.latitude,height),{location:story.markerLocation,height});
  await page.waitForFunction(id=>window.globeTest.picked(id).includes(id),story.slug);
  return page.evaluate(id=>window.globeTest.point(id),story.slug);
};
const choose=async story=>{
  const point=await go(story);await page.mouse.click(point.x,point.y);
  const nearby=page.getByRole('region',{name:'Story preview'}).getByRole('button',{name:story.title,exact:false});
  if(await nearby.count())await nearby.click();
  await page.getByRole('region',{name:'Story preview'}).getByRole('heading',{name:story.title,exact:true}).waitFor();
};
try {
  await page.goto(`${origin}/tests/globe.fixture.html`,{waitUntil:'networkidle'});
  await page.waitForFunction(()=>window.globeTest?.ready());
  const catalogue=await(await page.request.get('http://localhost:8787/api/stories')).json();
  const located=catalogue.filter(item=>item.markerLocation);
  await page.waitForFunction(count=>window.globeTest.stats().entities?.length===count,located.length);
  assert.equal((await stats()).activeViewers,1);assert.equal(catalogRequests,1,'One shared catalogue request');
  assert.match(await page.evaluate(()=>window.globeTest.basemap()),/World_Street_Map\/MapServer\/tile\/\{z\}\/\{y\}\/\{x\}$/);
  const positions=await page.evaluate(()=>window.globeTest.locations());
  for(const story of located){const location=positions.find(row=>row.id===story.slug);assert.ok(Math.abs(location.longitude-story.markerLocation.longitude)<1e-7);assert.ok(Math.abs(location.latitude-story.markerLocation.latitude)<1e-7);}
  const bhagalpur=located.find(item=>item.slug==='bhagalpur-flood-2026');
  await choose(bhagalpur);assert.equal(await page.locator('.draft-callout').count(),0);
  const flights=(await stats()).flights;const point=await page.evaluate(id=>window.globeTest.point(id),bhagalpur.slug);
  await page.mouse.move(point.x,point.y);assert.ok(await page.evaluate(id=>window.globeTest.scale(id)>1,bhagalpur.slug));
  await page.mouse.click(point.x,point.y);assert.equal((await stats()).flights,flights,'Selecting the same marker must not repeat flight');
  await page.getByRole('button',{name:'Close story preview',exact:true}).click();assert.equal(await page.locator('.globe-story-preview').count(),0);
  await choose(bhagalpur);await page.keyboard.press('Escape');assert.equal(await page.locator('.globe-story-preview').count(),0);
  await choose(located.find(item=>item.slug==='jeddah-sequence-2026'));await choose(bhagalpur);
  // Clicking blank canvas closes the preview and leaves drawing untouched.
  const canvas=await page.locator('.cesium-widget canvas').boundingBox();await page.mouse.click(canvas.x+canvas.width-20,canvas.y+canvas.height-100);
  assert.equal(await page.locator('.globe-story-preview').count(),0);
  // A world-scale pick yields a chooser when nearby stories overlap.
  await page.evaluate(()=>window.globeTest.look(78,25,16000000));
  let clustered=null;
  for(const story of located){if((await page.evaluate(id=>window.globeTest.picked(id),story.slug)).length>1){clustered=story;break;}}
  if(!clustered){await page.waitForTimeout(300);for(const story of located){if((await page.evaluate(id=>window.globeTest.picked(id),story.slug)).length>1){clustered=story;break;}}}
  assert.ok(clustered,'Nearby markers should group at world scale');
  const clusterPoint=await page.evaluate(id=>window.globeTest.point(id),clustered.slug);await page.mouse.click(clusterPoint.x,clusterPoint.y);
  await page.getByRole('heading',{name:/stories nearby/}).waitFor();assert.ok(await page.locator('.globe-story-choices button').count()>1);
  await page.locator('.globe-story-choices button').first().click();await page.locator('.globe-story-explore').waitFor();
  await choose(bhagalpur);
  await page.getByRole('button',{name:'Show story markers'}).click();assert.equal((await stats()).visible,false);assert.equal(await page.locator('.globe-story-preview').count(),0);
  assert.equal((await stats()).imagery,2);await page.getByRole('button',{name:'Show story markers'}).click();
  // Drawing over a marker adds only a vertex, without selecting the story.
  const drawPoint=await go(bhagalpur);await page.getByRole('button',{name:'Select area',exact:true}).click();
  await page.mouse.click(drawPoint.x,drawPoint.y);assert.equal(await page.locator('.globe-story-preview').count(),0);
  assert.match(await page.locator('.draft-callout').innerText(),/1 point placed/);
  await page.mouse.click(drawPoint.x+25,drawPoint.y);await page.mouse.click(drawPoint.x,drawPoint.y+25);
  assert.match(await page.locator('.summary-grid').innerText(),/VERTICES\s+3/);assert.ok((await stats()).drawings>=4);
  await page.getByRole('button',{name:'Navigate',exact:true}).click();
  // Hiding markers leaves study entities and imagery in place.
  const drawingCount=(await stats()).drawings;await page.getByRole('button',{name:'Show story markers'}).click();
  assert.equal((await stats()).drawings,drawingCount);await page.getByRole('button',{name:'Show story markers'}).click();
  await choose(bhagalpur);await page.waitForTimeout(1600);
  const camera=await page.evaluate(()=>window.globeTest.camera());
  await page.getByRole('button',{name:'Explore Story',exact:true}).click();await page.locator('.flood-documentary[data-story="bhagalpur-flood-2026"]').waitFor();
  await page.getByRole('button',{name:'All stories',exact:true}).click();await page.getByRole('button',{name:'Globe',exact:true}).click();
  await page.waitForFunction(()=>window.globeTest.ready()&&window.globeTest.stats().activeViewers===1);
  const restored=await page.evaluate(()=>window.globeTest.camera());camera.forEach((value,index)=>assert.ok(Math.abs(value-restored[index])<1e-5));
  assert.equal(await page.getByRole('button',{name:'Show story markers'}).getAttribute('aria-pressed'),'true');assert.equal(catalogRequests,1,'Navigation reuses catalogue');
  // Refreshes update, deduplicate and remove entities without rebuilding the viewer.
  let extra={slug:'new-story',title:'New local story',location:'Test location',changeType:'Test',markerLocation:{longitude:110,latitude:10}};
  const unlocated={slug:'unlocated-story',title:'No coordinates available',location:'NAN',changeType:'Test',markerLocation:null};
  await page.route('http://localhost:8787/api/stories',route=>route.fulfill({json:[...catalogue,extra,extra,unlocated]}));
  const totalViewers=(await stats()).totalViewers;
  await page.evaluate(()=>window.dispatchEvent(new Event('delta-earth:stories-updated')));
  await page.waitForFunction(count=>window.globeTest.stats().entities.length===count,located.length+1);
  assert.equal((await stats()).totalViewers,totalViewers);
  extra={...extra,markerLocation:{longitude:112,latitude:11}};
  await page.evaluate(()=>window.dispatchEvent(new Event('delta-earth:stories-updated')));
  await page.waitForFunction(()=>Math.abs(window.globeTest.locations().find(row=>row.id==='new-story').longitude-112)<1e-7);
  await page.unroute('http://localhost:8787/api/stories');await page.evaluate(()=>window.dispatchEvent(new Event('delta-earth:stories-updated')));
  await page.waitForFunction(count=>window.globeTest.stats().entities.length===count,located.length);
  await choose(bhagalpur);await page.screenshot({path:`${output}/globe-stories-desktop.png`});
  // Fresh narrow-screen app: globe gets the full width and touch picks work.
  await page.setViewportSize({width:390,height:844});await page.reload({waitUntil:'networkidle'});
  await page.waitForFunction(count=>window.globeTest?.ready()&&window.globeTest.stats().entities.length===count,located.length);
  const mobilePoint=await go(bhagalpur);await page.touchscreen.tap(mobilePoint.x,mobilePoint.y);
  await page.getByRole('heading',{name:bhagalpur.title,exact:true}).waitFor();
  assert.equal(await page.locator('.globe-story-preview').evaluate(el=>{const box=el.getBoundingClientRect();return box.left>=0&&box.right<=innerWidth;}),true);
  assert.ok((await page.locator('.cesium-widget canvas').boundingBox()).width>=380);
  await page.screenshot({path:`${output}/globe-stories-mobile.png`});
  await page.goto(`${origin}/tests/globe.fixture.html?overlay=1`,{waitUntil:'networkidle'});
  await page.waitForFunction(()=>window.globeTest?.ready()&&window.globeTest.stats().entities.length===1&&window.globeTest.stats().imagery===3);
  const overlayStory={...bhagalpur,slug:'local-story'};const overlayPoint=await go(overlayStory);
  await page.mouse.click(overlayPoint.x,overlayPoint.y);
  await page.getByRole('region',{name:'Story preview'}).waitFor();
  assert.equal(await page.locator('#raster-clicks').innerText(),'0','Marker clicks do not invoke raster inspection');
  await page.keyboard.press('Escape');await page.mouse.click(overlayPoint.x+45,overlayPoint.y+45);
  assert.equal(await page.locator('#raster-clicks').innerText(),'1','Normal raster clicks remain available');
  await page.getByRole('button',{name:'Toggle drawing',exact:true}).click();await page.mouse.click(overlayPoint.x,overlayPoint.y);
  assert.equal(await page.locator('#draft-count').innerText(),'1');
  assert.equal(await page.locator('#raster-clicks').innerText(),'1');
  const overlayDrawings=(await stats()).drawings;
  await page.getByRole('button',{name:'Toggle markers',exact:true}).click();
  assert.equal((await stats()).imagery,3);assert.equal((await stats()).drawings,overlayDrawings);
  assert.equal((await stats()).visible,false);assert.equal((await stats()).activeViewers,1);
  assert.match(await page.evaluate(()=>window.globeTest.basemap()),/World_Street_Map/,'Overlay refresh retains the English-label provider');
  assert.deepEqual(errors,[]);
  const result={status:'passed',markers:located.length,checks:['coordinates','single viewer','one catalogue fetch','native picking','preview and close','Escape','overlap chooser','visibility isolation','drawing isolation','camera restoration','metadata refresh and deduplication','mobile touch','raster overlay and click isolation'],errors};
  await writeFile(`${output}/results.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
} catch(error){await page.screenshot({path:`${output}/failure.png`,fullPage:true});await writeFile(`${output}/failure.txt`,`${error.stack}\n${await page.locator('body').innerText()}\n${JSON.stringify(errors)}`);throw error;}
finally{await browser.close();}
