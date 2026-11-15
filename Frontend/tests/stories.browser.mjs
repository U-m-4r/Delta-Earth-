import { chromium } from 'playwright';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

process.chdir(fileURLToPath(new URL('../..', import.meta.url)));
const output = '.local-run/browser-verification';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}), headless: true, args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const origin = process.env.STORIES_BASE_URL ?? 'http://localhost:5173';
const errors = [], results = [];
page.on('pageerror', error => errors.push(error.message));
// Fail if a story attempts to start satellite discovery or retrieval.
await page.route(/\/api\/(nisar\/(scenes|extractions)|study-areas\/analyze|studies\/.*\/process)/, route => {
  errors.push(`Unexpected retrieval: ${route.request().url()}`); return route.abort();
});
const waitChapter = async (index, title) => {
  await page.waitForFunction(({ index, title }) => {
    const text = document.querySelector('.flood-narrative .section-kicker')?.textContent;
    return text?.includes(`Chapter ${String(index+1).padStart(2,'0')}`) && (!title || document.querySelector('.flood-narrative h3')?.textContent === title)
      && !document.querySelector('.flood-map-tools [role="status"]')?.textContent.includes('Loading');
  }, { index, title });
};
const select = async index => { await page.locator('.timeline-checkpoint-dates button').nth(index).click(); await waitChapter(index); };
const resetScroll = async () => { await page.locator('.stories-scroll').evaluate(el=>{el.scrollTop=0;}); };
try {
  if (process.env.STORIES_TEST_SCOPE !== 'visualization') {
  await page.goto(origin, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name:'Stories',exact:true }).click();
  await page.locator('.story-card').first().waitFor();
  const catalogue = await (await page.request.get('http://localhost:8787/api/stories')).json();
  for (const slug of ['bhagalpur-flood-2026', 'bangalore-sequence-2026', 'jeddah-sequence-2026',
    'po-delta-sequence-2026', 'senegal-river-sequence-2026', 'pakistan-indus-2026',
    'pakistan-manchar-2026', 'pakistan-tarbela-2026', 'assam-brahmaputra-2026']) {
    assert.ok(catalogue.some(entry => entry.slug === slug), `Missing story: ${slug}`);
  }
  for (const entry of catalogue) {
    const raw = await (await page.request.get(`http://localhost:8787/api/stories/${entry.slug}`)).json();
    await page.locator('.story-card').filter({hasText:entry.title}).click();
    await page.locator('.story-frame-visible').waitFor();
    const chapters = raw.chapters ?? raw.observations;
    assert.equal(await page.locator('.flood-viewer').count(),1);
    assert.equal(await page.locator('.timeline-checkpoint-dates button').count(),chapters.length);
    assert.equal(await page.getByRole('heading',{level:1}).innerText(),raw.title);
    const adapted = await page.evaluate(async raw => (await import('/tests/viewer-fixture.tsx')).adapt(raw),raw);
    assert.deepEqual(adapted.metadata,raw,'Original metadata must be retained');
    assert.equal(adapted.chapters.length,chapters.length);
    await page.getByRole('button',{name:'Zoom in',exact:true}).click();
    const camera = await page.locator('.flood-map svg').getAttribute('viewBox');
    for (let index=0;index<chapters.length;index++) {
      await select(index);
      const chapter = chapters[index];
      assert.equal(await page.locator('.flood-narrative h3').innerText(),chapter.title ?? chapter.label);
      assert.equal(await page.locator('.flood-narrative time').getAttribute('datetime'),chapter.date);
      const narrative=chapter.narrative ?? chapter.caption ?? raw.event;
      for (const paragraph of narrative.split('\n\n')) assert.ok((await page.locator('.flood-narrative').innerText()).includes(paragraph));
      assert.equal(await page.locator('.flood-map svg').getAttribute('viewBox'),camera);
      assert.equal(await page.locator('.timeline-checkpoint-dates button[aria-pressed="true"]').count(),1);
    }
    await page.getByRole('button',{name:raw.kind==='documentary'?'Compare With June 20':'Compare With Baseline',exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll('.flood-map').length===2);
    assert.equal(await page.locator('.flood-map svg').first().getAttribute('viewBox'),await page.locator('.flood-map svg').last().getAttribute('viewBox'));
    await select(Math.max(1,chapters.length-2));
    assert.equal(await page.locator('.flood-map').count(),2,'Comparison follows chapter selection');
    if (await page.getByRole('button',{name:'Show Changes',exact:true}).count()) {
      await page.getByRole('button',{name:'Show Changes',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('.flood-map figcaption')?.textContent.startsWith('Change from'));
    }
    if (raw.pairs?.length) {
      for (let pair=0;pair<raw.pairs.length;pair++) {
        await page.getByRole('combobox',{name:'Saved comparison'}).selectOption(String(pair));
        const target=chapters.findIndex(chapter=>chapter.key===raw.pairs[pair].to);
        await waitChapter(target);
        await page.getByRole('button',{name:'Water map',exact:true}).click();
        await page.waitForFunction(()=>document.querySelector('.flood-map figcaption')?.textContent.startsWith('Candidate water change'));
        assert.match(await page.locator('.story-metrics').innerText(),/Water before/);
        await page.getByRole('button',{name:'Water map',exact:true}).click();
        await page.waitForFunction(()=>document.querySelector('.flood-map figcaption')?.textContent.startsWith('Observation'));
      }
    }
    const range=page.getByRole('slider',{name:'Select acquisition checkpoint'});
    await range.focus();await page.keyboard.press('Home');await waitChapter(0);
    await page.keyboard.press('ArrowRight');await waitChapter(1);
    if (chapters.length > 2) {
      await page.getByRole('button',{name:'Next Chapter',exact:true}).click();await waitChapter(2);
      await page.getByRole('button',{name:'Previous Chapter',exact:true}).click();await waitChapter(1);
    } else {
      assert.equal(await page.getByRole('button',{name:'Next Chapter',exact:true}).isDisabled(),true);
      await page.getByRole('button',{name:'Previous Chapter',exact:true}).click();await waitChapter(0);
    }
    // Drag the real native handle across the track (not a synthetic input event).
    const box=await range.boundingBox();
    const current=Number(await range.inputValue());
    await page.mouse.move(box.x+8+(box.width-16)*current/(chapters.length-1),box.y+box.height/2);
    await page.mouse.down();await page.mouse.move(box.x+box.width-8,box.y+box.height/2,{steps:12});await page.mouse.up();
    await waitChapter(chapters.length-1);
    assert.equal(Number(await range.inputValue()),chapters.length-1);
    if (entry.slug === 'bhagalpur-flood-2026') {
      await range.focus();await page.keyboard.press('Home');await waitChapter(0);
      const touch=await page.context().newCDPSession(page);
      await touch.send('Emulation.setTouchEmulationEnabled',{enabled:true});
      const bounds=await range.boundingBox();const y=bounds.y+bounds.height/2;
      const startX=bounds.x+8;const endX=startX+(bounds.width-16)/(chapters.length-1);
      await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:startX,y}]});
      for(let step=1;step<=8;step++) await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:startX+(endX-startX)*step/8,y}]});
      await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await waitChapter(1);
      await touch.send('Emulation.setTouchEmulationEnabled',{enabled:false});await touch.detach();
    }
    await resetScroll();await page.screenshot({path:`${output}/${entry.slug}-desktop.png`});
    await page.setViewportSize({width:390,height:844});await resetScroll();
    assert.equal(await page.locator('.stories-scroll').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
    await page.screenshot({path:`${output}/${entry.slug}-mobile.png`});
    await page.getByRole('button',{name:'All stories',exact:true}).click();await page.setViewportSize({width:1440,height:1000});
    results.push({slug:entry.slug,chapters:chapters.length,status:'passed'});
  }
  // Delayed and failed frames keep raster, narrative and active highlight on the
  // last committed observation; a superseded request may never overwrite it.
  const entry=catalogue.find(item=>item.slug==='bangalore-sequence-2026');
  await page.locator('.story-card').filter({hasText:entry.title}).click();await waitChapter(0);
  const previous=await page.locator('.story-frame-visible').getAttribute('href');
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  await page.route('**/bangalore-sequence-2026/frame-5.png',async route=>{await gate;await route.continue();});
  await page.locator('.timeline-checkpoint-dates button').nth(4).click();
  await page.waitForTimeout(150);
  assert.equal(await page.locator('.story-frame-visible').getAttribute('href'),previous);
  assert.match(await page.locator('.flood-narrative .section-kicker').innerText(),/Chapter 01/i);
  await select(1);release();await page.waitForTimeout(200);await waitChapter(1);
  await page.unroute('**/bangalore-sequence-2026/frame-5.png');
  await page.route('**/bangalore-sequence-2026/frame-5.png',route=>route.abort());
  await page.locator('.timeline-checkpoint-dates button').nth(4).click();
  await page.getByRole('alert').filter({hasText:'could not be loaded'}).waitFor();
  assert.match(await page.locator('.flood-narrative .section-kicker').innerText(),/Chapter 02/i);
  await page.unroute('**/bangalore-sequence-2026/frame-5.png');
  await page.getByRole('button',{name:'Retry selected frame',exact:true}).click();await waitChapter(4);
  }
  // Actual VisualizationPage with an entirely local mocked catalogue and PNGs.
  // No scientific processing or satellite API is invoked.
  await page.goto(origin);
  const png=await readFile('Backend/Stories/case-studies/bhagalpur-flood-2026/preview.png');
  const dates=['2026-06-20T00:00:00Z','2026-07-07T00:00:00Z','2026-10-20T00:00:00Z'];
  await page.route('http://localhost:8787/api/**',route=>{
    const url=route.request().url();
    if(url.includes('/processed-observations'))return route.fulfill({json:{observations:dates.map((date,index)=>({observationId:`G${index}-ASF`,granuleId:`G${index}-ASF`,acquisitionDate:date,variables:[{name:'HVHV',sourceVariable:'HVHV',frequency:'frequencyA',rasterUrl:`/mock/${index}.tif`,raster:{units:'1',calibration:'gamma0',boundsWgs84:[86,25,87,26],width:364,height:480}}]}))}});
    if(url.includes('/preview/'))return route.fulfill({body:png,contentType:'image/png',headers:{'Access-Control-Expose-Headers':'X-Raster-Bounds-WGS84, X-Raster-Legend','X-Raster-Bounds-WGS84':'[86,25,87,26]','X-Raster-Legend':JSON.stringify({palette:'turbo',stops:['#000','#fff'],ticks:[.002,.09],minimum:.002,maximum:.09,normalizationScale:.01})}});
    if(url.includes('/retrieval-sessions/'))return route.fulfill({json:{status:'completed'}});
    return route.fulfill({json:{sessionId:'local-fixture',sessionToken:'local-fixture',studyId:'0123456789abcdef'}});
  });
  await page.evaluate(async()=>{
    const fixture=await import('/tests/viewer-fixture.tsx');const root=document.createElement('div');root.style.cssText='height:100vh;display:flex';document.body.replaceChildren(root);fixture.mountVisualization(root);
  });
  await page.getByRole('button',{name:'Create Timeline',exact:true}).click();
  await page.locator('.timeline-frame-visible').waitFor();
  const range=page.getByRole('slider',{name:'Select acquisition checkpoint'});
  await range.focus();await page.keyboard.press('Home');
  await page.waitForFunction(()=>document.querySelector('.timeline-frame-visible')?.getAttribute('alt')?.includes('Jun'));
  await page.getByRole('button',{name:'Next',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.timeline-frame-visible')?.getAttribute('alt')?.includes('Jul'));
  await page.locator('.timeline-checkpoint-dates button').nth(2).click();
  await page.waitForFunction(()=>document.querySelector('.timeline-frame-visible')?.getAttribute('alt')?.includes('Oct'));
  await page.getByRole('button',{name:'Clear Timeline',exact:true}).click();assert.equal(await range.count(),0);
  // A single observation with missing optional metadata still uses the viewer.
  await page.route('**/case-studies/single-observation/*',route=>route.fulfill({body:png,contentType:'image/png'}));
  await page.evaluate(async()=>{
    const fixture=await import('/tests/viewer-fixture.tsx');
    const story=fixture.adapt({slug:'single-observation',title:'Single observation',observations:[{key:'only',label:'Only observation',image:'frame.png'}],pairs:[]});
    const root=document.createElement('div');root.style.cssText='height:100vh;overflow:auto';document.body.replaceChildren(root);fixture.mountStory(root,story);
  });
  await page.locator('.story-frame-visible').waitFor();
  assert.equal(await page.getByRole('slider').isDisabled(),true);
  assert.equal(await page.getByRole('button',{name:'Previous Chapter',exact:true}).isDisabled(),true);
  assert.equal(await page.getByRole('button',{name:'Next Chapter',exact:true}).isDisabled(),true);
  assert.match(await page.locator('.flood-intro').innerText(),/NAN/);
  assert.deepEqual(errors,[]);
  await writeFile(`${output}/results.json`,JSON.stringify({status:'passed',results,visualization:'passed',dragging:'passed',staleAndFailedFrames:'passed',errors},null,2));
  console.log(JSON.stringify({status:'passed',results,visualization:'passed',dragging:'passed',staleAndFailedFrames:'passed'}));
} catch(error) {
  await page.screenshot({path:`${output}/failure.png`,fullPage:true});
  await writeFile(`${output}/failure.txt`,`${error.stack}\n${await page.locator('body').innerText()}\n${JSON.stringify(errors)}`);throw error;
} finally { await browser.close(); }
