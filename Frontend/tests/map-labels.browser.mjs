import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir,writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('../..',import.meta.url)));
const output='.local-run/map-label-verification';await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader']});
// Use a non-English browser locale to prove that the fixed English raster style
// is independent of navigator.language. These checks use REAL, unmapped tiles.
const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'ja-JP'});
const page=await context.newPage();const errors=[];const responses=[];
page.on('pageerror',error=>errors.push(error.message));
page.on('response',response=>{if(response.url().includes('/World_Street_Map/MapServer/tile/'))responses.push({url:response.url(),status:response.status()});});
await page.route(/\/api\/(nisar\/(scenes|extractions)|study-areas\/analyze|studies\/.*\/process)/,route=>{errors.push('Unexpected satellite retrieval');return route.abort();});
const regions=[{name:'india',longitude:77.21,latitude:28.6139},{name:'china',longitude:116.4074,latitude:39.9042},{name:'japan',longitude:139.6917,latitude:35.6895},{name:'russia',longitude:37.6173,latitude:55.7558},{name:'europe',longitude:2.3522,latitude:48.8566},{name:'south-america',longitude:-46.6333,latitude:-23.5505}];
const results=[];
try{
 await page.goto(`${process.env.STORIES_BASE_URL??'http://localhost:5173'}/tests/globe.fixture.html`,{waitUntil:'networkidle'});
 await page.waitForFunction(()=>window.globeTest?.ready());
 assert.match(await page.evaluate(()=>window.globeTest.basemap()),/World_Street_Map\/MapServer\/tile\/\{z\}\/\{y\}\/\{x\}$/);
 for(const region of regions){
  const first=responses.length;
  await page.evaluate(region=>window.globeTest.look(region.longitude,region.latitude,1200000),region);
  await page.waitForTimeout(400);
  await page.waitForFunction(()=>window.globeTest.tilesLoaded(),{},{timeout:30000});
  const fetched=responses.slice(first);assert.ok(fetched.some(row=>row.status===200),`No live tiles loaded for ${region.name}`);
  assert.ok(fetched.every(row=>row.status===200),`Map tile error in ${region.name}`);
  const config=await page.evaluate(async()=>{const module=await import('/src/config/mapProvider.ts');return {language:module.MAP_LANGUAGE,url:module.BASEMAP.url};});
  assert.equal(config.language,'en');assert.ok(!config.url.includes('key='));
  await page.screenshot({path:`${output}/${region.name}.png`});results.push({region:region.name,tiles:fetched.length,status:'passed'});
 }
 assert.equal(await page.evaluate(()=>navigator.language),'ja-JP');
 assert.equal(await page.locator('.cesium-viewer-bottom').isVisible(),true,'Provider attribution must remain visible');
 assert.deepEqual(errors,[]);
 const result={status:'passed',browserLocale:'ja-JP',provider:'Esri World Street Map',results,errors,note:'Real tile delivery and provider configuration verified; label wording is visually reviewed in the regional screenshots, not inferred from HTTP status.'};
 await writeFile(`${output}/results.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch(error){await page.screenshot({path:`${output}/failure.png`,fullPage:true});await writeFile(`${output}/failure.txt`,`${error.stack}\n${JSON.stringify(errors)}`);throw error;}
finally{await browser.close();}
