import {chromium} from 'playwright';
import {writeFile,mkdir} from 'node:fs/promises';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-swiftshader']});const results=[];
for(const origin of ['http://127.0.0.1:5173','http://localhost:5173']){
 const page=await browser.newPage();const failed=[];page.on('requestfailed',r=>{if(r.url().includes('8788')||r.url().includes('8787'))failed.push({url:r.url(),failure:r.failure()});});
 await page.goto(origin,{waitUntil:'domcontentloaded'});
 const checks=await page.evaluate(async()=>{
  const out=[];for(const base of ['http://127.0.0.1:8788','http://localhost:8787']){
   try{let r=await fetch(base+'/api/stories');const d=await r.json();out.push({base,status:r.status,stories:Array.isArray(d)?d.length:null});}catch(e){out.push({base,error:e.message});}
  }return out;
 });results.push({origin,checks,failed});await page.close();
}
await browser.close();await mkdir('../.local-run/story-loading-fix',{recursive:true});await writeFile('../.local-run/story-loading-fix/origin-diagnostic.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));
